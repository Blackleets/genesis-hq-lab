# Railway Arbitrage SHADOW deployment

- Branch: `deploy/arbitrage-shadow-railway`
- Purpose: isolate the read-only Ethereum Arbitrage Radar worker for Railway cron execution.
- Start command: `npm run mev:radar:resilient:once`
- Schedule: every 5 minutes on Railway free-plan cron.
- Safety: SHADOW only; `executionAuthority=false`; no wallet, signing, broadcast, or LIVE unlock.
- Runtime note: Render remains billing-suspended, so Railway is being used as a temporary observation host.
- Deployment recovery: a fresh Railway service (`genesis-arbitrage-shadow-runner`) was attached to this branch after the first service produced only skipped cron runs. This commit intentionally gives Railway a post-attachment branch update so the GitHub webhook can create the first build snapshot.