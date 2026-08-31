// src/core/auth/walletTypes.ts — shared identity/session types for wallet auth.
// Security model: the ONLY signature ever requested is the login nonce
// (EIP-191 personal_sign). No approvals, no transfers, nothing moves funds.

export type UserRole = 'user' | 'operator';

export interface WalletSession {
  /** Checksummed wallet address. */
  address: string;
  role: UserRole;
  issuedAt: number;
  /** issuedAt + 24h. After this the session is dead and re-login is required. */
  expiresAt: number;
  /** HS256 JWT signed by the backend; sent as `Authorization: Bearer <token>`. */
  token: string;
}

/** Server nonce challenge payload (pre-signature). */
export interface AuthChallenge {
  nonce: string;
  message: string;
}

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function isSessionValid(s: WalletSession | null | undefined): boolean {
  return Boolean(s && s.token && s.expiresAt > Date.now());
}

export function shortAddress(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}
