# MEV Autonomous Radar — isolated change record

Date: 2026-09-12
Branch: `experiment/mev-autonomous-radar`

## Summary

Added a read-only Ethereum arbitrage radar on top of the existing benign MEV shadow research lane. The radar reads same-block DEX quotes, models conservative costs, persists append-only shadow evidence, publishes a compact non-secret snapshot for the UI, and keeps every execution gate closed until exact atomic simulation and measured inclusion/liquidity evidence exist.

The board room now prioritizes a clean **Arbitrage Radar** surface. Internal research enums remain unchanged in the backend, while the UI uses human-readable states such as `OBSERVING`, `QUALIFIED`, and `FILTERED`. Directional/funding research remains available in the background instead of being deleted.

## Safety

- `mode=SHADOW`
- `executionAuthority=false`
- no wallet or private-key handling
- no signing or transaction submission
- no LIVE unlock
- v9 strategy/execution logic unchanged
- ratchet, TP/SL, sizing, and execution scheduler unchanged
- unknown atomicity, simulation, inclusion probability, and liquidity confidence fail closed

## Files

- `server/genesis/mevOnchainRadar.mjs`
- `server/genesis/mevShadowWorker.mjs`
- `server/genesis/mevRadarState.mjs`
- `server/tests/mevOnchainRadar.test.mjs`
- `api/mev/radar.js`
- `src/components/trading/ArbitrageRadarPanel.tsx`
- `src/workflows/WorkScreen.tsx`
- `src/workflows/EdgeScorecardView.tsx`
- `.env.example`
- `package.json`
- `.github/workflows/mev-shadow-v2.yml`
- `docs/MEV_ARBITRAGE_SHADOW.md`

## Verification

Dedicated GitHub Actions runs syntax checks, focused MEV tests, and the production build. The canonical `docs/CHANGELOG_AI.md` could not be safely edited through the GitHub connector because it is currently returned as non-UTF-8/binary content; this isolated UTF-8 change record avoids corrupting that file.
