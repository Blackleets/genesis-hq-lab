# Genesis Profit Company OS

Status: design + paper execution layer. This is not live trading approval.

## Founder intent

Genesis exists to make money, but it must earn the right to touch real capital. The product should feel like a professional trading company and exchange terminal, not a decorative pixel game.

The app must answer four questions instantly:

1. Are we making or losing money?
2. Which desk is creating or destroying edge?
3. Which agents are working and what data do they trust?
4. What exact gate blocks real capital?

## Operating model

Genesis is organized as a quant company:

- **Command Center**: exchange-grade cockpit for P&L, opportunities, desks, connectors, and agents.
- **Truth Ledger**: source of truth for economic P&L.
- **Hermes**: connector operator. Owns data/API status and routing.
- **Atlas**: quant researcher. Finds hypotheses and cross-market opportunities.
- **Oracle**: market intelligence. Classifies regimes and sessions.
- **Forge**: strategy factory. Generates challengers.
- **Sentinel**: risk governor. Blocks unsafe or overfit systems.
- **Auditor**: truth/reconciliation agent. Prevents false reward signals.

## Markets to cover

### Crypto

- Spot and perpetual futures.
- Funding-rate carry.
- Basis / spread opportunities.
- Momentum and mean reversion on majors.
- Microstructure capture only when fees, spread, and adverse selection are honest.

### Forex

- Asia, London, New York, and rollover sessions.
- Major pairs first: EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD.
- No claimed P&L until broker feed, commissions, spread, slippage, and session calendar are wired.

### Prediction markets

- Kalshi / Polymarket only when liquidity, settlement risk, and fees are modeled.
- Read-only scout before any execution.

## UI standard

The interface should feel like a professional exchange terminal:

- Dark high-contrast shell.
- Top-level PAPER / LIVE OFF / NO GO indicators.
- P&L bridge, not vanity charts.
- Market/opportunity table with blockers.
- Agent floor with real states.
- Connector rack with online / gated / pending status.
- Pixel office only as a compact visual metaphor, never as the main product.

## Hard trading rules

1. No real capital without explicit human approval.
2. No live execution from UI buttons alone.
3. No agent may be rewarded by an incomplete P&L metric.
4. Every opportunity must include costs, slippage assumptions, sample size, and failure reason.
5. Forex and broker execution are connector-gated until live feed + cost model exists.
6. Promotion requires evidence: out-of-sample, walk-forward, enough trades, profit factor, expectancy, t-stat, drawdown, and live/paper reconciliation.

## ASTRA readiness

GPT-6 Astra or any stronger model should be used only after Genesis has:

- Truth Ledger v2 merged.
- Command Center exposing real blockers.
- Agent Genome with roles and rewards.
- Connector permissions separated into read, paper, testnet, and real.
- Champion/challenger evolution where challengers cannot replace champions without evidence.

ASTRA's first job should not be live trading. Its first job should be to operate the research company: generate hypotheses, run tests, summarize failures, improve agents, and propose safe challengers.

## Approval standard

The founder can approve the move to ASTRA build mode when:

- The app clearly shows current profitability.
- The user cannot confuse paper P&L with real money.
- Agents are visible as operators with missions and blockers.
- Live execution is locked by default.
- The next build slice has a measurable output.

Recommended next slice: **ASTRA Agent Genome v1 + Hermes Connector Registry**.
