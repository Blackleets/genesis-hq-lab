// WalletAuthProvider.tsx — SIWES-style wallet authentication provider.
//
// Security model (non-negotiable):
// - The ONLY signature ever requested is the login nonce challenge returned
//   by POST /api/auth/nonce (EIP-191 personal_sign). We NEVER sign a message
//   that did not come verbatim from the backend. No approvals, no transfers,
//   nothing that moves funds.
// - The session lives in sessionStorage (NOT localStorage): it dies with the
//   tab, which keeps the stolen-token surface minimal.
// - A user-rejected signature surfaces a clean error — it never crashes.

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
import { createConfig, http, injected, WagmiProvider } from 'wagmi';
import { connect, disconnect, getAccount, signMessage } from 'wagmi/actions';
import { mainnet, polygon } from 'wagmi/chains';
import {
  isSessionValid,
  type UserRole,
  type WalletSession,
} from '@core/auth/walletTypes';

// Off-chain signing only — mainnet + polygon are just the networks the
// injected wallet defaults to; no transactions are ever broadcast.
const wagmiConfig = createConfig({
  chains: [mainnet, polygon],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
  },
});

const queryClient = new QueryClient();

const SESSION_KEY = 'ghq_wallet_session';

export type AuthStatus =
  | 'idle'
  | 'connecting'
  | 'signing'
  | 'verifying'
  | 'error'
  | 'authenticated';

interface WalletAuthContextValue {
  /** Live session, or null when logged out. */
  session: WalletSession | null;
  /** Convenience accessor: session?.role ?? null. */
  role: UserRole | null;
  status: AuthStatus;
  /** Last human-readable failure (already localized-friendly). */
  error: string | null;
  /** connect -> nonce -> personal_sign(backend message) -> verify -> session. */
  connectAndSign: () => Promise<void>;
  /** Clears the stored session and disconnects the wallet. */
  logout: () => void;
}

const WalletAuthContext = createContext<WalletAuthContextValue | null>(null);

function readStoredSession(): WalletSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WalletSession;
    // Expired/tampered sessions are dropped, never honored.
    return isSessionValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number; name?: string; message?: string } | undefined;
  if (!e) return false;
  // EIP-1193: 4001 = user rejected request. MetaMask also names it ActionRejected.
  return (
    e.code === 4001 ||
    e.name === 'ActionRejected' ||
    e.name === 'UserRejectedRequestError' ||
    /user rejected|user denied|rejected the request/i.test(e.message ?? '')
  );
}

function errMessage(err: unknown): string {
  if (isUserRejection(err)) {
    return 'Firma rechazada. No se ha movido nada — puedes volver a intentarlo.';
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg || 'Error desconocido durante la autenticación.';
}

async function postJson<T>(url: string, body: unknown, token?: string): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

interface NonceResponse {
  ok: boolean;
  nonce: string;
  message: string;
}

interface VerifyResponse {
  ok: boolean;
  session: WalletSession;
}

function isValidVerifySession(s: VerifyResponse['session'] | undefined): s is WalletSession {
  return Boolean(
    s &&
      typeof s.token === 'string' &&
      typeof s.address === 'string' &&
      (s.role === 'user' || s.role === 'operator') &&
      typeof s.expiresAt === 'number',
  );
}

function WalletAuthContextProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<WalletSession | null>(() => readStoredSession());
  const [status, setStatus] = useState<AuthStatus>(() =>
    readStoredSession() ? 'authenticated' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);

  // Drop an expired persisted session on mount (tab slept past TTL).
  useEffect(() => {
    if (session && !isSessionValid(session)) {
      sessionStorage.removeItem(SESSION_KEY);
      setSession(null);
      setStatus('idle');
    }
  }, [session]);

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setError(null);
    setStatus('idle');
    // Best-effort disconnect; ignore failures (wallet may already be gone).
    void Promise.resolve(disconnect(wagmiConfig)).catch(() => {});
  }, []);

  const connectAndSign = useCallback(async () => {
    setError(null);
    try {
      // 1) Connect the injected wallet (MetaMask/Rabbit/etc).
      setStatus('connecting');
      const connector = wagmiConfig.connectors[0];
      await connect(wagmiConfig, { connector });
      const account = getAccount(wagmiConfig);
      const address = account.address;
      if (!address) throw new Error('No se pudo obtener la dirección de la wallet.');

      // 2) Ask the backend for a fresh nonce challenge.
      const challenge = await postJson<NonceResponse>('/api/auth/nonce', { address });
      if (!challenge?.ok || !challenge.nonce || !challenge.message) {
        throw new Error('El servidor no emitió un reto de autenticación válido.');
      }

      // 3) personal_sign of EXACTLY the backend message — nothing else, ever.
      setStatus('signing');
      const signature = await signMessage(wagmiConfig, { message: challenge.message });

      // 4) Verify server-side and store the issued scoped session.
      setStatus('verifying');
      const res = await postJson<VerifyResponse>('/api/auth/verify', {
        address,
        signature,
        nonce: challenge.nonce,
      });
      if (!res?.ok || !isValidVerifySession(res.session)) {
        throw new Error('Verificación de firma fallida.');
      }
      const next = res.session;
      if (!isSessionValid(next)) throw new Error('Sesión emitida inválida o expirada.');

      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSession(next);
      setStatus('authenticated');
    } catch (err) {
      // Clean, non-crashing failure path.
      setStatus('error');
      setError(errMessage(err));
    }
  }, []);

  const value = useMemo<WalletAuthContextValue>(
    () => ({
      session,
      role: session?.role ?? null,
      status,
      error,
      connectAndSign,
      logout,
    }),
    [session, status, error, connectAndSign, logout],
  );

  return <WalletAuthContext.Provider value={value}>{children}</WalletAuthContext.Provider>;
}

/** Outer provider: wagmi + react-query required by wagmi hooks, then auth context. */
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
  const ctx = useContext(WalletAuthContext);
  if (!ctx) throw new Error('useWalletAuth must be used within WalletAuthProvider');
  return ctx;
}
