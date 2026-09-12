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
4. re-quotes the exact route at a larger same-block notional to measure liquidity
5. reads current gas price
6. derives an ETH/USD reference from same-block DEX quotes
7. applies a conservative whole-route gas budget and adverse-slippage reserve
8. optionally runs an exact read-only executor simulation when a compatible executor is configured
9. records the resulting evidence into the institutional evaluator

Pool fee and current price impact are already embedded in the router/quoter output and are not subtracted a second time.

## Atomic simulation proof layer

`server/genesis/mevAtomicSimulator.mjs` adds an executor-level proof boundary.

The simulator uses only `eth_call`/gas estimation semantics. It has no signer and cannot broadcast transactions. It also rejects arbitrary target+calldata execution: the expected executor interface accepts only allowlisted venue codes and validated fee tiers.

When a compatible executor is configured, every attempted route can produce:

- exact simulation block
- exact final output amount
- measured gas units
- deterministic SHA-256 proof binding route + request + block + output + gas

A revert, invalid output, malformed route, unknown venue, unsupported fee tier or excessive gas fails closed. If no executor is configured, the radar continues collecting same-block quote and liquidity evidence but leaves the atomic gate closed.

See `docs/ARBITRAGE_ATOMIC_SIMULATION.md`.

## Same-block liquidity proof

`server/genesis/mevLiquidityProof.mjs` measures whether the apparent edge survives larger size on the **same route and same block**.

Default policy:

- probe size = 2x the base notional
- <= 5 bps adverse route-efficiency degradation = full liquidity confidence
- >= 50 bps degradation = zero liquidity confidence
- confidence decays linearly between those points

A failed or malformed probe leaves liquidity confidence at zero; it does not erase the base observation. The thresholds are fixed policy values, not optimized against realized winners.

See `docs/ARBITRAGE_LIQUIDITY_PROOF.md`.

### Important fail-closed boundary

Same-block quotes are not an atomic executor simulation. Atomic simulation is not liquidity proof. And passing both still does **not** prove Genesis can win the opportunity against competing searchers.

The major remaining independent requirement is measured inclusion/competition evidence. Until that exists, inclusion probability stays fail-closed.

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
- liquidity probe telemetry
- atomic simulation telemetry when configured

The compact snapshot can follow the repository's existing replication path to Supabase without adding a new database schema or exposing RPC credentials.

## Dashboard surface

The board room prioritizes **Arbitrage Radar**. It intentionally does not display engine version numbers or internal `NO_GO` enums.

Visible states are human-readable:

- `OBSERVING`
- `QUALIFIED`
- `FILTERED`
- `SHADOW`

Funding/directional research remains available in a collapsed background section instead of competing with the arbitrage focus.

The dashboard shows no sample economics. If the provider is missing it displays `Provider not configured`; if the endpoint is unavailable it displays `Backend offline — npm run start`.

## Evidence ledger

`server/genesis/mevShadowLedger.mjs` is the append-only SQLite evidence ledger. It records both qualified and filtered evaluations so the research process cannot hide failures, including route identity, chain/block, economics, stress economics, robustness, blockers and the complete evaluation payload with atomic/liquidity evidence when present.

All opportunity economics are **theoretical**. They are never presented as realized account balance or realized profit.

## Configuration

```text
GENESIS_MEV_RPC_URL=
GENESIS_MEV_NOTIONAL_USD=1000
GENESIS_MEV_ROUTE_GAS_UNITS=450000
GENESIS_MEV_SLIPPAGE_RESERVE_BPS=10
GENESIS_MEV_FLASH_LOAN_BPS=0
GENESIS_MEV_SCAN_INTERVAL_MS=12000
GENESIS_MEV_EXECUTOR_ADDRESS=
GENESIS_MEV_SIMULATION_FROM=
GENESIS_MEV_MAX_SIM_GAS_UNITS=1200000
GENESIS_MEV_LIQUIDITY_PROBE_MULTIPLIER=2
GENESIS_MEV_LIQUIDITY_FULL_BPS=5
GENESIS_MEV_LIQUIDITY_ZERO_BPS=50
```

Do not commit provider keys. `GENESIS_MEV_RPC_URL` belongs in deployment secrets/environment configuration. The simulator does not accept or require a private key.

## Next evidence milestone

The next critical boundary is **capture probability / competition**, not another indicator. Genesis now has a path for same-block route evidence, size-stress liquidity evidence and optional exact atomic simulation. The next layer must measure inclusion from real shadow/builder evidence rather than invent a probability. Until that exists, routes remain filtered from execution.
