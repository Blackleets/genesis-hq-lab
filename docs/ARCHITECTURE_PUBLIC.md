# Genesis HQ — Public Architecture

This document is the contributor-facing map of Genesis. It intentionally focuses on system boundaries rather than every internal module.

## Design objective

Genesis separates four concerns:

1. **observe** real markets;
2. **research** possible edge;
3. **validate** economics and robustness;
4. **execute only inside the allowed safety mode**.

Research code should not gain real-capital authority by accident.

## Top-level flow

```text
Market data
    │
    ├── Binance / CCXT / derivatives
    ├── OKX research + RPI book
    ├── EVM DEX quotes / RPC
    ├── Solana read-only quote / RPC paths
    └── other public research sources
    │
    ▼
Evidence capture
    │
    ├── timestamps / freshness
    ├── provider provenance
    ├── durable JSONL / DB evidence
    └── integrity checks
    │
    ▼
Research lanes
    │
    ├── Futures / systematic signals
    ├── Cross-market / lead-lag
    ├── DEX / MEV arbitrage
    ├── Maker microstructure
    └── Regime / positioning studies
    │
    ▼
Economic truth layer
    │
    ├── fees
    ├── slippage
    ├── failed-attempt cost
    ├── fill realism
    ├── adverse selection
    ├── inventory risk
    └── drawdown / capital constraints
    │
    ▼
Validation
    │
    ├── replay
    ├── OOS
    ├── walk-forward
    ├── sequential validation
    └── sealed holdout
    │
    ▼
PAPER / SHADOW
    │
    ▼
LIVE_LOCKED
```

## Research lanes

### Futures and systematic research

Core areas live primarily under:

- `server/crypto/`
- `server/genesis/backtestCore.mjs`
- `server/genesis/evalCandidate.mjs`
- research/validation modules under `server/genesis/` and `server/research/`

The important contract is that signal generation and economic validation are separate concerns.

### DEX / MEV arbitrage

Relevant modules include:

- `server/genesis/mevArbitrageShadow.mjs`
- `server/genesis/mevShadowEngine.mjs`
- `server/genesis/mevOnchainRadar.mjs`
- `server/genesis/mevAtomicSimulator.mjs`
- resilient worker, liquidity, competition and preflight modules

The lane is designed around **net capturable edge**, not gross spread.

Atomicity, quote age, costs, liquidity, simulation and inclusion assumptions can block a candidate.

### Maker microstructure

Relevant modules include:

- `server/genesis/okxRpiOrderBook.mjs`
- `server/genesis/rpiOrderBookCapture.mjs`
- `server/genesis/makerMicrostructureShadow.mjs`
- `server/research/rpiDepthImbalanceStudy.mjs`

The current maker lane is research-only.

It explicitly rejects the shortcut:

`market traded through quote -> assume our order filled`

Instead, it requires queue-aware evidence and empirical calibration.

### Synchronized research state

`server/genesis/researchStateCapture.mjs` and related adapters build durable market-state observations with provider provenance and freshness budgets.

These snapshots support causal or forward research without letting future information leak into the decision point.

## Hot path vs validation path

Latency-sensitive discovery should remain thin:

```text
FAST PATH
market update
  -> feature / quote extraction
  -> gross candidate
  -> timestamp
```

Expensive evidence work belongs outside that critical path:

```text
VALIDATION PATH
candidate
  -> simulation
  -> liquidity
  -> costs
  -> fill / inclusion probability
  -> adverse selection
  -> risk
  -> durable evidence
  -> notification / UI
```

A fast bad decision is still a bad decision. The point of the split is to avoid wasting latency on logging while preserving economic gates before promotion.

## Data integrity

A useful evidence object should make these questions answerable:

- Where did the data come from?
- When did the exchange/source say it existed?
- When did Genesis capture it?
- How old was it?
- Was it complete enough for the study?
- Can the feature be recomputed?
- Did any later observation leak into the decision?

If not, it should not be promotion evidence.

## Persistence

Genesis uses a mix of:

- SQLite for local/hot-path state;
- optional Supabase/Postgres replication;
- JSON/JSONL evidence tapes for reproducible research;
- GitHub Actions for scheduled evidence capture and CI.

Persistence strategy differs by subsystem. New work should preserve clear ownership of each source of truth.

## UI

The React/Vite HQ is a visualization surface, not the source of trading truth.

Trading metrics should come from backend/evidence sources. UI components must not invent live values.

Before UI work, read `docs/DESIGN_DIRECTION.md`.

## Extension pattern

A new research module should ideally have:

```text
adapter / evidence capture
        ↓
pure feature functions
        ↓
predeclared research rule
        ↓
economic model
        ↓
tests
        ↓
durable report
```

Only after sufficient forward evidence should promotion even be discussed.

## Execution boundary

Current contributor-facing rule:

**Do not add real-money authority as part of an ordinary research PR.**

Execution changes require a separate, explicit human decision and a dedicated security/risk review.
