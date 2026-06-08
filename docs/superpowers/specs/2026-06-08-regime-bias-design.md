# Phase 6B.1 — Regime Bias Optimization — Design Spec

> Date: 2026-06-08. Approved. Surgical optimization — adaptive, no hardcoded direction.

## Problem
Live: 76 closed trades, 37% win rate, profit factor 0.38, expectancy -$0.31/trade, 27 false
positives, calibration 57/100. Hypothesis: Genesis trades bullish regimes too neutrally and
takes poor countertrend shorts. Fix: bias confidence by regime (soft, never hard-block).

## Principle
The regime bias ONLY modulates the **confidence** that feeds the existing gate (0.65). It never
touches risk engine, safe mode, daily caps, execution, paper logic, TP/SL, or Kelly sizing.
Regime is derived entirely from existing signals and stays adaptive.

## Files
| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `server/crypto/regime.mjs` | `classifyRegime(ctx)` + `applyRegimeBias(conf, side, regime)` + `BIAS` map |
| CREATE | `server/tests/regime.test.mjs` | classification + bias math + clamp |
| CREATE | `server/crypto/backtest/regimeBiasBacktest.mjs` | rigorous before/after replay over closed trades |
| MODIFY | `server/strategies/scalpingEngine.mjs` | apply bias to confidence; emit regime+bias; REGIME_MISMATCH reason; tag evidence |
| MODIFY | `server/strategies/swingEngine.mjs` | apply same bias helper to its signal confidence |
| MODIFY | `server/crypto/copilot.mjs` | classify regime + apply bias to copilot confidence; expose regime in analysis |
| MODIFY | `server/index.mjs` | diagnostics: add regime+bias to scanSnapshot pass-through + regimePerformance |
| MODIFY | `server/crypto/marketIntelligence.mjs` | `getRegimeBiasPerformance()` (side×regime win rate) for learning observability |
| MODIFY | `src/services/cryptoClient.ts` + `EngineTelemetry.tsx` | surface regime + bias in why-no-trade |

## Part 1 — Regime classification (`classifyRegime(ctx)`)
Uses only: HTF trend (`computeHtfTrend` from signal.mjs), EMA9/21 alignment, `change1h`
(momentum), `|change1h|` (volatility). No external deps.

```
emaSep = (ema9 - ema21) / ema21 * 100      // signed %
htf    = computeHtfTrend(closes, DEFAULTS) // bullish | bearish | neutral
mom    = change1h                          // %
vol    = |change1h|

if vol >= 2.5: return HIGH_VOLATILITY       // violent — penalize both sides

dir = 0
htf==='bullish' ? dir++ : htf==='bearish' ? dir-- : 0
emaSep >= 0.15  ? dir++ : emaSep <= -0.15 ? dir-- : 0
mom    >= 0.5   ? dir++ : mom    <= -0.5  ? dir-- : 0

dir >=  3 → STRONG_BULL
dir >=  1 → BULL
dir <= -3 → STRONG_BEAR
dir <= -1 → BEAR
else      → RANGE
```

## Part 2 — Directional bias (`applyRegimeBias(confidence, side, regime)`)
Modifiers in confidence points (mission-specified). Applied on the 0–1 scale (÷100). Clamped to
the engine's valid range [0, 0.92] — never exceeds system limits.

```
BIAS = {
  STRONG_BULL:     { LONG: +10, SHORT: -20 },
  BULL:            { LONG:  +5, SHORT: -10 },
  RANGE:           { LONG:   0, SHORT:   0 },
  BEAR:            { LONG: -10, SHORT:  +5 },
  STRONG_BEAR:     { LONG: -20, SHORT: +10 },
  HIGH_VOLATILITY: { LONG:  -5, SHORT:  -5 },
}
applyRegimeBias(conf, side, regime):
  mod = (BIAS[regime]?.[side] ?? 0) / 100
  return { confidence: clamp(conf + mod, 0, 0.92), regime, bias: BIAS[regime][side], original: conf }
```

## Integration
- **scalpingEngine.evaluateScalpSignal**: compute `regime` early (available in all returns).
  After computing raw `confidence`, `applyRegimeBias` → return `{ ..., confidence: biased,
  regime, bias, rawConfidence }`. The gate in runScalpingCycle uses the biased confidence.
- **swingEngine**: same helper on its signal confidence.
- **copilot.analyzeTrade**: classify regime from the fetched ctx, apply bias to the copilot
  confidence, add `regime` + `regimeBias` to the returned analysis.

## Part 3 — Why-not visibility
`runScalpingCycle` snapshot per asset gains `regime` + `bias`. New reason `REGIME_MISMATCH` when
`biasedConf < gate && rawConf >= gate` (the bias is what rejected it). Explainer renders:
```
BTC SHORT REJECTED
Reason: bullish regime mismatch
STRONG_BULL · short penalty -20 (conf 70 → 50)
```

## Part 4 — Learning integration (enhance, not overwrite)
- scalpingEngine tags the trade's `evidence` array with `REGIME:<regime>` at entry (no schema or
  execution-layer change — evidence is already a JSON array the engine builds).
- `getRegimeBiasPerformance()` (marketIntelligence): reads closed crypto trades, parses the
  `REGIME:` tag from evidence, groups win rate + pnl by `side × regime` (LONG/SHORT in bull/bear).
  Read-only analytics — does not touch the existing learning writes. Exposed via diagnostics so
  the operator sees whether the bias helps.

## Part 5 — Validation (`regimeBiasBacktest.mjs`)
For each closed crypto trade: fetch 1m klines ending at `opened_at` from the Binance mirror,
rebuild ctx, `classifyRegime`, `applyRegimeBias(storedConfidence, side, regime)`. A trade
"survives" if `biasedConf >= 0.65`. Compute on the FULL set (before) and the SURVIVING set
(after): win rate, expectancy ($/trade), profit factor, false positives (conf ≥ 0.70 that lost),
calibration (1 − avg|conf − won|). Print before/after table. Klines-unavailable → signal-proxy
fallback (regime from stored evidence signals). Goal: improve expectancy without raising drawdown.

## Part 6 — Safety (untouched)
risk engine, safe mode, daily caps, execution logic, paper trading, TP/SL, Kelly — NOT modified.
Only confidence is biased, feeding the existing gate. SHORT penalties push bad countertrend
shorts below the gate (rejected); they are never force-flipped to LONG.

## Tests (`regime.test.mjs`)
- classifyRegime: synthetic ctx → expected regime for each of the 6 classes.
- applyRegimeBias: exact modifier math; clamp at 0.92 and 0; RANGE = no change.
- behavior: a 0.70 SHORT in STRONG_BULL → 0.50 (below gate); a 0.85 LONG in STRONG_BULL → 0.92 (clamped).

## Not built
No directional hard-blocks. No changes to scoring thresholds or the gate value. No new external
data. Swing has ~0 historical trades — bias applies for consistency but backtest focuses on scalp.
