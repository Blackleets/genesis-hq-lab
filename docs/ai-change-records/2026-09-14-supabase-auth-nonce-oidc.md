# AI change record — Vercel OIDC → Supabase auth nonce fallback

Date: 2026-09-14
Branch: `feat/genesis-life-os`

## Goal
Remove the owner-login dependency on a long-lived Supabase service key inside Vercel while preserving single-use, server-side nonce persistence across serverless functions.

## Supabase
- Added `public.genesis_auth_nonces`, a dedicated server-only table with RLS enabled, SHA-256 nonce hashes, strict chain/TTL constraints, and an expiry index.
- Deployed Edge Function `genesis-auth-nonce`.
- The Edge Function has Supabase gateway JWT verification disabled only because it implements custom Vercel OIDC verification itself.
- It accepts only short-lived OIDC tokens issued to Vercel team `nfyns-projects-b0cc0f41`, project `genesis-hq-lab`, environments production/preview.
- Raw nonces are never persisted; the Edge Function stores only SHA-256 hashes.
- No public RLS policies were added. Database access remains service-role-only inside the Edge Function.

## Genesis backend
- The configured durable store remains first priority.
- Local development keeps the in-memory nonce store.
- Production without a configured durable store falls back only for owner-auth nonces to the OIDC-authenticated Supabase Edge Function.
- Telegram credentials, bot state, trading state and execution state do not use this fallback.

## Safety
No transaction signing, token approval, LIVE enablement, trading logic, strategy logic or execution authority changed.

## Verification
Supabase migration applied and Edge Function version 1 is ACTIVE. Vercel production deployment is pending because the Hobby account is currently rejecting new builds with its build-rate-limit guard.
