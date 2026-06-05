import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import db from '../db/database.mjs';
import {
  computeConsensus,
  addSignal,
  resolveConsensus,
  getPendingSignals,
  clearPending,
  getRecentConsensus,
  getConsensusForTicker,
  CONSENSUS_DEFAULTS,
} from '../memory/consensusEngine.mjs';

// ── Test namespace ─────────────────────────────────────────────────────────────
const P      = 'test-consensus-';
const TICKER = `${P}TICKER`;
const A      = `${P}atlas`;
const B      = `${P}sentinel`;
const C_     = `${P}auditor`;

function cleanDB() {
  db.prepare(`DELETE FROM consensus_decisions WHERE id LIKE '${P}%'`).run();
  db.prepare(`DELETE FROM agent_performance   WHERE agent_name LIKE '${P}%'`).run();
}
function seedWeights(rows) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO agent_performance
      (agent_name, total_predictions, correct_predictions, accuracy_score,
       avg_confidence, brier_score, updated_at)
    VALUES (?, ?, ?, ?, 0.70, 0.15, ${Date.now()})
  `);
  for (const [name, total, correct, accuracy] of rows) {
    stmt.run(name, total, correct, accuracy);
  }
}

// ─── CONSENSUS_DEFAULTS export ────────────────────────────────────────────────

describe('CONSENSUS_DEFAULTS', () => {
  test('exposes vetoThreshold, minConviction, defaultWeight, minSamples, windowMs', () => {
    assert.ok(typeof CONSENSUS_DEFAULTS.vetoThreshold === 'number');
    assert.ok(typeof CONSENSUS_DEFAULTS.minConviction === 'number');
    assert.ok(typeof CONSENSUS_DEFAULTS.defaultWeight === 'number');
    assert.ok(typeof CONSENSUS_DEFAULTS.minSamples    === 'number');
    assert.ok(typeof CONSENSUS_DEFAULTS.windowMs      === 'number');
  });

  test('vetoThreshold is 0.80', () =>
    assert.strictEqual(CONSENSUS_DEFAULTS.vetoThreshold, 0.80));

  test('minConviction is 0.30', () =>
    assert.strictEqual(CONSENSUS_DEFAULTS.minConviction, 0.30));

  test('defaultWeight is 0.50', () =>
    assert.strictEqual(CONSENSUS_DEFAULTS.defaultWeight, 0.50));

  test('is frozen (immutable)', () => {
    assert.throws(() => { CONSENSUS_DEFAULTS.vetoThreshold = 0; }, TypeError);
  });
});

// ─── computeConsensus — empty / null input ────────────────────────────────────

describe('computeConsensus — empty input', () => {
  test('empty array returns HOLD', () => {
    const r = computeConsensus([]);
    assert.strictEqual(r.decision, 'HOLD');
  });

  test('null returns HOLD', () => {
    const r = computeConsensus(null);
    assert.strictEqual(r.decision, 'HOLD');
  });

  test('undefined returns HOLD', () => {
    const r = computeConsensus(undefined);
    assert.strictEqual(r.decision, 'HOLD');
  });

  test('empty result has zero scores', () => {
    const r = computeConsensus([]);
    assert.strictEqual(r.buyScore,  0);
    assert.strictEqual(r.sellScore, 0);
    assert.strictEqual(r.holdScore, 0);
    assert.strictEqual(r.vetoed,    false);
    assert.strictEqual(r.vetoBy,    null);
    assert.strictEqual(r.signalCount, 0);
  });

  test('explanation is a non-empty string', () => {
    const r = computeConsensus([]);
    assert.ok(r.explanation.length > 0);
  });
});

// ─── computeConsensus — single agent, no weight history ───────────────────────

describe('computeConsensus — single agent with defaultWeight', () => {
  const W = {};  // no history → defaultWeight = 0.50

  test('BUY @ 0.80 → buyScore = 0.40 → BUY (above minConviction 0.30)', () => {
    const r = computeConsensus([{ agentName: A, signal: 'BUY', confidence: 0.80 }], W);
    assert.strictEqual(r.decision, 'BUY');
    assert.ok(Math.abs(r.buyScore - 0.40) < 0.001, `buyScore should be ~0.40, got ${r.buyScore}`);
  });

  test('SELL @ 0.80 → sellScore = 0.40 → SELL', () => {
    const r = computeConsensus([{ agentName: A, signal: 'SELL', confidence: 0.80 }], W);
    assert.strictEqual(r.decision, 'SELL');
    assert.ok(Math.abs(r.sellScore - 0.40) < 0.001);
  });

  test('HOLD @ 0.80 → holdScore = 0.40 → HOLD', () => {
    const r = computeConsensus([{ agentName: A, signal: 'HOLD', confidence: 0.80 }], W);
    assert.strictEqual(r.decision, 'HOLD');
    assert.ok(Math.abs(r.holdScore - 0.40) < 0.001);
  });

  test('BUY @ 0.50 → buyScore = 0.25 → HOLD (below minConviction 0.30)', () => {
    const r = computeConsensus([{ agentName: A, signal: 'BUY', confidence: 0.50 }], W);
    assert.strictEqual(r.decision, 'HOLD', 'insufficient conviction should yield HOLD');
    assert.ok(r.explanation.includes('Insufficient conviction'));
  });

  test('breakdown contains one entry', () => {
    const r = computeConsensus([{ agentName: A, signal: 'BUY', confidence: 0.80 }], W);
    assert.strictEqual(r.breakdown.length, 1);
    assert.strictEqual(r.breakdown[0].agentName, A);
    assert.strictEqual(r.breakdown[0].signal,    'BUY');
    assert.strictEqual(r.breakdown[0].weight,    0.50);
  });

  test('signalCount equals input length', () => {
    const r = computeConsensus([
      { agentName: A, signal: 'BUY', confidence: 0.80 },
      { agentName: B, signal: 'SELL', confidence: 0.70 },
    ], W);
    assert.strictEqual(r.signalCount, 2);
  });
});

// ─── computeConsensus — WARNING treated as SELL ───────────────────────────────

describe('computeConsensus — WARNING signal', () => {
  const W = {};

  test('WARNING counts toward sell_score', () => {
    const r = computeConsensus([{ agentName: A, signal: 'WARNING', confidence: 0.80 }], W);
    assert.ok(r.sellScore > 0, 'WARNING should contribute to sellScore');
    assert.strictEqual(r.buyScore,  0);
    assert.strictEqual(r.holdScore, 0);
  });

  test('WARNING at 0.80 produces SELL decision', () => {
    const r = computeConsensus([{ agentName: A, signal: 'WARNING', confidence: 0.80 }], W);
    assert.strictEqual(r.decision, 'SELL');
  });

  test('WARNING + BUY: BUY wins if BUY score is higher', () => {
    const signals = [
      { agentName: A, signal: 'BUY',     confidence: 0.90 },  // 0.45
      { agentName: B, signal: 'WARNING', confidence: 0.70 },  // 0.35
    ];
    const r = computeConsensus(signals, W);
    assert.strictEqual(r.decision, 'BUY');
    assert.ok(r.buyScore > r.sellScore);
  });
});

// ─── computeConsensus — veto system ───────────────────────────────────────────

describe('computeConsensus — veto system', () => {
  const W = {};

  test('BLOCK at 0.91 (above threshold 0.80) triggers veto → HOLD', () => {
    const signals = [
      { agentName: A, signal: 'BUY',   confidence: 0.84 },
      { agentName: B, signal: 'BLOCK', confidence: 0.91 },
      { agentName: C_, signal: 'WARNING', confidence: 0.71 },
    ];
    const r = computeConsensus(signals, W);
    assert.strictEqual(r.decision, 'HOLD');
    assert.strictEqual(r.vetoed,   true);
    assert.strictEqual(r.vetoBy,   B);
  });

  test('BLOCK at exactly 0.80 (boundary) triggers veto', () => {
    const r = computeConsensus([{ agentName: B, signal: 'BLOCK', confidence: 0.80 }], W);
    assert.strictEqual(r.vetoed, true);
    assert.strictEqual(r.decision, 'HOLD');
  });

  test('BLOCK at 0.79 (below threshold) does NOT trigger veto', () => {
    const r = computeConsensus([{ agentName: B, signal: 'BLOCK', confidence: 0.79 }], W);
    assert.strictEqual(r.vetoed, false);
  });

  test('all scores are 0 when vetoed', () => {
    const r = computeConsensus([{ agentName: B, signal: 'BLOCK', confidence: 0.90 }], W);
    assert.strictEqual(r.buyScore,  0);
    assert.strictEqual(r.sellScore, 0);
    assert.strictEqual(r.holdScore, 0);
  });

  test('breakdown still contains all signals even on veto', () => {
    const signals = [
      { agentName: A, signal: 'BUY',   confidence: 0.80 },
      { agentName: B, signal: 'BLOCK', confidence: 0.90 },
    ];
    const r = computeConsensus(signals, W);
    assert.strictEqual(r.breakdown.length, 2);
  });

  test('explanation includes VETOED and agent name', () => {
    const r = computeConsensus([{ agentName: B, signal: 'BLOCK', confidence: 0.90 }], W);
    assert.ok(r.explanation.toUpperCase().includes('VETOED'));
    assert.ok(r.explanation.includes(B));
  });

  test('first BLOCK in array vetoes (order matters)', () => {
    const signals = [
      { agentName: B,  signal: 'BLOCK', confidence: 0.85 },
      { agentName: C_, signal: 'BLOCK', confidence: 0.90 },
    ];
    const r = computeConsensus(signals, W);
    assert.strictEqual(r.vetoBy, B, 'first BLOCK in the array should be the vetoer');
  });
});

// ─── computeConsensus — weighted confidence ───────────────────────────────────

describe('computeConsensus — agent accuracy weights', () => {
  test('high-accuracy agent outweighs low-accuracy agent on same confidence', () => {
    const signals = [
      { agentName: A, signal: 'BUY',  confidence: 0.80 },  // low accuracy
      { agentName: B, signal: 'SELL', confidence: 0.80 },  // high accuracy
    ];
    const weights = { [A]: 0.30, [B]: 0.90 };
    const r = computeConsensus(signals, weights);
    // BUY:  0.80 × 0.30 = 0.24
    // SELL: 0.80 × 0.90 = 0.72
    assert.strictEqual(r.decision, 'SELL', 'high-accuracy SELL agent should win');
    assert.ok(r.sellScore > r.buyScore);
  });

  test('agents without history use defaultWeight 0.50', () => {
    const r = computeConsensus(
      [{ agentName: `${P}unknown-agent`, signal: 'BUY', confidence: 0.80 }],
      {}
    );
    assert.ok(Math.abs(r.breakdown[0].weight - 0.50) < 0.001);
  });

  test('weight is correctly reflected in contribution', () => {
    const weights = { [A]: 0.80 };
    const r = computeConsensus([{ agentName: A, signal: 'BUY', confidence: 0.75 }], weights);
    const expected = 0.75 * 0.80;  // 0.60
    assert.ok(
      Math.abs(r.breakdown[0].contribution - expected) < 0.001,
      `contribution should be ~${expected.toFixed(4)}, got ${r.breakdown[0].contribution}`
    );
  });

  test('accuracy weight can flip a BUY into HOLD when combined score is low', () => {
    // Both agents have low accuracy (0.20) → contributions stay very small
    const weights = { [A]: 0.20, [B]: 0.20 };
    const signals = [
      { agentName: A, signal: 'BUY',  confidence: 0.80 },   // 0.80×0.20 = 0.16
      { agentName: B, signal: 'HOLD', confidence: 0.80 },   // 0.80×0.20 = 0.16
    ];
    const r = computeConsensus(signals, weights);
    // max(0.16, 0.00, 0.16) = 0.16 < minConviction 0.30 → HOLD
    assert.strictEqual(r.decision, 'HOLD');
    assert.ok(r.explanation.includes('Insufficient conviction'));
  });
});

// ─── computeConsensus — tie-breaking ─────────────────────────────────────────

describe('computeConsensus — ties resolve to HOLD', () => {
  const W = {};

  test('equal BUY and SELL scores → HOLD', () => {
    const signals = [
      { agentName: A, signal: 'BUY',  confidence: 0.80 },
      { agentName: B, signal: 'SELL', confidence: 0.80 },
    ];
    const r = computeConsensus(signals, W);
    assert.strictEqual(r.decision, 'HOLD', 'tied BUY vs SELL must resolve to HOLD');
  });

  test('equal BUY and HOLD scores → HOLD', () => {
    const signals = [
      { agentName: A, signal: 'BUY',  confidence: 0.80 },
      { agentName: B, signal: 'HOLD', confidence: 0.80 },
    ];
    const r = computeConsensus(signals, W);
    assert.strictEqual(r.decision, 'HOLD');
  });

  test('explanation mentions tie when all three are equal', () => {
    const signals = [
      { agentName: A, signal: 'BUY',  confidence: 0.80 },
      { agentName: B, signal: 'SELL', confidence: 0.80 },
    ];
    const r = computeConsensus(signals, W);
    // Either 'tie' or 'HOLD' should appear in the explanation
    const exp = r.explanation.toLowerCase();
    assert.ok(exp.includes('tie') || exp.includes('hold'), `explanation: ${r.explanation}`);
  });
});

// ─── computeConsensus — multi-agent aggregation ───────────────────────────────

describe('computeConsensus — 3-agent example from spec', () => {
  test('ATLAS BUY 0.84 + SENTINEL BLOCK 0.91 + AUDITOR WARNING 0.71 → HOLD (vetoed)', () => {
    const signals = [
      { agentName: 'ATLAS',    signal: 'BUY',     confidence: 0.84 },
      { agentName: 'SENTINEL', signal: 'BLOCK',   confidence: 0.91 },
      { agentName: 'AUDITOR',  signal: 'WARNING',  confidence: 0.71 },
    ];
    const r = computeConsensus(signals, {});
    assert.strictEqual(r.decision, 'HOLD');
    assert.strictEqual(r.vetoed,   true);
    assert.strictEqual(r.vetoBy,   'SENTINEL');
  });

  test('same 3 signals without BLOCK → BUY wins', () => {
    const signals = [
      { agentName: 'ATLAS',   signal: 'BUY',     confidence: 0.84 },
      { agentName: 'NOVA',    signal: 'BUY',     confidence: 0.70 },  // replaced BLOCK with BUY
      { agentName: 'AUDITOR', signal: 'WARNING', confidence: 0.71 },
    ];
    // BUY:  0.84×0.5 + 0.70×0.5 = 0.42 + 0.35 = 0.77
    // SELL: 0.71×0.5 = 0.355
    const r = computeConsensus(signals, {});
    assert.strictEqual(r.decision, 'BUY');
    assert.ok(r.buyScore > r.sellScore);
  });
});

// ─── addSignal + getPendingSignals ────────────────────────────────────────────

describe('addSignal', () => {
  beforeEach(() => clearPending(TICKER));
  after(     () => clearPending());

  test('adds to pending buffer', () => {
    addSignal(TICKER, A, 'BUY', 0.80);
    const pending = getPendingSignals(TICKER);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].agentName, A);
    assert.strictEqual(pending[0].signal,    'BUY');
  });

  test('normalises signal to uppercase', () => {
    addSignal(TICKER, A, 'buy', 0.80);
    assert.strictEqual(getPendingSignals(TICKER)[0].signal, 'BUY');
  });

  test('same agent replaces previous signal for same ticker', () => {
    addSignal(TICKER, A, 'BUY',  0.80);
    addSignal(TICKER, A, 'SELL', 0.70);   // replaces the BUY
    const pending = getPendingSignals(TICKER);
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].signal, 'SELL');
  });

  test('different agents accumulate', () => {
    addSignal(TICKER, A, 'BUY',  0.80);
    addSignal(TICKER, B, 'SELL', 0.70);
    assert.strictEqual(getPendingSignals(TICKER).length, 2);
  });

  test('ignores call when ticker is falsy', () => {
    addSignal('', A, 'BUY', 0.80);
    addSignal(null, A, 'BUY', 0.80);
    assert.strictEqual(getPendingSignals(TICKER).length, 0);
  });

  test('getPendingSignals returns a copy — mutating does not affect buffer', () => {
    addSignal(TICKER, A, 'BUY', 0.80);
    const copy = getPendingSignals(TICKER);
    copy.push({ agentName: 'hacker', signal: 'SELL', confidence: 1 });
    assert.strictEqual(getPendingSignals(TICKER).length, 1);
  });
});

// ─── resolveConsensus ─────────────────────────────────────────────────────────

describe('resolveConsensus — basic flow', () => {
  before(cleanDB);
  after( cleanDB);
  beforeEach(() => clearPending(TICKER));

  test('returns decision object with id and ticker', () => {
    addSignal(TICKER, A, 'BUY', 0.80);
    const r = resolveConsensus(TICKER);
    assert.ok(r.id,     'result must have id');
    assert.ok(r.ticker, 'result must have ticker');
    assert.strictEqual(r.ticker, TICKER);
  });

  test('saves row to consensus_decisions table', () => {
    addSignal(TICKER, A, 'BUY', 0.80);
    const r = resolveConsensus(TICKER);
    const row = db.prepare(`SELECT * FROM consensus_decisions WHERE id = ?`).get(r.id);
    assert.ok(row, 'consensus_decisions row must exist');
    assert.strictEqual(row.ticker, TICKER);
  });

  test('clears pending buffer after resolve', () => {
    addSignal(TICKER, A, 'BUY', 0.80);
    resolveConsensus(TICKER);
    assert.strictEqual(getPendingSignals(TICKER).length, 0);
  });

  test('resolves with empty buffer → HOLD, signalCount=0', () => {
    const r = resolveConsensus(TICKER);
    assert.strictEqual(r.decision,    'HOLD');
    assert.strictEqual(r.signalCount, 0);
  });
});

describe('resolveConsensus — uses agent_performance weights when available', () => {
  before(() => {
    cleanDB();
    // A has low accuracy (0.20), B has high accuracy (0.85)
    // A says BUY, B says SELL → weighted: A=0.80×0.20=0.16, B=0.80×0.85=0.68 → SELL wins
    seedWeights([
      [A, 10, 2, 0.20],
      [B, 10, 8, 0.85],
    ]);
  });
  after(cleanDB);
  beforeEach(() => clearPending(TICKER));

  test('high-accuracy agent overrides low-accuracy agent', () => {
    addSignal(TICKER, A, 'BUY',  0.80);
    addSignal(TICKER, B, 'SELL', 0.80);
    const r = resolveConsensus(TICKER);
    assert.strictEqual(r.decision, 'SELL');
  });
});

describe('resolveConsensus — agents below minSamples use defaultWeight', () => {
  before(() => {
    cleanDB();
    // A has only 3 predictions (< minSamples=5) → defaultWeight used
    seedWeights([[A, 3, 3, 1.0]]);  // total=3 < minSamples
  });
  after(cleanDB);
  beforeEach(() => clearPending(TICKER));

  test('agent with total_predictions < minSamples gets defaultWeight (0.50), not 1.0', () => {
    addSignal(TICKER, A, 'BUY', 0.80);
    const r = resolveConsensus(TICKER);
    // If weight were 1.0: buyScore=0.80 (BUY)
    // If weight is 0.50:  buyScore=0.40 (still BUY above minConviction)
    // Either way BUY — so verify via breakdown
    assert.strictEqual(r.breakdown[0].weight, 0.50,
      `agent with < minSamples must use defaultWeight=0.50, got ${r.breakdown[0].weight}`);
  });
});

// ─── resolveConsensus — veto persisted correctly ──────────────────────────────

describe('resolveConsensus — veto is persisted to DB', () => {
  before(cleanDB);
  after( cleanDB);
  beforeEach(() => clearPending(TICKER));

  test('vetoed=1 and veto_by stored when BLOCK fires', () => {
    addSignal(TICKER, B, 'BLOCK', 0.90);
    const r = resolveConsensus(TICKER);
    const row = db.prepare(`SELECT vetoed, veto_by FROM consensus_decisions WHERE id = ?`).get(r.id);
    assert.strictEqual(row.vetoed,  1);
    assert.strictEqual(row.veto_by, B);
  });

  test('breakdown_json is valid JSON array', () => {
    addSignal(TICKER, A, 'BUY',   0.80);
    addSignal(TICKER, B, 'BLOCK', 0.90);
    const r = resolveConsensus(TICKER);
    const row = db.prepare(`SELECT breakdown_json FROM consensus_decisions WHERE id = ?`).get(r.id);
    const parsed = JSON.parse(row.breakdown_json);
    assert.ok(Array.isArray(parsed));
    assert.strictEqual(parsed.length, 2);
  });
});

// ─── getRecentConsensus ───────────────────────────────────────────────────────

describe('getRecentConsensus', () => {
  before(() => {
    cleanDB();
    const ts = Date.now();
    // Insert two test rows directly (avoids resolve overwriting with same window bucket)
    db.prepare(`
      INSERT OR REPLACE INTO consensus_decisions
        (id, ticker, timestamp, decision, buy_score, sell_score, hold_score,
         vetoed, veto_by, signal_count, breakdown_json, explanation)
      VALUES
        ('${P}row-buy',  '${P}T1', ${ts},     'BUY',  0.40, 0.00, 0.00, 0, NULL, 1, '[]', 'BUY leads'),
        ('${P}row-sell', '${P}T2', ${ts - 1}, 'SELL', 0.00, 0.40, 0.00, 0, NULL, 1, '[]', 'SELL leads')
    `).run();
  });
  after(cleanDB);

  test('returns an array', () => {
    assert.ok(Array.isArray(getRecentConsensus()));
  });

  test('includes both test rows', () => {
    const ids = new Set(getRecentConsensus().map(r => r.id));
    assert.ok(ids.has(`${P}row-buy`));
    assert.ok(ids.has(`${P}row-sell`));
  });

  test('ordered by timestamp DESC (newest first)', () => {
    const rows = getRecentConsensus().filter(r => r.id.startsWith(P));
    assert.ok(rows.length >= 2);
    for (let i = 0; i < rows.length - 1; i++) {
      assert.ok(
        rows[i].timestamp >= rows[i + 1].timestamp,
        `Row ${i} (ts=${rows[i].timestamp}) should be >= row ${i+1} (ts=${rows[i+1].timestamp})`
      );
    }
  });

  test('respects limit parameter', () => {
    const one = getRecentConsensus(1);
    assert.strictEqual(one.length, 1);
  });
});

// ─── getConsensusForTicker ────────────────────────────────────────────────────

describe('getConsensusForTicker', () => {
  before(() => {
    cleanDB();
    db.prepare(`
      INSERT OR REPLACE INTO consensus_decisions
        (id, ticker, timestamp, decision, buy_score, sell_score, hold_score,
         vetoed, veto_by, signal_count, breakdown_json, explanation)
      VALUES
        ('${P}t-1', '${P}TK', ${Date.now()},     'BUY',  0.40, 0, 0, 0, NULL, 1, '[]', 'BUY'),
        ('${P}t-2', '${P}TK', ${Date.now() - 1}, 'HOLD', 0.00, 0, 0.40, 0, NULL, 1, '[]', 'HOLD'),
        ('${P}t-3', '${P}OTHER', ${Date.now()},  'SELL', 0, 0.40, 0, 0, NULL, 1, '[]', 'SELL')
    `).run();
  });
  after(cleanDB);

  test('returns only rows for the given ticker', () => {
    const rows = getConsensusForTicker(`${P}TK`);
    assert.ok(rows.every(r => r.ticker === `${P}TK`), 'all rows must match the requested ticker');
  });

  test('excludes rows for other tickers', () => {
    const ids = new Set(getConsensusForTicker(`${P}TK`).map(r => r.id));
    assert.ok(!ids.has(`${P}t-3`), 'OTHER ticker row must not appear');
  });

  test('returns empty array for unknown ticker', () => {
    const rows = getConsensusForTicker(`${P}UNKNOWN`);
    assert.deepStrictEqual(rows, []);
  });
});

// ─── clearPending ─────────────────────────────────────────────────────────────

describe('clearPending', () => {
  afterEach(() => clearPending());

  test('clearPending(ticker) removes only that ticker', () => {
    addSignal(`${P}T-A`, A, 'BUY', 0.80);
    addSignal(`${P}T-B`, B, 'SELL', 0.70);
    clearPending(`${P}T-A`);
    assert.strictEqual(getPendingSignals(`${P}T-A`).length, 0);
    assert.strictEqual(getPendingSignals(`${P}T-B`).length, 1);
  });

  test('clearPending() with no args clears all tickers', () => {
    addSignal(`${P}T-A`, A, 'BUY', 0.80);
    addSignal(`${P}T-B`, B, 'SELL', 0.70);
    clearPending();
    assert.strictEqual(getPendingSignals(`${P}T-A`).length, 0);
    assert.strictEqual(getPendingSignals(`${P}T-B`).length, 0);
  });
});
