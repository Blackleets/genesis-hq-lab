// WalletAuthProvider.tsx — Solana-first owner authentication for Genesis HQ.
//
// Security model:
// - Owner authentication uses Solana signMessage over a backend nonce.
// - Injected Phantom/Solflare providers are supported in wallet browsers and desktop extensions.
// - Android Chrome uses Solana Mobile Wallet Adapter (Wallet Standard) so the user can stay in Chrome.
// - All signatures are off-chain. No transaction is created, no approval is requested and no funds can move.
// - The authenticated session is stored only in a Secure HttpOnly cookie.
// - Wagmi stays mounted because legacy EVM wallet surfaces elsewhere in Genesis still depend on it.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider } from 'wagmi';
import { getWallets } from '@wallet-standard/app';
import {
  SolanaMobileWalletAdapterWalletName,
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from '@solana-mobile/wallet-standard-mobile';
import { wagmiConfig } from '@services/walletConfig';
import {
  isSessionValid,
  type UserRole,
  type WalletSession,
} from '@core/auth/walletTypes';

const queryClient = new QueryClient();
const SESSION_KEY = 'ghq_wallet_session';
const GENESIS_PRODUCTION_ORIGIN = 'https://genesis-hq-lab.vercel.app';

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

interface StandardWalletAccount {
  address: string;
}
interface StandardConnectFeature {
  connect: (input?: { silent?: boolean }) => Promise<{ accounts: readonly StandardWalletAccount[] }>;
}
interface StandardDisconnectFeature {
  disconnect: () => Promise<void>;
}
interface StandardSignMessageFeature {
  signMessage: (...inputs: Array<{ account: StandardWalletAccount; message: Uint8Array }>) => Promise<ReadonlyArray<{ signature: Uint8Array }>>;
}
interface StandardSolanaWallet {
  name: string;
  chains: readonly string[];
  features: Readonly<Record<string, unknown>>;
}
interface PendingMobileSignature {
  wallet: StandardSolanaWallet;
  account: StandardWalletAccount;
  nonce: string;
  message: string;
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
    solana?: SolanaProvider;
  }
}

export type AuthStatus = 'idle' | 'connecting' | 'awaiting_signature' | 'signing' | 'verifying' | 'error' | 'authenticated';

interface WalletAuthContextValue {
  session: WalletSession | null;
  role: UserRole | null;
  status: AuthStatus;
  error: string | null;
  connectAndSign: () => Promise<void>;
  logout: () => void;
}

const WalletAuthContext = createContext<WalletAuthContextValue | null>(null);

let mwaRegistered = false;

function isAndroidChrome(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /Android/i.test(ua)
    && /Chrome\/[\d.]+/i.test(ua)
    && !/(EdgA|OPR|Opera|SamsungBrowser|Firefox|FxiOS)/i.test(ua);
}

function ensureMobileWalletAdapterRegistered(): boolean {
  if (typeof window === 'undefined' || !isAndroidChrome()) return false;
  if (mwaRegistered) return true;

  registerMwa({
    appIdentity: {
      name: 'Genesis HQ',
      uri: window.location.origin || GENESIS_PRODUCTION_ORIGIN,
      icon: 'favicon.svg',
    },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: ['solana:mainnet'],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  });
  mwaRegistered = true;
  return true;
}

function getSolanaProvider(): SolanaProvider | null {
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana || window.solflare || window.solana || null;
}

function getMobileWalletStandardWallet(): StandardSolanaWallet | null {
  if (!ensureMobileWalletAdapterRegistered()) return null;
  const wallets = getWallets().get() as readonly unknown[];
  const wallet = wallets.find((candidate) => {
    const current = candidate as StandardSolanaWallet;
    return current?.name === SolanaMobileWalletAdapterWalletName
      && Boolean(current.features?.['standard:connect'])
      && Boolean(current.features?.['solana:signMessage']);
  });
  return (wallet as StandardSolanaWallet | undefined) ?? null;
}

function connectFeature(wallet: StandardSolanaWallet): StandardConnectFeature | null {
  const feature = wallet.features['standard:connect'] as StandardConnectFeature | undefined;
  return feature && typeof feature.connect === 'function' ? feature : null;
}

function disconnectFeature(wallet: StandardSolanaWallet): StandardDisconnectFeature | null {
  const feature = wallet.features['standard:disconnect'] as StandardDisconnectFeature | undefined;
  return feature && typeof feature.disconnect === 'function' ? feature : null;
}

function signMessageFeature(wallet: StandardSolanaWallet): StandardSignMessageFeature | null {
  const feature = wallet.features['solana:signMessage'] as StandardSignMessageFeature | undefined;
  return feature && typeof feature.signMessage === 'function' ? feature : null;
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
    /user rejected|user denied|rejected the request|declined|cancelled|canceled/i.test(value.message ?? '')
  );
}

function errMessage(err: unknown): string {
  if (isUserRejection(err)) return 'Firma cancelada. No se ha movido nada — puedes volver a intentarlo.';
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
  const pendingMobileSignature = useRef<PendingMobileSignature | null>(null);
  const activeStandardWallet = useRef<StandardSolanaWallet | null>(null);

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
    pendingMobileSignature.current = null;

    const injected = getSolanaProvider();
    if (injected?.disconnect) void injected.disconnect().catch(() => {});

    const standardWallet = activeStandardWallet.current;
    const disconnect = standardWallet ? disconnectFeature(standardWallet) : null;
    if (disconnect) void disconnect.disconnect().catch(() => {});
    activeStandardWallet.current = null;
  }, []);

  const acceptVerifiedSession = useCallback((result: VerifyResponse) => {
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
    setError(null);
  }, []);

  const signPendingMobileChallenge = useCallback(async (pending: PendingMobileSignature) => {
    const feature = signMessageFeature(pending.wallet);
    if (!feature) {
      pendingMobileSignature.current = null;
      throw new Error('La wallet seleccionada no permite firmar mensajes de autenticación.');
    }

    setError(null);
    setStatus('signing');
    try {
      // Important for Android Chrome: invoke signMessage directly from this user click.
      // The nonce was already fetched during the preceding connect step.
      const signPromise = feature.signMessage({
        account: pending.account,
        message: new TextEncoder().encode(pending.message),
      });
      const signed = await signPromise;
      const signatureBytes = signed?.[0]?.signature;
      if (!signatureBytes) throw new Error('La wallet no devolvió una firma válida.');

      setStatus('verifying');
      const result = await postJson<VerifyResponse>('/api/auth/verify', {
        address: pending.account.address,
        chain: 'solana',
        signature: bytesToBase64(Uint8Array.from(signatureBytes)),
        nonce: pending.nonce,
      });
      pendingMobileSignature.current = null;
      acceptVerifiedSession(result);
    } catch (err) {
      if (isUserRejection(err)) {
        setStatus('awaiting_signature');
        setError(errMessage(err));
        return;
      }
      pendingMobileSignature.current = null;
      setStatus('error');
      setError(errMessage(err));
    }
  }, [acceptVerifiedSession]);

  const connectAndSign = useCallback(async () => {
    setError(null);

    const pending = pendingMobileSignature.current;
    if (pending) {
      await signPendingMobileChallenge(pending);
      return;
    }

    try {
      const injected = getSolanaProvider();
      if (injected) {
        if (typeof injected.signMessage !== 'function') {
          throw new Error('La wallet Solana detectada no permite firmar mensajes de autenticación.');
        }

        setStatus('connecting');
        const connection = await injected.connect();
        const address = connection?.publicKey?.toString() || injected.publicKey?.toString();
        if (!address) throw new Error('No se pudo obtener la dirección pública de la wallet Solana.');

        const challenge = await postJson<NonceResponse>('/api/auth/nonce', { address, chain: 'solana' });
        if (!challenge?.ok || !challenge.nonce || !challenge.message) {
          throw new Error('El servidor no emitió un reto de autenticación válido.');
        }

        setStatus('signing');
        const signed = await injected.signMessage(new TextEncoder().encode(challenge.message), 'utf8');
        if (!signed?.signature || typeof signed.signature.length !== 'number') {
          throw new Error('La wallet no devolvió una firma válida.');
        }

        setStatus('verifying');
        const result = await postJson<VerifyResponse>('/api/auth/verify', {
          address,
          chain: 'solana',
          signature: bytesToBase64(Uint8Array.from(signed.signature)),
          nonce: challenge.nonce,
        });
        acceptVerifiedSession(result);
        return;
      }

      if (!isAndroidChrome()) {
        throw new Error('En móvil externo usa Chrome en Android o abre Genesis desde Phantom/Solflare.');
      }

      const wallet = getMobileWalletStandardWallet();
      if (!wallet) {
        throw new Error('Mobile Wallet Adapter no está disponible. Comprueba Chrome y una wallet Solana compatible instalada.');
      }
      const connect = connectFeature(wallet);
      if (!connect) throw new Error('La wallet móvil no permite conexión mediante Wallet Standard.');

      setStatus('connecting');
      // This Android intent opens the installed-wallet chooser while Genesis remains in Chrome.
      const connected = await connect.connect();
      const account = connected.accounts?.[0];
      if (!account?.address) throw new Error('La wallet móvil no devolvió una cuenta Solana.');
      activeStandardWallet.current = wallet;

      // Fetch the nonce after authorization, then require a second explicit user click
      // for signMessage. Android Chrome blocks a second app-switch if it is not driven
      // by a trusted user gesture.
      const challenge = await postJson<NonceResponse>('/api/auth/nonce', {
        address: account.address,
        chain: 'solana',
      });
      if (!challenge?.ok || !challenge.nonce || !challenge.message) {
        throw new Error('El servidor no emitió un reto de autenticación válido.');
      }

      pendingMobileSignature.current = {
        wallet,
        account,
        nonce: challenge.nonce,
        message: challenge.message,
      };
      setStatus('awaiting_signature');
    } catch (err) {
      setStatus('error');
      setError(errMessage(err));
    }
  }, [acceptVerifiedSession, signPendingMobileChallenge]);

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
