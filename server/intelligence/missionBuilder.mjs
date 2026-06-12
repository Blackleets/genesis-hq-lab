import db from '../db/database.mjs';
import { nanoid } from '../utils.mjs';
import { getFuturesGovernorSnapshot } from '../crypto/futuresGovernor.mjs';
import { getLastFuturesBreakoutCycle } from '../strategies/futuresBreakoutEngine.mjs';

const FUTURES_TRADE_TYPES = [
  'crypto_futures_breakout_short_micro',
  'crypto_futures_breakout_short',
  'crypto_futures_breakout_short_alt',
  'crypto_futures_breakout_long',
];
const FUTURES_TRADE_TYPES_SQL = `('${FUTURES_TRADE_TYPES.join("','")}')`;
const DEFAULT_RECENT_LIMIT = 12;

function round2(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function round3(value) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

function summarizeOutcome(row) {
  return {
    tradeId: row.id,
    tradeType: row.trade_type,
    pair: row.asset_pair,
    side: row.outcome,
    pnl: round2(row.pnl),
    confidence: round3(row.confidence),
    capitalUsed: round2(row.capital_used),
    leverage: round2(row.leverage),
    reason: row.reason ?? null,
    exitReason: row.exit_reason ?? null,
    closedAt: row.closed_at,
  };
}

export function buildSupervisorMission() {
  const missionId = `sup-mission-${nanoid()}`;
  const governor = getFuturesGovernorSnapshot();
  const cycle = getLastFuturesBreakoutCycle() ?? null;

  const recentOutcomes = db.prepare(`
    SELECT id, trade_type, asset_pair, outcome, pnl, confidence, capital_used, leverage, reason, exit_reason, closed_at
    FROM trades
    WHERE status = 'closed'
      AND pnl IS NOT NULL
      AND trade_type IN ${FUTURES_TRADE_TYPES_SQL}
    ORDER BY closed_at DESC
    LIMIT ?
  `).all(DEFAULT_RECENT_LIMIT).map(summarizeOutcome);

  const aggregate = db.prepare(`
    SELECT
      COUNT(*) AS closedTrades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(pnl), 0) AS totalPnl,
      COALESCE(AVG(pnl), 0) AS avgPnl
    FROM trades
    WHERE status = 'closed'
      AND pnl IS NOT NULL
      AND trade_type IN ${FUTURES_TRADE_TYPES_SQL}
  `).get();

  const lessonRows = db.prepare(`
    SELECT l.id, l.lesson_text, l.new_rule, l.category, l.severity, l.created_at, t.trade_type, t.asset_pair, t.pnl
    FROM lessons l
    JOIN trades t ON t.id = l.trade_id
    WHERE t.trade_type IN ${FUTURES_TRADE_TYPES_SQL}
    ORDER BY l.created_at DESC
    LIMIT 10
  `).all();

  const lessonSummaries = lessonRows.map((row) => ({
    id: row.id,
    tradeType: row.trade_type,
    pair: row.asset_pair,
    pnl: round2(row.pnl),
    lesson: row.lesson_text,
    rule: row.new_rule,
    category: row.category,
    severity: row.severity,
    createdAt: row.created_at,
  }));

  const activeRuleSummaries = db.prepare(`
    SELECT id, rule_text, rule_type, scope, priority, source, created_at
    FROM operating_rules
    WHERE active = 1
      AND scope IN ('all', 'prediction_markets')
    ORDER BY priority ASC, created_at DESC
    LIMIT 12
  `).all().map((row) => ({
    id: row.id,
    text: row.rule_text,
    type: row.rule_type,
    scope: row.scope,
    priority: row.priority,
    source: row.source,
    createdAt: row.created_at,
  }));

  const mistakeSummaries = db.prepare(`
    SELECT mp.id, mp.pattern_desc, mp.category, mp.triggered_count, mp.last_triggered
    FROM mistake_patterns mp
    LEFT JOIN lessons l ON l.id = mp.lesson_id
    LEFT JOIN trades t ON t.id = l.trade_id
    WHERE mp.active = 1
      AND (t.trade_type IN ${FUTURES_TRADE_TYPES_SQL} OR l.id IS NULL)
    ORDER BY mp.triggered_count DESC, mp.last_triggered DESC
    LIMIT 8
  `).all().map((row) => ({
    id: row.id,
    description: row.pattern_desc,
    category: row.category,
    triggeredCount: row.triggered_count ?? 0,
    lastTriggered: row.last_triggered ?? null,
  }));

  const governorProfiles = governor.profiles.map((profile) => ({
    id: profile.id,
    tradeType: profile.tradeType,
    mode: profile.mode,
    reason: profile.reason,
    trades: profile.trades,
    winRate: profile.winRate,
    totalPnl: profile.totalPnl,
    avgPnl: profile.avgPnl,
    profitFactor: profile.profitFactor === Infinity ? 'inf' : profile.profitFactor,
    maxDrawdown: profile.maxDrawdown,
    rankScore: profile.rankScore,
    capitalMultiplier: profile.capitalMultiplier,
    leverageMultiplier: profile.leverageMultiplier,
    supervisor: profile.supervisor,
  }));

  const recentGovernorJournal = (governor.journal ?? []).slice(-8);
  const cycleSummary = cycle == null ? null : {
    startedAt: cycle.startedAt ?? null,
    completedAt: cycle.completedAt ?? null,
    scanned: cycle.scanned ?? 0,
    qualified: cycle.qualified ?? 0,
    executed: cycle.executed ?? 0,
    skipped: cycle.skipped ?? 0,
    blocked: Boolean(cycle.blocked),
    profiles: Array.isArray(cycle.profiles)
      ? cycle.profiles.map((profile) => ({
          profile: profile.profile,
          scanned: profile.scanned ?? 0,
          qualified: profile.qualified ?? 0,
          executed: profile.executed ?? 0,
          skipped: profile.skipped ?? 0,
          blocked: Boolean(profile.blocked),
          blockReason: profile.blockReason ?? null,
        }))
      : [],
  };

  const lessonsBySeverity = lessonSummaries.reduce((acc, lesson) => {
    acc[lesson.severity] = (acc[lesson.severity] ?? 0) + 1;
    return acc;
  }, {});

  const constraints = [
    'paper only',
    'advisory only',
    'no fund movement',
    'no direct execution',
    'no write access to trades',
    'no governor mutation',
    'preserve existing risk gates',
    'preserve existing execution semantics',
  ];

  const mission = {
    id: missionId,
    generatedAt: new Date().toISOString(),
    source: 'genesis-futures-supervisor',
    scope: 'futures_supervisor',
    targetObjective: 'Improve recommendation quality for the paper futures desk without mutating live execution behavior.',
    constraints,
    aggregate: {
      closedTrades: aggregate?.closedTrades ?? 0,
      wins: aggregate?.wins ?? 0,
      losses: Math.max(0, (aggregate?.closedTrades ?? 0) - (aggregate?.wins ?? 0)),
      winRate: (aggregate?.closedTrades ?? 0) > 0 ? round3((aggregate.wins ?? 0) / aggregate.closedTrades) : null,
      totalPnl: round2(aggregate?.totalPnl ?? 0),
      avgPnl: round2(aggregate?.avgPnl ?? 0),
    },
    governorProfiles,
    recentOutcomes,
    recentGovernorJournal,
    lessonSummaries,
    lessonsBySeverity,
    activeRuleSummaries,
    mistakeSummaries,
    cycleSummary,
    metadata: {
      recentOutcomeCount: recentOutcomes.length,
      lessonCount: lessonSummaries.length,
      activeRuleCount: activeRuleSummaries.length,
      mistakePatternCount: mistakeSummaries.length,
      foundryPathConfigured: Boolean(process.env.FRACTAL_FOUNDRY_PATH?.trim()),
      lastCycleProfiles: Array.isArray(cycleSummary?.profiles) ? cycleSummary.profiles.length : 0,
    },
  };

  return mission;
}

export function summarizeMissionForProvider(mission) {
  return {
    missionId: mission.id,
    goal: mission.targetObjective,
    constraints: mission.constraints,
    successCriteria: [
      'Produce a stronger advisory prompt for the futures desk.',
      'Recommend filters or profile pressure changes without changing execution.',
      'Cite recent losses, lessons, and governor pressure honestly.',
      'Keep all recommendations paper-only and preserve current risk gates.',
    ],
    deliverables: [
      'recommended_prompt',
      'recommended_rules',
      'risk_notes',
      'justification',
    ],
    domainTerms: [
      'paper only',
      'advisory only',
      'risk gates',
      'governor',
      'expectancy',
      'drawdown',
      'futures desk',
      'closed trades',
      'lessons',
      'cooldown',
    ],
    context: {
      aggregate: mission.aggregate,
      governorProfiles: mission.governorProfiles,
      recentOutcomes: mission.recentOutcomes,
      lessonSummaries: mission.lessonSummaries,
      activeRuleSummaries: mission.activeRuleSummaries,
      mistakeSummaries: mission.mistakeSummaries,
      cycleSummary: mission.cycleSummary,
      metadata: mission.metadata,
    },
  };
}
