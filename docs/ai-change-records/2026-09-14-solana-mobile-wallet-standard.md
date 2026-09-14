# AI change record — Solana Mobile Wallet Adapter from Android Chrome

Date: 2026-09-14
Branch: `feat/genesis-life-os`

## Goal
Allow Genesis HQ owner authentication from ordinary Android Chrome without forcing the user to browse inside Phantom or Solflare.

## Implementation
- Register the official Solana Mobile Wallet Adapter Wallet Standard bridge only on Android Chrome when no injected Solana provider exists.
- Keep the existing injected Phantom/Solflare flow for wallet browsers and desktop extensions.
- Use a two-gesture Android flow: first connect/authorize the installed wallet, then explicitly sign the already-issued Genesis owner nonce. This keeps the wallet app switch attached to a trusted user gesture.
- Preserve the existing backend Ed25519 challenge verification, Secure HttpOnly session cookie, same-origin checks, nonce single-use semantics and owner scoping.
- Keep iOS and unsupported mobile browsers on the explicit Phantom/Solflare in-app-browser fallback.

## Safety invariants
- No transaction is constructed or submitted.
- No token approval is requested.
- No private key or wallet secret is exposed to Genesis.
- `LIVE` remains locked and this change grants no execution authority.
- Futures and Solana economic engines are unchanged.

## Supabase
- `public.genesis_auth_nonces` exists with RLS enabled and no public policies.
- `genesis-auth-nonce` Edge Function is deployed for auth-only nonce persistence.
- Vercel calls that function with project OIDC; no Supabase service-role secret is exposed to the browser or committed to the repo.
- The existing `public.bots` table remains RLS-protected for server-only persistence.

## Release state
- `package.json` and `package-lock.json` are synchronized for Mobile Wallet Adapter dependencies.
- Production release is triggered only after the dependency lock is synchronized.
- Android Chrome UAT remains the final runtime acceptance check after Vercel reports READY.
