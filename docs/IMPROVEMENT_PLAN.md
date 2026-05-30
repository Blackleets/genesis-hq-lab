# Genesis HQ — Improvement Plan

Honest review of the current build + a prioritized roadmap. Grounded in what the code
actually does today, not what we hope it does.

---

## A. Where we actually are (review)

### ✅ Real and working
- **Paper trading pipeline** (`trading/workflow.mjs`): SCAN→QUALIFY→VETO→DEBATE→SIZE→EXECUTE,
  end-to-end, with real Polymarket data.
- **Learning engine** (`memory/learningEngine.mjs`): lessons from losses, mistake patterns, vetoes.
- **Treasury + risk** (`trading/treasury.mjs`, `riskManager.mjs`): Kelly sizing, 12 risk checks,
  drawdown pause, reinvestment buckets.
- **Analytics**: Brier, Sharpe, calibration.
- **Founder command system** (`command/`): NL → org-state, agents obey.
- **Research** (`research/`): free news + Hacker News signals, scored, stored.
- **SkillOpt Phase 1** (`skills/`): 5 skill.md, loader, validator (rejects risk tampering),
  trajectory export, version ledger.
- **Single `npm start`**: server + agent + web together.
- **Live Panel**: the Dashboard's AgentLivePanel shows real treasury + open trades.

### 🟡 Built but not surfaced / half-wired
- **Marketing agent** runs every 6h and writes `data/memory/marketing.json`, but there is
  **no `/api/agent/marketing` endpoint** and no UI reads it. Content is generated into a void.
- **Research** runs inline in the debate, not as a visible department. Signals are stored
  but no UI shows them (endpoint exists: `/api/agent/signals`).
- **Skill versions** have an endpoint (`/api/agent/skills`) but no UI.

### 🔴 The honest gaps
1. **The UI mostly lies.** Only the Panel reads live data. `MarketsView`, `Decisions`,
   `Progress`, `MarketingView`, `TechView`, `Wallet` all read the **Zustand mock store** —
   they show simulated positions, not the real agent's trades. This is why "no veo a los
   agentes generar dinero" — the place you'd look (Mercados) shows fake data.
2. **Kalshi is a stub.** Returns `[]` without `KALSHI_API_KEY`. Only Polymarket is real,
   yet the UI says "Polymarket + Kalshi". Dishonest by omission.
3. **No 24/7 runtime.** The agent only runs while your machine is on and `npm start` is up.
   Markets resolve over days/weeks — if the process isn't always on, resolutions are missed,
   trades never close, and **SkillOpt Phase 2 never gets data**. This is the silent killer.
4. **No CEO orchestrator, no sentinel.** `org-state` is set only by founder commands; nothing
   autonomously rebalances departments or enforces health between ticks.
5. **Zero tests.** Money-touching logic (treasury, riskManager, validateSkill) is verified
   only by hand. One refactor can silently break the 5% cap or the drawdown pause.
6. **Intelligence is in fallback.** Without Claude credits the debate is pure rules — the
   whole point (reasoned Bull/Bear/Arbiter) is dormant.
7. **No `.env.example`** documenting `ANTHROPIC_API_KEY`, `KALSHI_API_KEY`, `PORT`.

---

## B. Prioritized roadmap

Ordered by **impact on the north star** (agents visibly learn + earn paper PnL),
cheapest-first, no fantasy.

### P0 — Make the UI tell the truth (1–2 days, $0)
The founder must SEE reality everywhere, not just the Panel.
1. **Wire `MarketsView` to live data** — replace `usePositions()` (mock) with `useAgentData()`
   open/closed trades from the backend. Show real entry price, confidence, PnL, evidence.
2. **Add a Research panel** — surface `/api/agent/signals` (already exists) so the founder
   sees the news/HN sentiment feeding decisions.
3. **Add a Skills panel** — surface `/api/agent/skills` (exists): version, status, metrics.
4. **Honesty fix**: label Kalshi "coming soon" until it's real, or implement it (P1).

### P1 — Keep it alive 24/7 + finish the data sources (2–4 days, ~$0–5/mo)
Without continuous runtime, nothing resolves and learning stalls.
5. **Deploy the backend to an always-on cheap host** (Fly.io / Railway free tier, or a $5
   VPS). Persist `data/genesis.db` on a volume. The agent ticks every 5 min, 24/7.
6. **Structured logger + `/api/agent/health` heartbeat** so you can confirm it's alive
   (last tick time, trades open, errors) from the dashboard or phone.
7. **Kalshi for real or removed.** Kalshi now needs auth; either wire `KALSHI_API_KEY`
   properly (their demo/elections API) or drop the claim. No half-truths.
8. **`/api/agent/marketing` endpoint + MarketingView wire-up** so generated content is visible
   and approvable (it already generates — just surface it).

### P2 — Close the intelligence + coordination loop (3–5 days, ~$3/mo)
9. **Claude credits** ($5–10) — flips debate from rules to reasoning. Highest single-dollar
   ROI in the project.
10. **CEO orchestrator** (`server/agents/ceoAgent.mjs`) — cheap rules first: reads capital,
    drawdown, signals, win-rate → sets dept focus + risk in org-state autonomously between
    founder commands. AI optional later.
11. **Sentinel** (`server/agents/sentinel.mjs`, no AI) — 1-min health loop: enforce drawdown
    pause, flag stale open trades, surface anomalies. Pure logic, $0.

### P3 — Durability + evolution (ongoing)
12. **Tests for money logic** — unit tests on `treasury.kellySize`, `riskManager.preTradeCheck`,
    `validateSkill` (the 5% cap, drawdown pause, locked-constraints rejection). These guard
    the rules that protect capital. ~1 day, prevents silent regressions forever.
13. **SkillOpt Phase 2** — once ~50 trades resolve (gated by P1 #5), run the weekly optimizer
    with Haiku or local Ollama; deploy validated skill upgrades.
14. **Bundle split + a11y pass** — 1.15MB JS chunk → code-split; accessibility audit. Cosmetic,
    do last.

---

## C. The single most important thing

**P0 #1 + P1 #5 together.** Right now the founder can't trust the UI (it shows mock data)
and the agent isn't always on (so nothing resolves). Fix those two and Genesis HQ becomes a
real, observable, continuously-learning system. Everything else is enhancement.

> One-line: *make the screen show the truth, and keep the engine running — then add brains.*

---

## D. Suggested next sprint (this week)

```
Day 1   P0 #1  MarketsView → live agent trades         (highest visible impact)
Day 1   P0 #2  Research signals panel
Day 2   P0 #3  Skills panel  +  P0 #4 Kalshi honesty label
Day 3   P1 #5  Deploy backend to Fly.io free tier, DB on volume, 24/7
Day 4   P1 #6  Health heartbeat + structured logs
Day 5   P2 #9  Load Claude credits, verify real debates  +  P2 #11 Sentinel
```

Outcome by end of week: a 24/7 agent whose real trades, signals, and skills are all visible
in the UI, debating with real reasoning, protected by a sentinel — the actual product.
