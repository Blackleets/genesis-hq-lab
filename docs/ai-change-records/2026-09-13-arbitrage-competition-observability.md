# 2026-09-13 — GPT-5.6 Sol

- Branch: `experiment/arbitrage-competition-observability`
- Summary: Added descriptive competition telemetry for pre-capture-ready arbitrage routes, fixed the capture-readiness blocker set to include unknown inclusion evidence, and exposed survival/edge-decay measurements without fabricating inclusion probability. No wallet, signer, transaction submission, LIVE unlock, futures v9, ratchet, TP/SL, sizing or execution-scheduler behavior was changed.
- Files touched: `server/genesis/mevCaptureReadiness.mjs`, `server/genesis/mevCompetitionObserver.mjs`, `server/genesis/mevShadowWorker.mjs`, `server/genesis/mevRadarState.mjs`, `server/tests/mevCompetitionObserver.test.mjs`, `package.json`, `.github/workflows/mev-shadow-v2.yml`, `docs/ARBITRAGE_COMPETITION_OBSERVABILITY.md`.
- Verification: pending GitHub Actions (`npm run mev:shadow:test` + `npm run build`).
- Changelog note: `docs/CHANGELOG_AI.md` remains unsafe to round-trip through the active GitHub connector because it is not returned as usable UTF-8. This isolated UTF-8 record preserves the audit trail without overwriting the canonical file.
