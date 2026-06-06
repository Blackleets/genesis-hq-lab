# Genesis HQ — Phase 1 Confidence Engine Audit

> Audit date: 2026-06-06. Pre-implementation state of confidence system.

## Current Confidence Mechanism (Pre-Phase 1)

### Single float from Claude arbiter

`server/trading/debateRoom.mjs:runDebate()` calls Claude Haiku and extracts a single float `final_confidence` (0.0–1.0) from the arbiter. Two hard gates are applied via `enforceDebateRules()`:

```
if (arb.final_confidence < 0.65)  → SKIP
if (bear.confidence > 0.58)        → SKIP
```

Everything above 0.65 (with bear ≤ 0.58) proceeds at **full Kelly size**. There is no intermediate sizing.

### Fallback debate (no API key)

If `ANTHROPIC_API_KEY` is missing, `fallbackDebate()` uses:
```javascript
confidence = 0.62 + (agreesWithMarket ? Math.abs(net) * 0.15 : 0)
// Capped at 0.78
```
Hardcoded range: 0.62–0.78. No signal richness, no market data, no history.

### Agent historical performance

`server/memory/learningEngine.mjs:getDecisionContext()` returns lessons, rules, and agent skill levels (`calibration_score`, `skill_market_selection`, etc.). These are fed into the **debate prompt** as context but do NOT affect the confidence score directly.

### No signal freshness

Research signals (from `researchAgent.mjs`) are fed into the debate prompt but their count, recency, or accuracy does not influence confidence.

---

## Weaknesses Identified

| Weakness | Impact |
|----------|--------|
| Binary pass/fail at 0.65 threshold | No size modulation — low-conviction trades get same Kelly as high-conviction |
| Context-blind threshold | Same 0.65 cutoff regardless of market volatility, horizon, or liquidity |
| No historical performance dimension | Agent with 40% win rate uses same threshold as one with 65% win rate |
| No market conditions weighting | $5k volume market treated identically to $500k market |
| No drawdown awareness | System trades at full Kelly even at 14% drawdown |
| Bear gate is hard | `bear > 0.58` is a binary block, not a size reduction |
| Fallback confidence hardcoded | 0.62–0.78 range with no structural basis |
| No explainability | Can't tell WHY a trade was taken or skipped |

---

## Phase 1 Solution: 5-Dimension Composite Score (0-100)

### Dimensions

| Dimension | Max | Source |
|-----------|-----|--------|
| Signal Quality | 25 | Evidence count, price edge, volume |
| Agent Consensus | 25 | Arbiter conviction, bear dissent penalty |
| Market Conditions | 20 | Liquidity, horizon, price location |
| Historical Performance | 20 | Calibration score, win rate |
| Risk Profile | 10 | Drawdown, open trades, safe mode |

### Decision Bands

| Band | Score | Kelly | Action |
|------|-------|-------|--------|
| BLOCK | 0-24 | 0x | No trade |
| LOW_CONFIDENCE | 25-49 | 0x | No trade |
| CAUTION | 50-69 | 0.5x | Trade at half size |
| GOOD_SETUP | 70-84 | 1.0x | Trade at normal size |
| HIGH_CONVICTION | 85-100 | 1.2x | Trade at 1.2x Kelly |

### NO_TRADE_REASONS

Tracked per decision for diagnostics:
- `COMPOSITE_SCORE_TOO_LOW` — overall score below threshold
- `SAFE_MODE_ACTIVE` — startup reconciliation degraded
- `AGENT_DISAGREEMENT` — bear consensus too strong
- `POOR_MARKET_CONDITIONS` — thin liquidity or bad horizon
- `HIGH_DRAWDOWN_PENALTY` — capital below peak threshold
- `LOW_HISTORICAL_PERFORMANCE` — agent calibration/win rate poor

---

## Files Modified

| File | Type | Change |
|------|------|--------|
| `server/intelligence/confidenceEngine.mjs` | New | 5-dimension composite engine |
| `server/trading/workflow.mjs` | Modified | Confidence gate after step 4 (debate) |
| `server/truthLayer.mjs` | Modified | `probeConfidenceEngine()` diagnostics |
| `src/hooks/useTruthLayer.ts` | Modified | `confidenceEngine` field in interface |
| `src/ui/views/SystemHealthView.tsx` | Modified | Confidence Engine section |
| `server/tests/confidenceEngine.test.mjs` | New | 6 test scenarios + band sanity checks |

---

## Risk Assessment

**Low risk** — additive layer only:
- Existing debate gates (`final_confidence < 0.65`, `bear > 0.58`) remain in place
- Confidence engine adds a SECOND gate, not a replacement
- CAUTION band means more trades are taken at reduced size (vs. previously either full-size or blocked)
- Safe mode detection is redundant with `riskManager.mjs` but provides earlier, clearer signaling

**Conservative by default:**
- Any market with thin signals, conflicting agents, high drawdown, or poor conditions will score in BLOCK/LOW_CONFIDENCE
- Historical performance dimension defaults to neutral (10/20) when insufficient data — not optimistic
