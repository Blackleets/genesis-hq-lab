// WalletAuthProvider.tsx — Solana-first owner authentication for Genesis HQ.
//
// Security model:
// - Owner authentication uses Phantom/Solflare signMessage over a backend nonce.
// - This is an off-chain Ed25519 signature only. No transaction is created,
//   no approval is requested and no funds can move.
// - The authenticated session is stored only in a Secure HttpOnly cookie.
// - Wagmi stays mounted because legacy EVM wallet surfaces elsewhere in Genesis
//   still depend on it; owner authentication itself does NOT use MetaMask.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '@services/walletConfig';
import {
  isSessionValid,
  type UserRole,
  type WalletSession,
} from '@core/auth/walletTypes';

const queryClient = new QueryClient();
const SESSION_KEY = 'ghq_wallet_session';

interface SolanaPublicKeyLike { toString(): string; }
interface SolanaSignResult { signature: Uint8Array; publicKey?: SolanaPublicKeyLike; }
interface SolanaConnectResult { publicKey?: SolanaPublicKeyLike; }
interface SolanaProvider {
  isPhantom?: boolean;
  isSolflare?: boolean;
  publicKey?: SolanaPublicKeyLike | null;
  connect: (options?: { onlyIfTrusted?: boolean }) => Promise<SolanaConnectResult | undefined>;
  disconnect?: () => Promise<void>;
  signMessage: (message: Uint8Array, display?: 'utf8' | 'hex') => Promise<SolanaSignResult>;
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
    solana?: SolanaProvider;
  }
}

export type AuthStatus = 'idle' | 'connecting' | 'signing' | 'verifying' | 'error' | 'authenticated';

interface WalletAuthContextValue {
  session: WalletSession | null;
  role: UserRole | null;
  status: AuthStatus;
  error: string | null;
  connectAndSign: () => Promise<void>;
  logout: () => void;
}

const WalletAuthContext = createContext<WalletAuthContextValue | null>(null);

function getSolanaProvider(): SolanaProvider | null {
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana || window.solflare || window.solana || null;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function isUserRejection(err: unknown): boolean {
  const value = err as { code?: number; name?: string; message?: string } | undefined;
  if (!value) return false;
  return (
    value.code === 4001 ||
    value.name === 'ActionRejected' ||
    value.name === 'UserRejectedRequestError' ||
    /user rejected|user denied|rejected the request|declined/i.test(value.message ?? '')
  );
}

function errMessage(err: unknown): string {
  if (isUserRejection(err)) return 'Firma rechazada. No se ha movido nada — puedes volver a intentarlo.';
  const message = err instanceof Error ? err.message : String(err);
  return message || 'Error desconocido durante la autenticación.';
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

interface NonceResponse {
  ok: boolean;
  nonce: string;
  message: string;
  chain?: 'solana' | 'evm';
}

interface VerifyResponse {
  ok: boolean;
  session: WalletSession;
}

function isValidVerifySession(session: VerifyResponse['session'] | undefined): session is WalletSession {
  return Boolean(
    session &&
    typeof session.address === 'string' &&
    (session.role === 'user' || session.role === 'operator') &&
    typeof session.expiresAt === 'number',
  );
}

function WalletAuthContextProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WalletSession | null>(null);
  const [status, setStatus] = useState<AuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    sessionStorage.removeItem(SESSION_KEY);
    let alive = true;
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => {
        if (alive && isValidVerifySession(data?.session) && isSessionValid(data.session)) {
          const next = data.session;
          setSession({ address: next.address, role: next.role, issuedAt: next.issuedAt, expiresAt: next.expiresAt });
          setStatus('authenticated');
        }
      })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const logout = useCallback(() => {
    void postJson('/api/auth/logout', {}).catch(() => setError('No se pudo cerrar la sesión del servidor.'));
    setSession(null);
    setError(null);
    setStatus('idle');
    const provider = getSolanaProvider();
    if (provider?.disconnect) void provider.disconnect().catch(() => {});
  }, []);

  const connectAndSign = useCallback(async () => {
    setError(null);
    try {
      const provider = getSolanaProvider();
      if (!provider) {
        throw new Error('No se detectó una wallet Solana. Activa Phantom o Solflare y vuelve a intentarlo.');
      }
      if (typeof provider.signMessage !== 'function') {
        throw new Error('La wallet Solana detectada no permite firmar mensajes de autenticación.');
      }

      setStatus('connecting');
      const connection = await provider.connect();
      const address = connection?.publicKey?.toString() || provider.publicKey?.toString();
      if (!address) throw new Error('No se pudo obtener la dirección pública de la wallet Solana.');

      const challenge = await postJson<NonceResponse>('/api/auth/nonce', { address, chain: 'solana' });
      if (!challenge?.ok || !challenge.nonce || !challenge.message) {
        throw new Error('El servidor no emitió un reto de autenticación válido.');
      }

      setStatus('signing');
      const signed = await provider.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
      if (!signed?.signature || typeof signed.signature.length !== 'number') {
        throw new Error('La wallet no devolvió una firma válida.');
      }
      const signature = bytesToBase64(Uint8Array.from(signed.signature));

      setStatus('verifying');
      const result = await postJson<VerifyResponse>('/api/auth/verify', {
        address,
        chain: 'solana',
        signature,
        nonce: challenge.nonce,
      });
      if (!result?.ok || !isValidVerifySession(result.session)) {
        throw new Error('Verificación de firma Solana fallida.');
      }

      const next: WalletSession = {
        address: result.session.address,
        role: result.session.role,
        issuedAt: result.session.issuedAt,
        expiresAt: result.session.expiresAt,
      };
      if (!isSessionValid(next)) throw new Error('Sesión emitida inválida o expirada.');

      setSession(next);
      setStatus('authenticated');
    } catch (err) {
      setStatus('error');
      setError(errMessage(err));
    }
  }, []);

  const value = useMemo<WalletAuthContextValue>(
    () => ({ session, role: session?.role ?? null, status, error, connectAndSign, logout }),
    [session, status, error, connectAndSign, logout],
  );

  return <WalletAuthContext.Provider value={value}>{children}</WalletAuthContext.Provider>;
}

export default function WalletAuthProvider({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletAuthContextProvider>{children}</WalletAuthContextProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

export function useWalletAuth(): WalletAuthContextValue {
  const context = useContext(WalletAuthContext);
  if (!context) throw new Error('useWalletAuth must be used within WalletAuthProvider');
  return context;
}
