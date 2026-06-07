# Genesis Trading Co-Pilot — Design Spec

> Date: 2026-06-07. Approved.

## Goal
Assisted manual trading: when the operator picks a direction, Genesis shows its real read
(confidence, risk, TP/SL, regime, EV, why long / why not, outcome simulation) and lets the
operator execute — but never bypassing risk systems or safe mode.

## Decisions
- **Intelligence: deterministic from the real engines** (`evaluateSignal`, `marketIntelligence`,
  `globalRiskEngine`, `cryptoRisk`, live `getParams()`). No LLM. This is literally the same edge
  that drives the bot.
- **UI: pre-trade overlay on the chart.** Long/Short buttons open the co-pilot card instead of
  executing instantly. Execute is guarded; Cancel closes.

## Architecture
```
operator clicks Long/Short (pair from chart)
  → POST /api/crypto/copilot { pair, side }
  → copilot.analyzeTrade(): real engines → analysis (incl. safety.blocked)
  → CopilotPanel overlay renders it
  → Execute → POST /api/crypto/order (re-validates safety server-side, authoritative)
       blocked → refused; allowed → executeCryptoPaperTrade (paper)
```

## Files
| Action | File | Responsibility |
|--------|------|----------------|
| CREATE | `server/crypto/copilot.mjs` | `analyzeTrade({pair,side})`, `assertTradeAllowed({pair})`, pure helpers |
| CREATE | `server/tests/copilot.test.mjs` | breakdown, EV/winProb, simulation, confidence split |
| MODIFY | `server/index.mjs` | `POST /api/crypto/copilot` + gate `/api/crypto/order` with `assertTradeAllowed` |
| MODIFY | `src/services/cryptoClient.ts` | `CopilotAnalysis` interface + `analyzeCopilot()` |
| CREATE | `src/components/crypto/CopilotPanel.tsx` | pre-trade overlay card |
| MODIFY | `src/dashboard/charts/CandleChart.tsx` | Long/Short → open co-pilot; Execute/Cancel |

## `copilot.mjs`

### `analyzeTrade({ pair, side })` → CopilotAnalysis
1. Fetch klines(1m,360) + 24h ticker for `pair`; build ctx via `buildAssetContext`.
2. `engine = evaluateSignal(ctx, getParams())` → { action, side, score, reasons }.
3. `breakdown = buildSignalBreakdown(ctx, side, params)` → `{ positive[], negative[] }`:
   checks each confluence condition independently for the requested side —
   EMA trend, 1h momentum, RSI band, volume floor, HTF trend.
4. `confidence` (0–100): if `engine.action==='TRADE' && engine.side===side` →
   `round(60 + 40*engine.score)`; else → `round(50 * posRatio)` where
   `posRatio = positive/(positive+negative)`. (Engine-endorsed: 60–100; not: 0–50.)
5. `risk = getGlobalRiskDiagnostics()` → `{ score, band, safeMode }`.
6. TP/SL from live params: LONG `tp=entry*(1+targetPct)`, `sl=entry*(1-stopPct)`; SHORT mirror.
7. `regime` from `getMarketIntelligence()` (regime, momentum, volatility).
8. `pWin = clamp(0.7*(confidence/100) + 0.3*(recentWinRate ?? confidence/100), 0.05, 0.92)`.
9. `evPct = pWin*targetPct - (1-pWin)*stopPct`; `evUsd = evPct * notional` (notional 100).
10. Simulation: `pTimeout = clamp(0.06 + 0.10*flatness, 0.04, 0.25)` where flatness from |change1h|;
    `pTP = pWin*(1-pTimeout)`, `pSL = (1-pWin)*(1-pTimeout)`; normalize {pTP,pSL,pTimeout} to sum 1.
11. `safety = assertTradeAllowed({ pair })`.
12. Return all fields.

### `assertTradeAllowed({ pair })` → { blocked, reasons[] }
- global `safeMode` → blocked "Safe mode active"
- global band `CRITICAL` → blocked "System risk CRITICAL"
- `exceedsDailyCap(dailyCryptoRealizedPnl(), cap)` → blocked "Daily loss cap reached"
- asset cooldown (last closed crypto trade for pair was a loss within cooldown) → blocked "Asset cooling down"
- else `{ blocked:false, reasons:[] }`

### Pure helpers (exported, unit-tested)
`buildSignalBreakdown`, `winProb`, `expectedValue`, `simulate` (returns normalized probs),
`copilotConfidence`.

## `CopilotAnalysis` (client interface)
```typescript
interface CopilotAnalysis {
  pair: string; side: 'LONG' | 'SHORT'; price: number;
  confidence: number;                 // 0–100
  engineEndorsed: boolean;            // engine's own verdict matches side
  risk: { score: number; band: string; safeMode: boolean };
  tp: number; sl: number; tpPct: number; slPct: number;
  regime: string; momentum: string; volatility: string;
  evPct: number; evUsd: number; winProb: number;
  positive: string[]; negative: string[];
  simulation: { pTP: number; pSL: number; pTimeout: number };
  safety: { blocked: boolean; reasons: string[] };
}
```

## `/api/crypto/order` gate
Before executing: `const gate = assertTradeAllowed({ pair });` if `gate.blocked` →
`sendJson(403, { ok:false, blocked:true, error: gate.reasons[0] })`. Otherwise proceed.

## CopilotPanel.tsx (overlay)
Absolute card on chart (like TradeStoryCard). Shows: side+pair header; confidence + risk gauges;
TP/SL/EV/regime cells; WHY LONG (positive, green) / WHY NOT (negative, red) lists; simulation bar
(TP green / SL red / timeout gray %); footer: Execute (disabled + reason if `safety.blocked`) / Cancel.

## CandleChart
- New optional props: keep `onManualOrder`. Add internal co-pilot state:
  clicking Long/Short sets `copilot={ side }`, calls `analyzeCopilot(pair, side)`, renders CopilotPanel.
- Execute → `onManualOrder(side, pair)` then close panel + clear; if backend returns blocked, surface it.
- Cancel/✕ → clear co-pilot state.

## Validation
- `npm run build` clean; `npm test` all pass + copilot tests.
- Manual: Long/Short opens panel with real numbers; safe-mode blocks Execute with reason;
  WHY lists reflect real conditions; simulation sums ~100%; execution still paper + risk-gated.

## Safety guarantees (Part 4)
Validated twice: in analysis (display) and server-side at execution (authoritative). The co-pilot
cannot place a trade the risk system forbids; it only informs and, when allowed, routes through the
normal guarded paper-execution path.

## Not built
- No real-money execution (paper only, unchanged). No per-trade risk/regime persistence.
- No LLM narration. No multi-leg/scaling orders (single $100 paper entry, as today).
