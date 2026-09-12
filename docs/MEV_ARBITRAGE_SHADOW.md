# Genesis MEV Arbitrage Shadow

This lane researches benign DEX arbitrage only. It is designed as an evidence machine first and an execution system never by default.

## Allowed scope

- atomic DEX-to-DEX arbitrage research
- pool-to-pool price dislocations
- backrun-style arbitrage that does not target a victim
- block-anchored quote comparison
- explicit gas, LP fee, slippage and flash-loan accounting
- SHADOW evidence and reproducible evaluation

## Explicitly excluded

- sandwich attacks
- victim-targeted transaction insertion
- mempool front-running
- transaction censorship
- private-key handling
- signing or submitting transactions

## Structural safety invariants

- `mode=SHADOW`
- `executionAuthority=false`
- no change to v9
- no change to ratchet, TP/SL or sizing
- no LIVE unlock
- no hidden fallback from unknown evidence to perfect confidence

## Evidence gates

A spread is not a candidate just because the raw price difference is positive. Every candidate must pass all of these gates:

1. route identity is explicit
2. chain is explicit
3. evaluation is anchored to a block
4. all material costs are known
5. the route is explicitly atomic
6. executor-level simulation explicitly succeeded
7. prohibited MEV tactics are absent
8. quote age is within the configured freshness window
9. block lag is within tolerance
10. gross economics are positive
11. buffered net economics are positive
12. minimum net edge is met
13. minimum net PnL is met
14. economics remain positive under gas/slippage stress
15. inclusion probability is measured and above threshold
16. liquidity confidence is measured and above threshold
17. expected net PnL remains positive after failed-attempt cost

Unknown evidence fails closed internally. The product UI presents those rows as **Filtered** instead of exposing internal research enum names.

## Real-block radar

`server/genesis/mevOnchainRadar.mjs` adds a read-only Ethereum mainnet radar.

Current route universe:

- USDC -> WETH -> USDC
- Uniswap V3 0.05%
- Uniswap V3 0.30%
- SushiSwap V2
- every ordered cross-venue pair, excluding self-comparisons

For every scan it:

1. reads a single Ethereum block number
2. obtains same-block on-chain quotes from each route adapter
3. chains the exact output of leg one into leg two
4. reads current gas price
5. derives an ETH/USD reference from same-block DEX quotes
6. applies a conservative whole-route gas budget and adverse-slippage reserve
7. records the observed route into the existing institutional evaluator

Pool fee and current price impact are already embedded in the router/quoter output and are not subtracted a second time.

### Important fail-closed boundary

Same-block quotes are **not** the same thing as an atomic executor simulation. Therefore the radar deliberately records:

- `atomic=false`
- `simulationSuccess=false`
- unmeasured inclusion probability = fail-closed
- unmeasured liquidity confidence = fail-closed

This prevents a visually attractive spread from being promoted before an exact executor transaction can be simulated on a fork or with `eth_call` against a real executor contract.

## Autonomous observer

`server/genesis/mevShadowWorker.mjs` can run the read-only radar continuously:

```bash
npm run mev:radar:once
npm run mev:radar:watch
```

The worker is **not** auto-started by importing the module and this branch does not create a daemon, cronjob, wallet or live executor. Deployment enablement remains a separate operator decision.

Every cycle writes:

- local heartbeat
- append-only shadow evidence
- compact read-only radar snapshot in the existing `org_state` KV table

The compact snapshot can follow the repository's existing replication path to Supabase without adding a new database schema or exposing RPC credentials.

## Dashboard surface

The board room now prioritizes **Arbitrage Radar**. It intentionally does not display engine version numbers or internal `NO_GO` enums.

Visible states are human-readable:

- `OBSERVING`
- `QUALIFIED`
- `FILTERED`
- `SHADOW`

Funding/directional research remains available in a collapsed background section instead of competing with the arbitrage focus.

The dashboard shows no sample economics. If the provider is missing it displays `Provider not configured`; if the endpoint is unavailable it displays `Backend offline — npm run start`.

## Evidence ledger

`server/genesis/mevShadowLedger.mjs` is the append-only SQLite evidence ledger.

It records both qualified and filtered evaluations so the research process cannot hide failures. Stored fields include:

- route fingerprint
- chain/block
- tokens and DEX venues
- amount
- gross PnL
- total modeled costs
- buffered net PnL
- stress net PnL
- expected net PnL
- net edge bps
- robustness score
- internal verdict and blockers
- complete original evaluation payload

All opportunity economics are **theoretical**. They are never presented as realized account balance or realized profit.

## Configuration

```text
GENESIS_MEV_RPC_URL=
GENESIS_MEV_NOTIONAL_USD=1000
GENESIS_MEV_ROUTE_GAS_UNITS=450000
GENESIS_MEV_SLIPPAGE_RESERVE_BPS=10
GENESIS_MEV_FLASH_LOAN_BPS=0
GENESIS_MEV_SCAN_INTERVAL_MS=12000
```

Do not commit provider keys. `GENESIS_MEV_RPC_URL` belongs in deployment secrets/environment configuration.

## Next evidence milestone

The remaining critical boundary is exact atomic executor simulation plus measured inclusion/liquidity evidence. Until those exist, real-block observations are valuable research data but remain filtered from execution. Only a large dataset with recurring positive expected and stress-adjusted economics should justify discussing a micro-live executor.
