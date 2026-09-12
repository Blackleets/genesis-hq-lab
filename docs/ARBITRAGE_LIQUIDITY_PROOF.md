# Arbitrage Liquidity Proof

A quoted spread can be real and still be economically useless at the size Genesis wants to trade. The radar therefore measures route capacity instead of assuming liquidity from volume labels.

## Method

For every base route observation, Genesis re-quotes the **same buy/sell path on the same Ethereum block** at a larger input size.

Default policy:

```text
base notional      = 1.0x
probe notional     = 2.0x
full confidence    <= 5 bps adverse efficiency change
zero confidence    >= 50 bps adverse efficiency change
```

The evidence metric is route efficiency:

```text
efficiency = final output / input
adverse impact bps = max(0, (base efficiency - probe efficiency) / base efficiency * 10,000)
```

Confidence is 1.0 at or below the full-confidence impact, 0.0 at or above the zero-confidence impact, and linear between those fixed policy points.

## Why same block matters

If the larger quote came from a later block, ordinary market movement could be misread as price impact. Both sizes therefore use the same anchored block and exact ordered route.

## Fail-closed behavior

Liquidity confidence remains zero when:

- the larger quote fails
- the probe is not actually larger
- any input/output observation is invalid
- route efficiency cannot be measured

A failed liquidity probe does not erase the base observation. The base route remains in the evidence ledger with the liquidity gate closed.

## Independence from other gates

Passing liquidity proof does not imply a route is capturable. Atomic simulation, inclusion probability, stress economics and the other evidence gates remain independent.

The integration test explicitly verifies that a route can pass the liquidity gate and still remain filtered because inclusion/competition evidence is not yet measured.

## Configuration

```text
GENESIS_MEV_LIQUIDITY_PROBE_MULTIPLIER=2
GENESIS_MEV_LIQUIDITY_FULL_BPS=5
GENESIS_MEV_LIQUIDITY_ZERO_BPS=50
```

These are policy parameters, not values optimized against realized outcomes.

## Safety

This layer is read-only. It adds extra same-block quote calls only. It does not add a wallet, signer, transaction submission path, execution authority or LIVE enablement.
