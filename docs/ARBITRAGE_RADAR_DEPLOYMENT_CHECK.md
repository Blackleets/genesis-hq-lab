# Arbitrage Radar deployment verification

Before merging into the production branch `feat/genesis-life-os`:

1. GitHub Actions production build passes.
2. MEV-focused tests pass.
3. Vercel preview no longer reports `exceeded_serverless_functions_per_deployment`.
4. The Trading workspace visibly renders `Arbitrage Radar` on mobile and desktop.
5. The radar endpoint returns only SHADOW evidence and never grants execution authority.
6. `LIVE LOCKED`, futures v9, ratchet, TP/SL, sizing, and execution scheduler behavior remain unchanged.
