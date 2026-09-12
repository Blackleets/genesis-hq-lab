# Genesis Cross-Exchange Arbitrage Shadow v1

Date: 2026-09-12

## Goal

Run a new, isolated research lane for cross-exchange crypto arbitrage while leaving futures v9 running unchanged in PAPER.

The first implementation is intentionally simple and strict:

- spot-vs-spot cross-exchange price dislocations
- real L2 order books through ccxt
- same-symbol comparison across Binance, Bybit and OKX
- VWAP across visible depth, not top-of-book fantasy
- exchange taker fees when exposed by ccxt
- explicit rebalance-cost budget required before any net edge can be called positive
- no transfers assumed instantaneous
- no order placement
- executionAuthority=false
- mode=SHADOW

## How the SOL 102 / 103 example actually works

If SOL can really be bought on Bybit at an executable ask near 102 and sold on Binance at an executable bid near 103, the gross spread is about 0.98%.

But the real test is:

sell proceeds
- buy cost
- buy fee
- sell fee
- depth/slippage
- rebalance/transfer cost
= net arbitrage PnL

You also need capital/inventory pre-positioned on both venues. Waiting to buy on Bybit, transfer SOL to Binance, then sell is usually too slow for short-lived arbitrage.

## Why this is different from the existing L2 spread scanner

The existing `l2SpreadScanner.mjs` measures bid/ask spread inside one venue. That is useful market-microstructure data, but it is not a guaranteed cross-exchange arbitrage.

This module compares the actual ask-side VWAP on the buy venue against the actual bid-side VWAP on a different sell venue.

## Safety boundary

This branch does not modify:

- futures v9
- adaptive profit ratchet
- TP/SL
- sizing
- execution scheduler
- LIVE locks

The v9 research lane can continue accumulating PAPER evidence independently.

## Run

```bash
npm run arb:shadow
```

Optional environment variables:

```
GENESIS_ARB_NOTIONAL_USD=1000
GENESIS_ARB_REBALANCE_BPS=<explicit audited budget>
GENESIS_ARB_MAX_BOOK_AGE_MS=3000
```

If rebalance cost is unknown, the scanner refuses to call the opportunity net-profitable.

## Promotion rule

No live execution. A future PR for execution is justified only after a sufficiently large SHADOW dataset shows recurring positive net edge after all known costs and realistic depth.
