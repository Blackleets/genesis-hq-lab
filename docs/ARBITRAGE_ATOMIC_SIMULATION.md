# Arbitrage Atomic Simulation

The Arbitrage Radar must not confuse a same-block price discrepancy with a capturable transaction.

This layer adds a second proof boundary:

```text
same-block quotes
      ↓
route economics
      ↓
allowlisted executor eth_call
      ↓
measured final output + estimated gas
      ↓
simulation proof hash
      ↓
remaining capture gates
```

## Safety

Atomic simulation remains read-only:

- `executionAuthority=false`
- no private key
- no wallet signing
- no transaction broadcast
- no LIVE unlock
- futures v9 remains untouched

The simulator calls a separately configured executor through `eth_call` / `estimateGas` semantics only.

## Narrow executor interface

The simulator deliberately does **not** accept arbitrary call targets or arbitrary calldata.

The expected executor ABI accepts:

- input token
- intermediate token
- input amount
- allowlisted buy venue code
- validated fee tier
- allowlisted sell venue code
- validated fee tier
- minimum final amount
- deadline

Current venue codes:

- `1` — Uniswap V3
- `2` — SushiSwap V2

Uniswap V3 fee tiers are restricted to known tiers. SushiSwap V2 uses fee value `0` in the request because pool economics are embedded in the router output.

This reduces the future executor's attack surface compared with a generic `target + calldata` router.

## Fail-closed behavior

A route is not upgraded to atomic evidence when any of these are true:

- executor address missing
- executor address invalid
- route contains an unknown venue code
- fee tier is not allowlisted
- request is malformed
- `eth_call` reverts
- returned output is invalid
- gas estimate is invalid
- gas estimate exceeds the configured ceiling

A successful simulation records:

- exact block
- executor address
- final token output
- measured gas units
- deterministic SHA-256 simulation proof

The proof binds block, route, request, output and gas estimate so later evidence can be replayed and compared without relying on a screenshot.

## Important: simulation is still not capture

Even exact atomic simulation does **not** prove that Genesis can win the opportunity against competing searchers.

Therefore these gates remain independent:

- inclusion probability
- liquidity confidence
- expected PnL after failed attempts
- stress economics

The integration test explicitly proves that a route with successful atomic simulation remains **Filtered** until the remaining capture evidence is measured.

## Configuration

```text
GENESIS_MEV_EXECUTOR_ADDRESS=
GENESIS_MEV_SIMULATION_FROM=
GENESIS_MEV_MAX_SIM_GAS_UNITS=1200000
```

`GENESIS_MEV_SIMULATION_FROM` is an address identity for simulation only. No private key is required or accepted by this module.

## Deployment boundary

No executor is deployed by this branch. Until an audited executor compatible with the narrow ABI is configured, the radar continues collecting same-block evidence and records atomic simulation as unavailable.
