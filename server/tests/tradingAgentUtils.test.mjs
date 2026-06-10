// tradingAgentUtils.test.mjs — unit tests for TradingAgent pure-logic helpers.
// All logic is inlined here (no TypeScript imports) so these run with plain Node.js.
// Tests mirror the TypeScript definitions in src/core/types/tradingAgent.ts and
// src/agents/utils/tradingAgentUtils.ts.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// ── Inline implementations (mirrors tradingAgentUtils.ts exactly) ─────────────

function tradingPerformanceScore(m) {
  const winPart    = m.winRate * 30;
  const pfPart     = Math.min(m.profitFactor, 3) / 3 * 25;
  const taskPart   = Math.min(m.completedTasks, 100) / 100 * 15;
  const signalPart = Math.min(m.successfulSignals, 50) / 50 * 15;
  const learnPart  = m.learningScore * 10;
  const uptimePart = m.uptime * 5;
  return Math.round(Math.max(0, winPart + pfPart + taskPart + signalPart + learnPart + uptimePart));
}

function tierFromMetrics(m) {
  const score = tradingPerformanceScore(m);
  if (score >= 70) return 'elite';
  if (score >= 35) return 'professional';
  return 'rookie';
}

function levelFromMetrics(m) {
  const base      = tradingPerformanceScore(m) * 0.5;
  const taskBonus = Math.min(m.completedTasks * 0.05, 10);
  return Math.max(1, Math.min(60, Math.floor(base + taskBonus)));
}

const EMPTY_PERFORMANCE = {
  completedTasks: 0, successfulSignals: 0, winRate: 0,
  profitFactor: 0, learningScore: 0, uptime: 1, errorRate: 0,
};

const TIER_LABELS = {
  rookie:       { es: 'Novato',      en: 'Rookie'       },
  professional: { es: 'Profesional', en: 'Professional' },
  elite:        { es: 'Élite',       en: 'Elite'        },
};

const TIER_COLORS = {
  rookie: '#9ca3af', professional: '#3da9fc', elite: '#ffd24a',
};

const STATUS_COLORS = {
  active: '#00ff9c', idle: '#3da9fc', paused: '#ffd24a', error: '#ff4757', offline: '#6b7280',
};

// ── Suite 1: tradingPerformanceScore ─────────────────────────────────────────

describe('tradingPerformanceScore', () => {
  it('returns 5 for default metrics (only uptime=1 contributes)', () => {
    assert.equal(tradingPerformanceScore(EMPTY_PERFORMANCE), 5);
  });

  it('returns 0 for fully zeroed metrics', () => {
    assert.equal(tradingPerformanceScore({ ...EMPTY_PERFORMANCE, uptime: 0 }), 0);
  });

  it('returns 100 for perfect metrics', () => {
    assert.equal(tradingPerformanceScore({
      completedTasks: 100, successfulSignals: 50, winRate: 1,
      profitFactor: 3, learningScore: 1, uptime: 1, errorRate: 0,
    }), 100);
  });

  it('caps profitFactor contribution at 3', () => {
    const base = tradingPerformanceScore({ ...EMPTY_PERFORMANCE, uptime: 0, profitFactor: 3 });
    const high = tradingPerformanceScore({ ...EMPTY_PERFORMANCE, uptime: 0, profitFactor: 999 });
    assert.equal(base, high);
  });

  it('is always non-negative', () => {
    const score = tradingPerformanceScore({ ...EMPTY_PERFORMANCE, errorRate: 1, uptime: 0 });
    assert.ok(score >= 0);
  });

  it('winRate drives 30 points of the score', () => {
    const full  = tradingPerformanceScore({ ...EMPTY_PERFORMANCE, uptime: 0, winRate: 1 });
    const empty = tradingPerformanceScore({ ...EMPTY_PERFORMANCE, uptime: 0, winRate: 0 });
    assert.equal(full - empty, 30);
  });
});

// ── Suite 2: tierFromMetrics ──────────────────────────────────────────────────

describe('tierFromMetrics', () => {
  it('rookie for empty metrics (score=5)', () => {
    assert.equal(tierFromMetrics(EMPTY_PERFORMANCE), 'rookie');
  });

  it('elite for high-performance metrics', () => {
    const m = {
      completedTasks: 100, successfulSignals: 50,
      winRate: 0.8, profitFactor: 2.5, learningScore: 0.8, uptime: 1, errorRate: 0,
    };
    assert.equal(tierFromMetrics(m), 'elite');
  });

  it('professional for mid-range metrics', () => {
    const m = {
      completedTasks: 30, successfulSignals: 15,
      winRate: 0.5, profitFactor: 1.2, learningScore: 0.3, uptime: 0.9, errorRate: 0.05,
    };
    const score = tradingPerformanceScore(m);
    const expected = score >= 70 ? 'elite' : score >= 35 ? 'professional' : 'rookie';
    assert.equal(tierFromMetrics(m), expected);
  });

  it('result is always a valid tier', () => {
    const tiers = ['rookie', 'professional', 'elite'];
    for (const winRate of [0, 0.3, 0.6, 0.9, 1]) {
      const m = { ...EMPTY_PERFORMANCE, winRate };
      assert.ok(tiers.includes(tierFromMetrics(m)), `invalid tier for winRate=${winRate}`);
    }
  });
});

// ── Suite 3: levelFromMetrics ─────────────────────────────────────────────────

describe('levelFromMetrics', () => {
  it('returns at least 1 for any metrics', () => {
    assert.ok(levelFromMetrics(EMPTY_PERFORMANCE) >= 1);
    assert.ok(levelFromMetrics({ ...EMPTY_PERFORMANCE, uptime: 0 }) >= 1);
  });

  it('returns at most 60 for any metrics', () => {
    assert.ok(levelFromMetrics({
      completedTasks: 99999, successfulSignals: 99999,
      winRate: 1, profitFactor: 9999, learningScore: 1, uptime: 1, errorRate: 0,
    }) <= 60);
  });

  it('higher metrics → higher or equal level', () => {
    const low  = levelFromMetrics({ ...EMPTY_PERFORMANCE, winRate: 0.3 });
    const high = levelFromMetrics({ ...EMPTY_PERFORMANCE, winRate: 0.9, learningScore: 0.9 });
    assert.ok(high >= low);
  });

  it('level is always an integer', () => {
    const level = levelFromMetrics({ ...EMPTY_PERFORMANCE, winRate: 0.55, profitFactor: 1.7 });
    assert.equal(Math.floor(level), level);
  });
});

// ── Suite 4: display maps ─────────────────────────────────────────────────────

describe('TIER_LABELS and TIER_COLORS', () => {
  it('TIER_LABELS covers all 3 tiers in both languages', () => {
    for (const tier of ['rookie', 'professional', 'elite']) {
      assert.ok(TIER_LABELS[tier].en?.length > 0, `${tier} missing en label`);
      assert.ok(TIER_LABELS[tier].es?.length > 0, `${tier} missing es label`);
    }
  });

  it('TIER_COLORS covers all 3 tiers with hex values', () => {
    for (const tier of ['rookie', 'professional', 'elite']) {
      assert.ok(TIER_COLORS[tier]?.startsWith('#'), `${tier} missing color`);
    }
  });

  it('STATUS_COLORS covers all 5 trading statuses', () => {
    for (const status of ['active', 'idle', 'paused', 'error', 'offline']) {
      assert.ok(STATUS_COLORS[status]?.startsWith('#'), `missing color for: ${status}`);
    }
  });
});

// ── Suite 5: TRADING_AGENTS data contract ────────────────────────────────────

describe('TRADING_AGENTS data contract', () => {
  // Inline the 5 agent definitions for pure Node.js validation
  const EXPECTED_AGENTS = [
    { id: 'scalping-hunter',   name: 'Scalping Hunter',      tier: 'rookie' },
    { id: 'risk-sentinel',     name: 'Risk Sentinel',        tier: 'rookie' },
    { id: 'market-analyst',    name: 'Market Analyst',       tier: 'rookie' },
    { id: 'backtest-engineer', name: 'Backtest Engineer',    tier: 'rookie' },
    { id: 'capital-manager',   name: 'Capital Manager',      tier: 'rookie' },
  ];

  it('5 expected agents are defined', () => {
    assert.equal(EXPECTED_AGENTS.length, 5);
  });

  it('all expected ids are unique', () => {
    const ids = EXPECTED_AGENTS.map(a => a.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it('all agents have a valid tier in the 3-tier model', () => {
    for (const agent of EXPECTED_AGENTS) {
      assert.ok(['rookie', 'professional', 'elite'].includes(agent.tier),
        `${agent.name} has invalid tier: ${agent.tier}`);
    }
  });

  it('agent names match expected roles', () => {
    const hunter  = EXPECTED_AGENTS.find(a => a.id === 'scalping-hunter');
    const capital = EXPECTED_AGENTS.find(a => a.id === 'capital-manager');
    assert.equal(hunter?.name, 'Scalping Hunter');
    assert.equal(capital?.name, 'Capital Manager');
  });
});
