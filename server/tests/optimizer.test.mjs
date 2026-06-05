import { test } from 'node:test';
import assert from 'node:assert/strict';
import { objective, generateCandidates, optimize, shouldAdopt } from '../crypto/optimizer.mjs';

const M = (over = {}) => ({ trades: 50, expectancy: 0.1, maxDrawdown: 0.02, winRate: 0.5, netPnl: 5, ...over });

test('objective is -Infinity below the minimum trade count', () => {
  assert.strictEqual(objective(M({ trades: 5 }), { minTrades: 20 }), -Infinity);
});

test('objective rises with expectancy (trades & drawdown equal)', () => {
  const lo = objective(M({ expectancy: 0.1 }), { minTrades: 20 });
  const hi = objective(M({ expectancy: 0.3 }), { minTrades: 20 });
  assert.ok(hi > lo, `${hi} should beat ${lo}`);
});

test('objective falls as drawdown grows (others equal)', () => {
  const low  = objective(M({ maxDrawdown: 0.01 }), { minTrades: 20 });
  const high = objective(M({ maxDrawdown: 0.20 }), { minTrades: 20 });
  assert.ok(low > high, `lower drawdown ${low} should beat higher ${high}`);
});

test('generateCandidates includes the base and varies each dimension within bounds', () => {
  const base = { targetPct: 0.015, stopPct: 0.0075 };
  const space = { targetPct: [0.01, 0.015, 0.02], stopPct: [0.005, 0.0075] };
  const cands = generateCandidates(base, space);
  // base + (3-1 other targets) + (2-1 other stops) at least; base present
  assert.ok(cands.some(c => c.targetPct === 0.015 && c.stopPct === 0.0075), 'base included');
  assert.ok(cands.some(c => c.targetPct === 0.02 && c.stopPct === 0.0075), 'target varied');
  assert.ok(cands.some(c => c.stopPct === 0.005 && c.targetPct === 0.015), 'stop varied');
  // every candidate keeps keys from base
  for (const c of cands) {
    assert.ok('targetPct' in c && 'stopPct' in c);
  }
});

test('optimize picks the candidate with the best objective via injected evaluate', () => {
  const candidates = [
    { targetPct: 0.01 },
    { targetPct: 0.02 }, // best
    { targetPct: 0.03 },
  ];
  // evaluate returns metrics whose expectancy peaks at targetPct 0.02
  const evaluate = (p) => M({ expectancy: 0.5 - Math.abs(p.targetPct - 0.02) * 10, trades: 50 });
  const best = optimize({ candidates, evaluate, minTrades: 20 });
  assert.strictEqual(best.params.targetPct, 0.02);
  assert.ok(best.score > -Infinity);
});

test('optimize returns null best when every candidate is below minTrades', () => {
  const candidates = [{ targetPct: 0.01 }, { targetPct: 0.02 }];
  const evaluate = () => M({ trades: 3 });
  const best = optimize({ candidates, evaluate, minTrades: 20 });
  assert.strictEqual(best.params, null);
});

test('shouldAdopt only adopts a candidate that strictly beats current out-of-sample', () => {
  const current = { targetPct: 0.015 };
  const candidate = { targetPct: 0.02 };
  // candidate better OOS
  const better = shouldAdopt({
    current, candidate,
    evaluate: (p) => p === candidate ? M({ expectancy: 0.3 }) : M({ expectancy: 0.1 }),
    minTrades: 20,
  });
  assert.strictEqual(better.adopt, true);

  // candidate worse OOS
  const worse = shouldAdopt({
    current, candidate,
    evaluate: (p) => p === candidate ? M({ expectancy: 0.05 }) : M({ expectancy: 0.1 }),
    minTrades: 20,
  });
  assert.strictEqual(worse.adopt, false);
});

test('shouldAdopt refuses a candidate with non-positive expectancy even if it "wins"', () => {
  const current = { targetPct: 0.015 };
  const candidate = { targetPct: 0.02 };
  // both negative, candidate "less negative" → still must not adopt
  const res = shouldAdopt({
    current, candidate,
    evaluate: (p) => p === candidate ? M({ expectancy: -0.05 }) : M({ expectancy: -0.10 }),
    minTrades: 20,
  });
  assert.strictEqual(res.adopt, false);
});
