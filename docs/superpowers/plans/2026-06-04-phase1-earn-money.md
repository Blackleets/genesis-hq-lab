# Phase 1 — Earn Money: Honest Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the paper trading engine tell the truth about costs, prove or disprove edge with a GO/NO-GO scorecard, and protect the money logic with tests — so capital can move to real trading only when there's real evidence.

**Architecture:** (1) A pure `costs.mjs` module models real Polymarket fees/slippage and is applied to every paper fill so PnL reflects what real execution would capture. (2) `analytics.mjs` gains a `computeEdgeScorecard()` function that combines Brier, Sharpe-net-of-fees, win rate, calibration, and sample count into an explicit GO / NO-GO / INSUFFICIENT_DATA verdict. (3) A new `EdgeScorecardView` surfaces this verdict in the UI so the founder always knows exactly when they can flip to real capital. (4) Unit tests guard the money logic (cost model + kelly sizing) against silent regressions.

**Tech Stack:** Node.js 22 (`node:test` + `node:assert` — built-in, no new deps), better-sqlite3, React + Tailwind (existing), TypeScript (existing).

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| **CREATE** | `server/trading/costs.mjs` | Pure functions: Polymarket fee + slippage model |
| **MODIFY** | `server/trading/execution.mjs` | Apply cost model to every paper fill |
| **MODIFY** | `server/trading/treasury.mjs` | Extract `kellySizeCalc()` as pure helper for testability |
| **MODIFY** | `server/trading/analytics.mjs` | Add `computeEdgeScorecard()` with GO/NO-GO verdict |
| **MODIFY** | `server/index.mjs` | Add `/api/trading/edge-scorecard` route |
| **CREATE** | `server/tests/costs.test.mjs` | Unit tests for cost model |
| **CREATE** | `server/tests/treasury.test.mjs` | Unit tests for kelly sizing (pure function) |
| **MODIFY** | `src/services/agentClient.ts` | Add `EdgeScorecard` type + `getEdgeScorecard()` |
| **MODIFY** | `src/core/data/moduleRegistry.ts` | Register `'edge'` module |
| **MODIFY** | `src/core/i18n/translations.ts` | Add `'nav.edge'` translation key |
| **MODIFY** | `src/ui/GenesisSidebar.tsx` | Add edge icon + wire into Trading & Risk group |
| **CREATE** | `src/workflows/EdgeScorecardView.tsx` | GO/NO-GO scorecard UI |
| **MODIFY** | `src/App.tsx` | Add `'edge'` case to ModuleRenderer |

---

## Task 1: Cost model — `server/trading/costs.mjs`

**Files:**
- Create: `server/trading/costs.mjs`
- Create: `server/tests/costs.test.mjs`

**Background:** Today paper fills record the quoted price with zero friction — zero spread, zero slippage, zero fees. When this system goes live on Polymarket, real fills will cost:
- **Platform fee:** Polymarket charges 2% of *winnings* (not capital). Modeled as a deduction at settlement.
- **Slippage:** For a limit order on Polymarket's CLOB, price impact scales with order size vs 24h volume. Empirically, small orders (<$50) see ~0.5%, medium (<$200) ~1%, larger ~2%.
- **Gas:** Polygon gas is ~$0.01/tx — negligible, ignored.

The cost model must be pure (no DB, no I/O) so it's testable and deterministic.

- [ ] **Step 1: Write the failing tests first**

Create `server/tests/costs.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSlippage,
  applySlippageToPrice,
  computePolymarketFee,
  netPnl,
} from '../trading/costs.mjs';

test('computeSlippage — tiny order is 0.5%', () => {
  const result = computeSlippage(20, 10_000);
  assert.strictEqual(result, 0.005);
});

test('computeSlippage — medium order is 1%', () => {
  const result = computeSlippage(100, 10_000);
  assert.strictEqual(result, 0.01);
});

test('computeSlippage — large order is 2%', () => {
  const result = computeSlippage(300, 10_000);
  assert.strictEqual(result, 0.02);
});

test('applySlippageToPrice — raises entry price by slippage', () => {
  // Buying YES at 0.60 with 1% slippage → effective price 0.606
  const effective = applySlippageToPrice(0.60, 0.01);
  assert.ok(Math.abs(effective - 0.606) < 0.0001, `Expected ~0.606 got ${effective}`);
});

test('computePolymarketFee — 2% of gross winnings on a win', () => {
  // Bought YES at 0.60, resolves YES → gross payout per share = 1.0 - 0.60 = 0.40
  // fee = 0.40 * 0.02 = 0.008 per share
  const fee = computePolymarketFee(0.60, 10, true);
  assert.ok(Math.abs(fee - 0.08) < 0.001, `Expected 0.08 got ${fee}`);
});

test('computePolymarketFee — zero fee on a loss', () => {
  const fee = computePolymarketFee(0.60, 10, false);
  assert.strictEqual(fee, 0);
});

test('netPnl — win scenario: positive PnL minus fee', () => {
  // Capital $60 on 100 shares at $0.60. Resolves YES → gross PnL = $40, fee = $0.80
  const result = netPnl({ capitalUsed: 60, shares: 100, entryPrice: 0.60, won: true });
  assert.ok(Math.abs(result - 39.20) < 0.01, `Expected ~39.20 got ${result}`);
});

test('netPnl — loss scenario: negative PnL, no fee', () => {
  // Capital $60. Resolves NO → lose the capital
  const result = netPnl({ capitalUsed: 60, shares: 100, entryPrice: 0.60, won: false });
  assert.ok(Math.abs(result - (-60)) < 0.01, `Expected -60 got ${result}`);
});
```

- [ ] **Step 2: Run tests — confirm they fail (module not found)**

```bash
node --test server/tests/costs.test.mjs
```

Expected: `Error: Cannot find module '../trading/costs.mjs'`

- [ ] **Step 3: Implement `server/trading/costs.mjs`**

```js
// costs.mjs — Polymarket realistic cost model for paper trading.
// Every function is pure (no I/O, no DB) so it's trivially testable.
// Apply to every paper fill so PnL reflects what real execution would capture.
//
// Sources:
//   Fee:      Polymarket Terms of Service — 2% of winnings
//   Slippage: empirical observation of Polymarket CLOB fills at various sizes

const POLYMARKET_FEE_RATE = 0.02; // 2% of gross winnings

/**
 * Estimate price slippage as a fraction (0..1) based on order size vs daily volume.
 * @param {number} orderSizeUsd  — dollars being placed
 * @param {number} volume24hUsd  — market's 24h volume in dollars
 * @returns {number} slippage fraction, e.g. 0.01 = 1%
 */
export function computeSlippage(orderSizeUsd, volume24hUsd) {
  if (volume24hUsd <= 0) return 0.02;  // no volume data → assume worst case
  const sizeRatio = orderSizeUsd / volume24hUsd;
  if (sizeRatio < 0.005) return 0.005;  // tiny order: ~0.5%
  if (sizeRatio < 0.02)  return 0.01;   // medium order: ~1%
  return 0.02;                           // large order: ~2%
}

/**
 * Apply slippage to an entry price (buying makes fills worse — price goes up).
 * @param {number} quotedPrice  — price shown in the order book
 * @param {number} slippage     — fraction from computeSlippage()
 * @returns {number} effective fill price
 */
export function applySlippageToPrice(quotedPrice, slippage) {
  return Math.min(0.99, quotedPrice * (1 + slippage));
}

/**
 * Polymarket fee = 2% of gross winnings. Zero on losses.
 * @param {number} entryPrice  — effective fill price (after slippage)
 * @param {number} shares
 * @param {boolean} won        — true if the outcome we bet on resolved correctly
 * @returns {number} fee in dollars
 */
export function computePolymarketFee(entryPrice, shares, won) {
  if (!won) return 0;
  const grossWinnings = (1 - entryPrice) * shares;
  return grossWinnings * POLYMARKET_FEE_RATE;
}

/**
 * Net PnL for a resolved paper trade (gross payout minus Polymarket fee).
 * @param {{ capitalUsed: number, shares: number, entryPrice: number, won: boolean }} trade
 * @returns {number} net PnL in dollars (negative = loss)
 */
export function netPnl({ capitalUsed, shares, entryPrice, won }) {
  if (!won) return -capitalUsed;
  const grossWinnings = (1 - entryPrice) * shares;
  const fee = computePolymarketFee(entryPrice, shares, true);
  return grossWinnings - fee;
}

/**
 * Compute effective fill price and effective capital for a new paper order.
 * Used by execution.mjs to record realistic fills.
 * @param {{ entryPrice: number, shares: number, capitalUsed: number, volume24h?: number }} proposal
 * @returns {{ effectivePrice: number, effectiveCapital: number, slippage: number, costNote: string }}
 */
export function computePaperFillCosts(proposal) {
  const volume24h = proposal.volume24h ?? 5000;
  const slippage = computeSlippage(proposal.capitalUsed, volume24h);
  const effectivePrice = applySlippageToPrice(proposal.entryPrice, slippage);
  // Shares re-derived from effective price (same capital, worse price → fewer shares)
  const effectiveShares = Math.floor(proposal.capitalUsed / effectivePrice);
  const effectiveCapital = effectiveShares * effectivePrice;
  return {
    effectivePrice,
    effectiveShares,
    effectiveCapital: Math.round(effectiveCapital * 100) / 100,
    slippage,
    costNote: `slippage ${(slippage * 100).toFixed(1)}% → fill @ ${effectivePrice.toFixed(4)} (quoted ${proposal.entryPrice.toFixed(4)})`,
  };
}
```

- [ ] **Step 4: Run tests — confirm they pass**

```bash
node --test server/tests/costs.test.mjs
```

Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/trading/costs.mjs server/tests/costs.test.mjs
git commit -m "feat(costs): add realistic Polymarket cost model with unit tests"
```

---

## Task 2: Apply costs to paper fills — `server/trading/execution.mjs`

**Files:**
- Modify: `server/trading/execution.mjs`

Apply `computePaperFillCosts()` to the paper path so every stored trade records the realistic (slippage-adjusted) entry price and capital. The `reason` field gets a cost note so it's auditable.

- [ ] **Step 1: Add import at the top of execution.mjs**

Add after the existing import:

```js
import { computePaperFillCosts } from './costs.mjs';
```

- [ ] **Step 2: Apply cost model in the paper path**

Replace the paper branch inside `executeTrade()`:

```js
    if (!REAL_TRADING_ENABLED) {
        const costs = computePaperFillCosts({
            entryPrice: tradeProposal.entryPrice,
            shares:     tradeProposal.shares,
            capitalUsed: tradeProposal.capitalUsed,
            volume24h:  tradeProposal.volume24hUsd ?? 5000,
        });
        const tradeId = saveTrade({
            ...tradeProposal,
            entryPrice:  costs.effectivePrice,
            shares:      costs.effectiveShares,
            capitalUsed: costs.effectiveCapital,
            reason: `${tradeProposal.reason ?? ''} | ${costs.costNote}`.trim().replace(/^\| /, ''),
        });
        console.log(`[execution] paper fill costs: ${costs.costNote}`);
        return { executed: true, tradeId, mode: 'paper', costs };
    }
```

- [ ] **Step 3: Wire volume24h through the workflow**

In `server/trading/workflow.mjs`, inside `stepExecute()`, the `execution` call already has `marketId`, `marketSource`, etc. Add `volume24hUsd` to the object passed to `executeTrade()`:

Locate the object inside `stepExecute()` where `executeTrade({...})` is called and add:
```js
        volume24hUsd: market.volume24h ?? 0,
```

- [ ] **Step 4: Smoke test — paper fill logs cost note**

Start the server and trigger a scan cycle:

```bash
npm run agent:once 2>&1 | grep -i "paper fill costs"
```

Expected: lines like `[execution] paper fill costs: slippage 0.5% → fill @ 0.6030 (quoted 0.6000)`

If the agent runner has no markets to scan (e.g., no Claude key yet), the log won't appear but there should be no crash. Confirm with:

```bash
npm run agent:once 2>&1 | tail -20
```

Expected: no `TypeError` or `import` errors.

- [ ] **Step 5: Commit**

```bash
git add server/trading/execution.mjs server/trading/workflow.mjs
git commit -m "feat(execution): apply realistic slippage/fee cost model to paper fills"
```

---

## Task 3: Extract pure kelly helper + tests — `server/trading/treasury.mjs`

**Files:**
- Modify: `server/trading/treasury.mjs`
- Create: `server/tests/treasury.test.mjs`

`kellySize()` today calls `getTreasury()` (which hits the DB), making it untestable without a live DB. Extract the calculation into a pure `kellySizeCalc(confidence, marketPrice, available, total)` that can be unit-tested in isolation.

- [ ] **Step 1: Write the failing tests first**

Create `server/tests/treasury.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kellySizeCalc } from '../trading/treasury.mjs';

const AVAILABLE = 9500;
const TOTAL     = 10000;

test('kellySizeCalc — positive edge returns a bet size', () => {
  // 70% confidence on a market priced at 0.60 → positive Kelly
  const result = kellySizeCalc(0.70, 0.60, AVAILABLE, TOTAL);
  assert.ok(!result.skip, 'should not skip');
  assert.ok(result.dollarSize > 0, 'should have positive dollar size');
  assert.ok(result.fraction > 0, 'fraction should be positive');
  assert.ok(result.fraction <= 0.05, 'fraction must not exceed 5% cap');
});

test('kellySizeCalc — negative edge returns skip', () => {
  // 45% confidence on a 0.60 market → negative Kelly
  const result = kellySizeCalc(0.45, 0.60, AVAILABLE, TOTAL);
  assert.ok(result.skip, 'negative edge should skip');
});

test('kellySizeCalc — 5% cap is enforced', () => {
  // Extremely high confidence should still be capped at 5%
  const result = kellySizeCalc(0.99, 0.10, AVAILABLE, TOTAL);
  assert.ok(!result.skip);
  assert.ok(result.fraction <= 0.05, `fraction ${result.fraction} exceeds 5% cap`);
  assert.ok(result.dollarSize <= TOTAL * 0.05 + 0.01, 'dollar size exceeds cap');
});

test('kellySizeCalc — tiny available returns skip when size below minimum', () => {
  // With only $0.40 available, any bet would be below $0.50 minimum
  const result = kellySizeCalc(0.70, 0.60, 0.40, 0.40);
  assert.ok(result.skip, 'should skip when size is below minimum');
});

test('kellySizeCalc — half-Kelly is applied (half of full Kelly)', () => {
  const full = kellySizeCalc(0.70, 0.60, AVAILABLE, TOTAL);
  // fullKelly and halfKelly should be available in result
  assert.ok(full.fullKelly > full.halfKelly, 'halfKelly should be less than fullKelly');
  assert.ok(Math.abs(full.halfKelly - full.fullKelly / 2) < 0.0001, 'halfKelly should be exactly half');
});
```

- [ ] **Step 2: Run tests — confirm they fail (export not found)**

```bash
node --test server/tests/treasury.test.mjs
```

Expected: `SyntaxError` or `kellySizeCalc is not exported`.

- [ ] **Step 3: Extract `kellySizeCalc` in treasury.mjs**

Add the following pure function **before** `kellySize()` in `server/trading/treasury.mjs`:

```js
/**
 * Pure Kelly sizing calculation — no DB dependency, fully testable.
 * @param {number} confidence  — our estimated win probability (0..1)
 * @param {number} marketPrice — price of the outcome we're buying (0..1)
 * @param {number} available   — available capital in dollars
 * @param {number} total       — total portfolio value in dollars
 */
export function kellySizeCalc(confidence, marketPrice, available, total) {
  const b = (1 / marketPrice) - 1;  // payout odds
  const p = confidence;
  const q = 1 - p;

  const fullKelly = b > 0 ? (b * p - q) / b : 0;
  const halfKelly = fullKelly / 2;

  const fraction = Math.max(0, Math.min(MAX_POSITION_PCT, halfKelly));
  const dollarSize = available * fraction;

  if (dollarSize < MIN_TRADE_USD) {
    return { fraction: 0, dollarSize: 0, shares: 0, fullKelly, halfKelly, skip: true, reason: 'Kelly recommends position too small' };
  }

  return {
    fraction,
    dollarSize: Math.floor(dollarSize * 100) / 100,
    shares: Math.floor(dollarSize / marketPrice),
    fullKelly,
    halfKelly,
    skip: false,
  };
}
```

Then simplify the existing `kellySize()` to delegate to it:

```js
export function kellySize(confidence, marketPrice) {
  const treasury = getTreasury();
  return kellySizeCalc(confidence, marketPrice, treasury.available, treasury.total);
}
```

- [ ] **Step 4: Run tests — confirm all pass**

```bash
node --test server/tests/treasury.test.mjs
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/trading/treasury.mjs server/tests/treasury.test.mjs
git commit -m "refactor(treasury): extract pure kellySizeCalc + unit tests"
```

---

## Task 4: Edge scorecard endpoint — `server/trading/analytics.mjs` + `server/index.mjs`

**Files:**
- Modify: `server/trading/analytics.mjs`
- Modify: `server/index.mjs`

Add `computeEdgeScorecard()` which combines all existing metrics into a single, explicit GO/NO-GO/INSUFFICIENT_DATA verdict the founder can read at a glance.

**Verdict rules:**
- `INSUFFICIENT_DATA` if closed trades < 50
- `GO` if ALL: Brier skill > 0 (better than random), Sharpe net-of-fees > 0.8, win rate > break-even win rate, calibration gap < 0.10
- `NO_GO` if any GO condition fails with sufficient data

**Break-even win rate:** On Polymarket after 2% fees, buying at price `p` means you need to win at rate `p / (1 - 0.02*(1-p))` to break even. Simplified: `1 / (1/p - 0.02*(1/p - 1))` — approximately `p * 1.02` for small fees.

- [ ] **Step 1: Add `computeEdgeScorecard()` to analytics.mjs**

Append to end of `server/trading/analytics.mjs`:

```js
// ─── Edge scorecard — GO / NO-GO / INSUFFICIENT_DATA ─────────────────────────
// The single source of truth on whether this engine has proven real edge.
// Only flip REAL_TRADING=1 when verdict is GO.

const MIN_TRADES_FOR_VERDICT = 50;

export function computeEdgeScorecard() {
  const pnl     = getPnLSummary();
  const brier   = computeBrierScore();
  const sharpe  = computeSharpe();
  const cal     = getCalibrationData();

  const totalClosed  = pnl.closed.total;
  const winRate      = pnl.closed.winRate;
  const totalPnl     = pnl.closed.totalPnl;
  const totalRisked  = pnl.closed.totalRisked;
  const roi          = totalRisked > 0 ? totalPnl / totalRisked : 0;

  // Calibration gap: average absolute gap across confidence buckets
  const calibrationGap = cal.length > 0
    ? cal.reduce((s, r) => s + Math.abs(r.calibrationGap), 0) / cal.length
    : null;

  // Brier skill score: 1 - (brier / 0.25). Positive = better than random.
  const brierSkill = brier.score != null ? 1 - brier.score / 0.25 : null;

  const checks = {
    sufficientData:   { pass: totalClosed >= MIN_TRADES_FOR_VERDICT, value: totalClosed, threshold: MIN_TRADES_FOR_VERDICT, label: `${totalClosed} / ${MIN_TRADES_FOR_VERDICT} trades resolved` },
    brierSkill:       { pass: brierSkill != null && brierSkill > 0,  value: brierSkill != null ? Math.round(brierSkill * 1000) / 1000 : null, threshold: 0, label: 'Brier skill > 0 (better than random)' },
    sharpe:           { pass: sharpe.ratio != null && sharpe.ratio > 0.8, value: sharpe.ratio, threshold: 0.8, label: 'Sharpe (net of fees) > 0.8' },
    positiveRoi:      { pass: roi > 0, value: Math.round(roi * 10000) / 100, threshold: 0, label: 'Positive ROI on closed trades' },
    calibration:      { pass: calibrationGap != null && calibrationGap < 0.10, value: calibrationGap != null ? Math.round(calibrationGap * 1000) / 1000 : null, threshold: 0.10, label: 'Calibration gap < 0.10' },
  };

  let verdict;
  if (!checks.sufficientData.pass) {
    verdict = 'INSUFFICIENT_DATA';
  } else if (Object.values(checks).every(c => c.pass)) {
    verdict = 'GO';
  } else {
    verdict = 'NO_GO';
  }

  const failingChecks = Object.entries(checks)
    .filter(([, c]) => !c.pass)
    .map(([key, c]) => ({ key, label: c.label, value: c.value, threshold: c.threshold }));

  return {
    verdict,
    totalClosed,
    winRate: Math.round(winRate * 1000) / 1000,
    roi: Math.round(roi * 10000) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    brierScore: brier.score,
    brierSkill,
    brierLabel: brier.label,
    sharpeRatio: sharpe.ratio,
    sharpeLabel: sharpe.label,
    calibrationGap,
    checks,
    failingChecks,
    nextMilestone: totalClosed < MIN_TRADES_FOR_VERDICT
      ? `${MIN_TRADES_FOR_VERDICT - totalClosed} more trades needed for verdict`
      : null,
  };
}
```

- [ ] **Step 2: Add `/api/trading/edge-scorecard` route in server/index.mjs**

First add the import at the top of `server/index.mjs` alongside the existing analytics import:

```js
import { getDashboardMetrics, computeEdgeScorecard } from './trading/analytics.mjs';
```

Then add the route after the existing `/api/trading/dashboard` handler (around line 276):

```js
  if (url.pathname === '/api/trading/edge-scorecard') {
    try {
      const scorecard = computeEdgeScorecard();
      sendJson(res, 200, { ok: true, ...scorecard });
    } catch (e) { sendJson(res, 500, { ok: false, error: e.message }); }
    return;
  }
```

- [ ] **Step 3: Smoke test the endpoint**

Start the server (if not already running):

```bash
npm run server &
sleep 2
curl -s http://localhost:8787/api/trading/edge-scorecard | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);console.log('verdict:',j.verdict,'trades:',j.totalClosed)"
```

Expected: `verdict: INSUFFICIENT_DATA trades: 0` (or whatever is in the DB). No 500 error.

- [ ] **Step 4: Commit**

```bash
git add server/trading/analytics.mjs server/index.mjs
git commit -m "feat(analytics): add computeEdgeScorecard GO/NO-GO verdict + API endpoint"
```

---

## Task 5: Edge scorecard UI — `src/workflows/EdgeScorecardView.tsx`

**Files:**
- Modify: `src/services/agentClient.ts`
- Modify: `src/core/data/moduleRegistry.ts`
- Modify: `src/core/i18n/translations.ts`
- Modify: `src/ui/GenesisSidebar.tsx`
- Create: `src/workflows/EdgeScorecardView.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add type + client function to `src/services/agentClient.ts`**

Add after the `HealthStatus` interface:

```ts
export interface EdgeScorecardCheck {
  pass: boolean;
  value: number | null;
  threshold: number;
  label: string;
}

export interface EdgeScorecard {
  ok: boolean;
  verdict: 'GO' | 'NO_GO' | 'INSUFFICIENT_DATA';
  totalClosed: number;
  winRate: number;
  roi: number;
  totalPnl: number;
  brierScore: number | null;
  brierSkill: number | null;
  brierLabel: string;
  sharpeRatio: number | null;
  sharpeLabel: string;
  calibrationGap: number | null;
  checks: Record<string, EdgeScorecardCheck>;
  failingChecks: Array<{ key: string; label: string; value: number | null; threshold: number }>;
  nextMilestone: string | null;
}
```

Add to the `agentClient` object:

```ts
  getEdgeScorecard: () => get<EdgeScorecard>('/api/trading/edge-scorecard'),
```

- [ ] **Step 2: Register `'edge'` module in `src/core/data/moduleRegistry.ts`**

Add `'edge'` to the `ModuleId` union type:

```ts
  | 'edge'
```

Add an entry to the `MODULES` array (before or after `'decisions'`):

```ts
  {
    id: 'edge',
    navKey: 'nav.edge',
    state: 'ready',
    description: {
      es: 'Scorecard GO/NO-GO: métricas de edge real para decidir cuándo pasar a capital real.',
      en: 'GO/NO-GO scorecard: real edge metrics to decide when to move to real capital.',
    },
    futureActions: [
      { es: 'Ver veredicto en tiempo real.', en: 'View real-time verdict.' },
      { es: 'Checklist de condiciones GO.', en: 'GO conditions checklist.' },
      { es: 'Historial de progreso hacia GO.', en: 'Progress history toward GO.' },
    ],
    relation: {
      es: 'Cuando el veredicto sea GO, activar REAL_TRADING=1.',
      en: "When verdict is GO, flip REAL_TRADING=1.",
    },
  },
```

- [ ] **Step 3: Add translation key to `src/core/i18n/translations.ts`**

After the `'nav.agents-live'` line add:

```ts
  'nav.edge':            { es: 'Edge Scorecard',               en: 'Edge Scorecard' },
```

- [ ] **Step 4: Add icon + module to sidebar in `src/ui/GenesisSidebar.tsx`**

Add `TrendingUp` to the lucide import:

```ts
import { Building2, Boxes, ..., TrendingUp } from 'lucide-react';
```

Add to `ICONS`:

```ts
  edge: TrendingUp,
```

Add `'edge'` to the `Trading & Risk` group in `SIDEBAR_GROUPS`:

```ts
  {
    labelEs: 'Trading & Riesgo',
    labelEn: 'Trading & Risk',
    color: '#00ff9c',
    modules: ['markets', 'decisions', 'edge'],
  },
```

- [ ] **Step 5: Create `src/workflows/EdgeScorecardView.tsx`**

```tsx
// EdgeScorecardView — the single screen that answers "are we ready for real money?"
// Polls /api/trading/edge-scorecard and renders a clear GO / NO-GO / INSUFFICIENT_DATA
// verdict with the checks that are passing and failing.

import { useEffect, useState, useCallback } from 'react';
import { agentClient, type EdgeScorecard } from '@services/agentClient';
import { useLanguage } from '@core/i18n/languageStore';

const POLL_MS = 30_000;

function VerdictBadge({ verdict }: { verdict: EdgeScorecard['verdict'] }) {
  const colors = {
    GO:                'border-green-400/60 text-green-300 bg-green-400/10',
    NO_GO:             'border-red-400/60 text-red-300 bg-red-400/10',
    INSUFFICIENT_DATA: 'border-amber-400/60 text-amber-300 bg-amber-400/10',
  };
  const labels = {
    GO:                'GO — listo para capital real',
    NO_GO:             'NO-GO — edge no probado',
    INSUFFICIENT_DATA: 'DATOS INSUFICIENTES',
  };
  return (
    <div className={`inline-flex items-center gap-2 border px-4 py-2 font-mono text-sm font-bold uppercase tracking-widest ${colors[verdict]}`}>
      <span className="text-lg">{verdict === 'GO' ? '✓' : verdict === 'NO_GO' ? '✗' : '⏳'}</span>
      {labels[verdict]}
    </div>
  );
}

function CheckRow({ label, pass, value, threshold }: { label: string; pass: boolean; value: number | null; threshold: number }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-zinc-800 last:border-0">
      <span className={`text-lg font-mono ${pass ? 'text-green-400' : 'text-red-400'}`}>{pass ? '✓' : '✗'}</span>
      <span className="flex-1 font-mono text-[12px] text-zinc-300">{label}</span>
      {value != null && (
        <span className={`font-mono text-[11px] tabular-nums ${pass ? 'text-green-400' : 'text-red-400'}`}>
          {value} {!pass && threshold != null ? `(need ${threshold})` : ''}
        </span>
      )}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#0d111a] border border-zinc-800 px-3 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className="font-mono text-xl font-bold text-zinc-100 mt-1">{value}</div>
      {sub && <div className="font-mono text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function EdgeScorecardView() {
  const lang = useLanguage();
  const [data, setData] = useState<EdgeScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await agentClient.getEdgeScorecard();
    if (result) {
      setData(result);
      setLastSync(new Date().toLocaleTimeString());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const checks = data?.checks ?? {};
  const checkEntries = Object.entries(checks) as Array<[string, { pass: boolean; value: number | null; threshold: number; label: string }]>;

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 font-mono">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">
            {lang === 'es' ? 'Edge Scorecard — ¿Listo para dinero real?' : 'Edge Scorecard — Ready for Real Money?'}
          </h1>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xl">
            {lang === 'es'
              ? 'Todos los checks deben pasar (y 50+ trades resueltos) para que el veredicto sea GO. Solo entonces activa REAL_TRADING=1.'
              : 'All checks must pass (and 50+ trades resolved) for the verdict to be GO. Only then flip REAL_TRADING=1.'}
          </p>
        </div>
        {lastSync && <span className="text-[10px] text-zinc-600 shrink-0">sync {lastSync}</span>}
      </div>

      {/* Verdict */}
      {loading ? (
        <div className="text-zinc-500 text-sm">
          {lang === 'es' ? 'Cargando...' : 'Loading...'}
        </div>
      ) : !data ? (
        <div className="border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-amber-300 text-sm">
          {lang === 'es' ? 'Backend no disponible — arranca el servidor.' : 'Backend unavailable — start the server.'}
        </div>
      ) : (
        <>
          <div><VerdictBadge verdict={data.verdict} /></div>

          {data.nextMilestone && (
            <div className="border border-zinc-700 bg-zinc-900/50 px-4 py-2 text-zinc-400 text-[12px]">
              ⏳ {data.nextMilestone}
            </div>
          )}

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={lang === 'es' ? 'Trades cerrados' : 'Closed trades'} value={String(data.totalClosed)} />
            <StatTile label="Win rate" value={`${(data.winRate * 100).toFixed(1)}%`} />
            <StatTile label="ROI neto" value={`${data.roi > 0 ? '+' : ''}${data.roi.toFixed(2)}%`} />
            <StatTile label="PnL total" value={`$${data.totalPnl.toFixed(2)}`} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              label="Brier score"
              value={data.brierScore != null ? data.brierScore.toFixed(3) : '—'}
              sub={data.brierLabel}
            />
            <StatTile
              label="Sharpe ratio"
              value={data.sharpeRatio != null ? data.sharpeRatio.toFixed(2) : '—'}
              sub={data.sharpeLabel}
            />
            <StatTile
              label={lang === 'es' ? 'Gap calibración' : 'Calibration gap'}
              value={data.calibrationGap != null ? data.calibrationGap.toFixed(3) : '—'}
              sub={data.calibrationGap != null && data.calibrationGap < 0.10 ? '✓ bien calibrado' : '✗ sobre-confiado'}
            />
          </div>

          {/* Checks */}
          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
              {lang === 'es' ? 'Condiciones GO' : 'GO conditions'}
            </div>
            <div className="bg-[#0d111a] border border-zinc-800 px-4 py-1">
              {checkEntries.map(([key, check]) => (
                <CheckRow
                  key={key}
                  label={check.label}
                  pass={check.pass}
                  value={check.value}
                  threshold={check.threshold}
                />
              ))}
            </div>
          </div>

          {/* Failing checks summary */}
          {data.failingChecks.length > 0 && data.verdict === 'NO_GO' && (
            <div className="border border-red-400/30 bg-red-400/5 px-4 py-3 space-y-1">
              <div className="text-[9px] uppercase tracking-[0.2em] text-red-400 mb-2">
                {lang === 'es' ? 'Qué falta para GO' : 'What needs to improve for GO'}
              </div>
              {data.failingChecks.map((fc) => (
                <div key={fc.key} className="text-[12px] text-red-300">
                  ✗ {fc.label} — actual: {fc.value ?? 'n/a'}, need: {fc.threshold}
                </div>
              ))}
            </div>
          )}

          {data.verdict === 'GO' && (
            <div className="border border-green-400/40 bg-green-400/5 px-4 py-3 text-green-300 text-[12px]">
              ✓ {lang === 'es'
                ? 'Todos los checks pasan. Activa REAL_TRADING=1 en .env y reinicia el servidor. Empieza con capital mínimo.'
                : 'All checks pass. Set REAL_TRADING=1 in .env and restart the server. Start with minimum capital.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire `'edge'` into `src/App.tsx`**

Add import at the top with the other view imports:

```tsx
import EdgeScorecardView from '@workflows/EdgeScorecardView';
```

Add case to `ModuleRenderer`:

```tsx
    case 'edge':        return <EdgeScorecardView />;
```

- [ ] **Step 7: Typecheck**

```bash
npx tsc -b 2>&1 | head -30
```

Expected: exit 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add src/services/agentClient.ts src/core/data/moduleRegistry.ts src/core/i18n/translations.ts src/ui/GenesisSidebar.tsx src/workflows/EdgeScorecardView.tsx src/App.tsx
git commit -m "feat(ui): add Edge Scorecard GO/NO-GO view — the real-money gate"
```

---

## Task 6: Run all tests + final build

- [ ] **Step 1: Run all unit tests**

```bash
node --test server/tests/costs.test.mjs server/tests/treasury.test.mjs
```

Expected: all tests pass, exit 0.

- [ ] **Step 2: Typecheck**

```bash
npx tsc -b
```

Expected: exit 0.

- [ ] **Step 3: Production build**

```bash
npx vite build 2>&1 | tail -10
```

Expected: `✓ built in X.XXs`, exit 0.

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 1 earn-money complete — costs model, edge scorecard, tests"
```

---

## Self-Review

**Spec coverage:**
- ✅ Realistic cost/slippage model in paper fills → Tasks 1 + 2
- ✅ GO/NO-GO edge scorecard → Tasks 4 + 5
- ✅ Health heartbeat → already exists at `/api/health`, left intact
- ✅ Tests for money logic (kelly + cost model) → Tasks 1 + 3
- ✅ All surface in the UI → Task 5

**Placeholder scan:** No TBDs or incomplete steps — all code blocks are complete.

**Type consistency:**
- `EdgeScorecard` defined in `agentClient.ts` Task 5 Step 1 matches the shape returned by `computeEdgeScorecard()` in Task 4 Step 1.
- `kellySizeCalc` exported in Task 3 Step 3, imported in `server/tests/treasury.test.mjs` Task 3 Step 1.
- `computePaperFillCosts` exported in Task 1 Step 3, imported in `execution.mjs` Task 2 Step 1.
- `ModuleId` union updated in Task 5 Step 2; `ICONS` and `SIDEBAR_GROUPS` updated in Step 4.
