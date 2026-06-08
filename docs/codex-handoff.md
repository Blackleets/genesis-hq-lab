# Codex Handoff — Genesis HQ remaining work

Context for a collaborating coding agent (Codex). The backend for Phase 3 (auto-veto /
convergence) is **done and deployed**; what remains is mostly UI surfacing + Phase 4 (autonomous
agent delegation). Everything below is additive and must NOT touch: execution engine, risk engine,
safe mode, daily caps, Kelly sizing, paper-trading, or the synchronous better-sqlite3 hot path.

## What already exists (do not rebuild)

- **Durable persistence (live):** `server/persistence/dbReplicator.mjs` replicates SQLite → Supabase
  every 5s; `GET /api/db/health` shows status. `DB_MODE=hybrid`, `DATABASE_URL` set in Render.
- **Regime bias (Phase 6B.1):** `server/crypto/regime.mjs` (`classifyRegime`, `applyRegimeBias`).
  Trades are tagged `REGIME:<regime>` in their `evidence` JSON at entry.
- **Auto-veto + confidence honesty (Phase 6B.1A backend):** `server/crypto/autoVeto.mjs`
  - `getAutopsy()` → `{ config, setups[], topLosers[], topWinners[], vetoes[] }`, exposed at
    `GET /api/crypto/diagnostics` under `autopsy`.
  - `isSetupVetoed(side, regime)` + `confidenceCap(side, regime)` are already wired into
    `scalpingEngine.evaluateScalpSignal` (confidence gate only). A vetoed candidate gets reason
    `SETUP_VETOED` in the scan snapshot.
- **Execution telemetry:** `GET /api/crypto/diagnostics` (loops, gates, scanSnapshot w/ regime,
  regimePerformance, autopsy). Heartbeat is cross-process via `server/trading/schedulerHeartbeat.mjs`.
- **Client types:** `src/services/cryptoClient.ts` — extend interfaces here (don't invent new clients).

## Task A — Phase 3 UI: Autopsy / vetoes panel (frontend)

Surface `diagnostics.autopsy` so the operator sees what Genesis stopped trading.

- Extend `ExecutionDiagnostics` in `src/services/cryptoClient.ts` with:
  `autopsy?: { config:{minSamples:number;pfThreshold:number;windowDays:number};
   setups: SetupStat[]; topLosers: SetupStat[]; topWinners: SetupStat[]; vetoes: SetupStat[] }`
  where `SetupStat = { key; side; regime; samples; winRate:number|null; expectancy:number;
   profitFactor:number; pnl:number; avgConfidence:number|null; reason?:string }`.
- Add a `LEARNING` tab (or a section in `DeskPanel` STATS) rendering:
  - **TOP WINNERS** (green) and **TOP LOSERS** (red): `key · n=samples · WR · EV · PF`.
  - **ACTIVE VETOES** (amber): each veto row with its `reason` (e.g. `SHORT_STRONG_BULL · 24 trades
    · EV $-0.41 · PF 0.34 · WR 19%`) and a "disabled — adaptive, re-evaluates from data" note.
  - Empty state until setups reach `config.minSamples` (20). Poll = the existing diagnostics 10s.
- `EngineTelemetry.tsx` why-no-trade already renders `SETUP_VETOED` reason; add a clear label
  ("setup vetoed — proven negative") + show the veto stats from `autopsy.vetoes` matched by key.

## Task B — Chart polish (frontend, `src/dashboard/charts/CandleChart.tsx`)

Real-time price tick (8s) is already added. Remaining polish from operator feedback ("entries
clearer, more alive, professional, organized"):

- **Marker de-clutter:** when several trade markers fall on adjacent candles they overlap on the
  right edge. Group/space markers (e.g. only label the most recent N; show older ones as small
  dots; or offset text). `buildMarkers()` is the place. Keep the selected trade prominent.
- **Live candle emphasis:** subtle pulse/last-price line for the live bar (lightweight-charts
  `createPriceLine` on the candlestick series, updated by the 8s tick).
- **Entry/exit legend:** a tiny legend (▲ LONG / ▼ SHORT / ● TP / ● SL) so the markers read clearly.
- Keep performance: markers recompute only on `[tradeStories, pair, tf, selectedTradeId]`.

## Task C — Phase 4: autonomous multi-agent delegation (backend + thin UI)

Make the 5 real agents run autonomously and feed learning (see the approved plan
`~/.claude/plans/...` and `docs/superpowers/specs/`). New file
`server/agents/delegationOrchestrator.mjs`:

- A scheduled loop (mirror `server/trading/executionScheduler.mjs`’s structure: locks, try/catch,
  interval) on a LOW cadence (5–10 min), started from `server/agentRunner.mjs`, gated by
  `isDeptActive('research')`.
- Delegate recurring duties via the existing `server/agents/agentEngine.mjs` + `providerRouter.mjs`:
  ATLAS=market+web scan, NOVA=signal synthesis → `signals` table, SENTINEL=risk audit (read-only),
  CURATOR=lesson extraction (existing learning loop), ARBITER=decision log.
- **Social/network scan:** wire `server/research/*` (newsFeed, hackerNews, reddit) as autonomous
  inputs; persist extracted signals + accuracy to the `signals` table (already a durable table).
- Persist a heartbeat (reuse the `schedulerHeartbeat.mjs` pattern) and emit `operator_events` so the
  commentary feed shows agent activity. Expose `GET /api/agents/delegation` (loop status + last run
  per agent). Thin UI: a delegation status strip reusing `EngineTelemetry` patterns.
- Claude is optional: `providerRouter` already falls back to rule-based when no API key.

## Conventions (follow these — the codebase is consistent)

- Server: ES modules `.mjs`, synchronous `db.prepare().run/.get/.all` (better-sqlite3). Never make
  the hot path async. New durable tables → add to `dbReplicator.mjs` `DURABLE`.
- `logEvent({ category, severity, subsystem, reason, metadata })` (object form — never positional).
- Tests: `node --test` in `server/tests/*.test.mjs`; `serverSyntax.test.mjs` runs `node --check` on
  every server module (a duplicate import or syntax error fails CI).
- Validate: `npm run build` (tsc + vite) + `npm test` must stay green. Deploy: push `feat/genesis-life-os`
  and fast-forward `main`; Render auto-deploys the backend, Vercel the frontend.
- All new behavior is additive + dormant-safe (env-gated / data-gated) so it never destabilizes live
  paper trading.
