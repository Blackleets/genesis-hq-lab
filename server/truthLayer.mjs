// truthLayer.mjs — canonical runtime state for Genesis HQ.
//
// Single source of truth aggregation layer.
// Called by /api/system/health to produce a complete system snapshot.
//
// Does NOT replace existing API endpoints.
// Aggregates their outputs into one structured response
// so frontend and monitoring can see the full picture at a glance.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import db from './db/database.mjs';
import { getTreasury, getPeakCapitalMeta } from './trading/treasury.mjs';
import { getOpenTrades } from './memory/tradingMemory.mjs';
import { getOrgState } from './command/orgState.mjs';
import { getKalshiStatus } from './kalshi/adapter.mjs';
import { getOptimizerHeartbeat } from './crypto/cryptoAnalytics.mjs';
import { getAgentPerformance } from './memory/decisionAccuracyEngine.mjs';
import { getRecentConsensus } from './memory/consensusEngine.mjs';
import { detectStalePositions, getPnLFreshness, getRealizedPnl } from './memory/pnlEngine.mjs';
import { getReconciliationStatus } from './memory/reconciliationEngine.mjs';
import { getConfidenceDiagnostics } from './intelligence/confidenceEngine.mjs';
import { getLearningDiagnostics } from './learning/learningEngine.mjs';
import { getGlobalRiskDiagnostics } from './risk/globalRiskEngine.mjs';
import { getAlphaReport } from './research/alphaValidationEngine.mjs';
import { getSchedulerStatus } from './trading/executionScheduler.mjs';
import { getDbHealth } from './persistence/dbReplicator.mjs';
import {
  getRecentEvents,
  countBlockedTrades,
  getActiveWarnings,
  getTopFailureReason,
} from './observability/eventTimeline.mjs';

// ── Structured logger for desync events ──────────────────────────────────────

const _log = {
  warn(tag, msg, data = {}) {
    console.warn(`[truth:${tag}] ${msg}`, Object.keys(data).length ? data : '');
  },
  error(tag, msg, err) {
    console.error(`[truth:${tag}] ${msg}:`, err?.message ?? err);
  },
};

// ── Individual health probes ──────────────────────────────────────────────────

function probeDatabase() {
  try {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM trades`).get()?.n ?? 0;
    const tableCount = db.prepare(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'`
    ).get()?.n ?? 0;
    return { ok: true, tables: tableCount, totalTrades: count };
  } catch (err) {
    _log.error('db', 'SQLite probe failed', err);
    return { ok: false, error: err.message };
  }
}

// Durable persistence: warns (never errors) when hybrid mode can't reach Supabase.
function probeDurablePersistence() {
  try {
    const h = getDbHealth();
    if (h.mode === 'sqlite' || !h.enabled) {
      return { ok: true, mode: h.mode, durable: false, note: 'SQLite-only (no durable replication)' };
    }
    const degraded = !h.postgres.connected || (h.replication.failedSyncs > 0 && h.replication.rowsSynced === 0);
    return {
      ok: !degraded,
      mode: h.mode,
      durable: true,
      connected: h.postgres.connected,
      rowsSynced: h.replication.rowsSynced,
      failedSyncs: h.replication.failedSyncs,
      lastSyncAt: h.replication.lastSyncAt,
      syncLagMs: h.replication.syncLagMs,
      queuePending: h.replication.queuePending,
      // A degraded durable layer is a WARNING: trading continues on SQLite.
      warning: degraded ? 'Supabase unreachable — trading continues on SQLite, durability paused' : null,
    };
  } catch (err) {
    return { ok: true, durable: false, warning: `persistence probe failed: ${err.message}` };
  }
}

function probeTreasury() {
  try {
    const treasury = getTreasury();
    return {
      ok: true,
      total: treasury.total,
      available: treasury.available,
      inTrades: treasury.inTrades ?? 0,
      isPaused: treasury.isPaused ?? false,
      drawdownPct: treasury.drawdownPct ?? 0,
    };
  } catch (err) {
    _log.error('treasury', 'Treasury probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeAgentRunner() {
  try {
    const openTrades = getOpenTrades().length;

    // Read heartbeat written by agentRunner on each cycle
    let heartbeat = null;
    try {
      const hbPath = join(process.cwd(), 'data', 'memory', 'agent_heartbeat.json');
      if (existsSync(hbPath)) {
        heartbeat = JSON.parse(readFileSync(hbPath, 'utf8'));
      }
    } catch { /* heartbeat not written yet */ }

    const lastTickAt = heartbeat?.lastTickAt ?? null;
    const msSinceLastTick = lastTickAt
      ? Date.now() - new Date(lastTickAt).getTime()
      : null;
    const agentAlive = msSinceLastTick !== null && msSinceLastTick < 10 * 60_000;

    if (lastTickAt && !agentAlive) {
      _log.warn('agent', 'Agent runner appears stalled', {
        lastTickAt,
        msSinceLastTick,
      });
    }

    // Active LLM provider — Groq/Gemini are the free-tier default; Claude is paid.
    // Reported directly from env so it stays accurate regardless of heartbeat age.
    const llmProvider = process.env.GROQ_API_KEY
      ? 'groq'
      : process.env.GEMINI_API_KEY
        ? 'gemini'
        : process.env.ANTHROPIC_API_KEY
          ? 'claude'
          : 'none';

    return {
      ok: agentAlive || lastTickAt === null,  // null = first boot, not stalled
      openTrades,
      lastTickAt,
      agentAlive,
      msSinceLastTick,
      totalCycles: heartbeat?.totalCycles ?? 0,
      claudeEnabled: heartbeat?.claudeEnabled ?? false,
      llmProvider,
      neverStarted: lastTickAt === null,
    };
  } catch (err) {
    _log.error('agent', 'Agent runner probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeKalshi() {
  // Kalshi is a prediction-market venue. In FUTURES_ONLY_MODE the desk never touches
  // it, so a missing key / disconnected WS is expected — not a fault. The flag lets the
  // UI render those rows as neutral "not in use" instead of red alarms.
  const futuresOnlyMode = !['0', 'false', 'no', 'off'].includes(
    (process.env.FUTURES_ONLY_MODE ?? 'true').toLowerCase(),
  );
  try {
    const status = getKalshiStatus();
    return {
      ok: true,
      hasApiKey: status.hasApiKey ?? false,
      wsConnected: status.wsConnected ?? false,
      mode: status.mode ?? 'unknown',
      inUse: !futuresOnlyMode,
    };
  } catch (err) {
    _log.error('kalshi', 'Kalshi probe failed', err);
    return { ok: false, error: err.message, inUse: !futuresOnlyMode };
  }
}

function probeOptimizer() {
  try {
    const hb = getOptimizerHeartbeat();
    return { ok: true, ...hb };
  } catch (err) {
    _log.error('optimizer', 'Optimizer probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeLearning() {
  try {
    const lessonCount = db.prepare(`SELECT COUNT(*) AS n FROM lessons`).get()?.n ?? 0;
    const vetoCount   = db.prepare(`SELECT COUNT(*) AS n FROM mistake_patterns WHERE active = 1`).get()?.n ?? 0;
    const performance = getAgentPerformance();
    const lastConsensus = getRecentConsensus(1)[0] ?? null;

    return {
      ok: true,
      lessons: lessonCount,
      activeVetoes: vetoCount,
      agentsTracked: performance.length,
      lastConsensusDecision: lastConsensus?.decision ?? null,
      lastConsensusAt: lastConsensus?.timestamp ?? null,
    };
  } catch (err) {
    _log.error('learning', 'Learning probe failed', err);
    return { ok: false, error: err.message };
  }
}

function probeFounderMode() {
  try {
    const state = getOrgState();
    return {
      ok: true,
      mode: state.mode ?? 'unknown',
      focus: state.focus ?? null,
      goal: state.goal ?? null,
      deptMarkets: state.deptMarkets ?? 'active',
      deptCrypto: state.deptCrypto ?? 'active',
    };
  } catch (err) {
    _log.error('founder', 'Founder mode probe failed', err);
    return { ok: false, error: err.message };
  }
}

// ── Execution diagnostics probe ───────────────────────────────────────────────

function probeExecution() {
  try {
    const stalePositions = detectStalePositions(48);
    const freshness = getPnLFreshness();
    const realized = getRealizedPnl();
    const treasury = getTreasury();

    // Flag if unrealized PnL is unavailable (open positions with no price)
    const unrealizedDegraded = treasury.pnlDegraded === true;

    if (stalePositions.length > 0) {
      for (const p of stalePositions) {
        _log.warn('stale_position', `Trade ${p.id} open for ${p.ageHours}h — may be orphaned`, { id: p.id, ageHours: p.ageHours });
      }
    }

    const peakMeta = getPeakCapitalMeta();
    const reconciliation = getReconciliationStatus();

    return {
      ok: true,
      realizedPnl: realized.totalPnl,
      winRate: realized.winRate,
      totalTrades: realized.total,
      stalePositionCount: stalePositions.length,
      stalePositions,
      pnlLastSettledAt: freshness.lastSettledAt,
      pnlFresh: freshness.fresh,
      unrealizedDegraded,
      unrealizedPnl: treasury.unrealizedPnl,
      drawdownProtection: {
        peakCapital: peakMeta.value,
        source: peakMeta.source,
        persistence: peakMeta.source === 'sqlite',
        peakCapitalLoaded: peakMeta.value > 0,
      },
      startupReconciliation: {
        status: reconciliation.status,
        recoveredPositions: reconciliation.recoveredPositions,
        orphanCount: reconciliation.orphanCount,
        unresolvedExposure: reconciliation.unresolvedExposure,
        lastRun: reconciliation.lastRun,
        issueCount: (reconciliation.issues ?? []).length,
        safeMode: reconciliation.status === 'degraded',
      },
    };
  } catch (err) {
    _log.error('execution', 'Execution diagnostics probe failed', err);
    return { ok: false, error: err.message };
  }
}

// ── Confidence engine diagnostics probe ──────────────────────────────────────

function probeConfidenceEngine() {
  try {
    return { ok: true, ...getConfidenceDiagnostics() };
  } catch (err) {
    _log.error('confidence', 'Confidence engine probe failed', err);
    return { ok: false, error: err.message };
  }
}

// ── Learning engine diagnostics probe ────────────────────────────────────────

function probeLearningEngine() {
  try {
    return { ok: true, ...getLearningDiagnostics() };
  } catch (err) {
    _log.error('learningEngine', 'Learning engine probe failed', err);
    return { ok: false, error: err.message };
  }
}

// ── Alpha research probe ──────────────────────────────────────────────────────

function probeAlphaResearch() {
  try {
    const report = getAlphaReport();
    const s = report.summary ?? {};
    return {
      ok: true,
      verdict:            report.verdict,
      hasEdge:            report.hasEdge,
      verdictReason:      report.verdictReason,
      tradeHistory:       report.tradeHistory,
      dataInsufficient:   s.dataInsufficient ?? true,
      expectancy:         s.expectancyPerTrade,
      winRate:            s.winRate,
      calibrationScore:   s.calibrationScore,
      profitFactor:       s.profitFactor,
      bestAgent:          s.bestAgent,
      worstAgent:         s.worstAgent,
      strongestMarket:    s.strongestMarket,
      weakestMarket:      s.weakestMarket,
      confidenceAccuracy: s.confidenceAccuracy,
      falsePositiveRate:  s.falsePositiveRate,
    };
  } catch (err) {
    _log.error('alphaResearch', 'Alpha research probe failed', err);
    return { ok: false, error: err.message };
  }
}

// ── Live trading probe (Phase 6A scheduler) ───────────────────────────────────

function probeLiveTrading() {
  try {
    return { ok: true, ...getSchedulerStatus() };
  } catch (err) {
    _log.error('liveTrading', 'Live trading probe failed', err);
    return { ok: false, error: err.message };
  }
}

// ── Operator visibility probe ─────────────────────────────────────────────────

function probeOperatorVisibility() {
  try {
    return {
      ok: true,
      recentEvents:     getRecentEvents(15),
      blockedTrades24h: countBlockedTrades(),
      activeWarnings:   getActiveWarnings(),
      topFailureReason: getTopFailureReason(),
    };
  } catch (err) {
    _log.error('operatorVisibility', 'Operator visibility probe failed', err);
    return { ok: false, error: err.message, recentEvents: [], blockedTrades24h: 0, activeWarnings: [], topFailureReason: null };
  }
}

// ── Global risk engine probe ──────────────────────────────────────────────────

function probeGlobalRisk() {
  try {
    const diag = getGlobalRiskDiagnostics();
    return { ok: true, ...diag };
  } catch (err) {
    _log.error('globalRisk', 'Global risk engine probe failed', err);
    // Fail-safe: surface as CRITICAL if probe itself throws
    return { ok: false, score: 100, band: 'CRITICAL', safeMode: true, activeFlags: ['PROBE_FAILED'], error: err.message };
  }
}

// ── Stale data detection ──────────────────────────────────────────────────────

function detectStaleState(checks) {
  const issues = [];

  if (!checks.agentRunner.agentAlive && !checks.agentRunner.neverStarted) {
    issues.push({
      severity: 'warn',
      system: 'agent_runner',
      message: 'Agent runner has not ticked in >10 minutes',
      data: { lastTickAt: checks.agentRunner.lastTickAt },
    });
  }

  // Only surface the Kalshi key gap when the desk actually uses Kalshi. In
  // FUTURES_ONLY_MODE it's intentionally idle, so this would be pure noise.
  if (checks.kalshi.inUse && !checks.kalshi.hasApiKey) {
    issues.push({
      severity: 'info',
      system: 'kalshi',
      message: 'Kalshi API key not set — Kalshi markets unavailable',
    });
  }

  if (checks.treasury.isPaused) {
    issues.push({
      severity: 'info',
      system: 'treasury',
      message: 'Trading is paused',
    });
  }

  if (checks.database.ok && checks.database.totalTrades === 0) {
    issues.push({
      severity: 'info',
      system: 'database',
      message: 'No trades in database — system never executed a trade',
    });
  }

  if (checks.executionDiagnostics?.stalePositionCount > 0) {
    issues.push({
      severity: 'warn',
      system: 'execution',
      message: `${checks.executionDiagnostics.stalePositionCount} position(s) open >48h without resolution — possible orphans`,
    });
  }

  if (checks.executionDiagnostics?.unrealizedDegraded && checks.agentRunner.openTrades > 0) {
    issues.push({
      severity: 'info',
      system: 'execution',
      message: 'Unrealized PnL unavailable — open positions exist but live prices not cached',
    });
  }

  if (checks.executionDiagnostics?.pnlFresh === false) {
    issues.push({
      severity: 'info',
      system: 'execution',
      message: 'No trade settled in >24h — PnL data may be stale',
    });
  }

  const recon = checks.executionDiagnostics?.startupReconciliation;
  if (recon?.safeMode) {
    issues.push({
      severity: 'warn',
      system: 'reconciliation',
      message: `SAFE_MODE active — ${recon.issueCount} reconciliation issue(s). New trades blocked. POST /api/reconciliation/clear to resume.`,
    });
  } else if (recon?.status === 'recovering') {
    issues.push({
      severity: 'info',
      system: 'reconciliation',
      message: `Reconciliation recovering — ${recon.orphanCount} orphan(s), $${recon.unresolvedExposure?.toFixed(2) ?? '0.00'} unresolved exposure`,
    });
  }

  // Log issues to server console
  for (const issue of issues) {
    if (issue.severity === 'warn') {
      _log.warn('stale', issue.message, issue.data ?? {});
    }
  }

  return issues;
}

// ── Main export: full system truth snapshot ───────────────────────────────────

/**
 * Gather canonical runtime state from all subsystems.
 * wsClientCount — pass in from the HTTP server (cannot import wsClients here).
 *
 * Returns a structured object safe to serialize as JSON.
 */
export function getSystemTruth(wsClientCount = 0) {
  const startMs = Date.now();

  const checks = {
    database:             probeDatabase(),
    durablePersistence:   probeDurablePersistence(),
    treasury:             probeTreasury(),
    agentRunner:          probeAgentRunner(),
    kalshi:               probeKalshi(),
    optimizer:            probeOptimizer(),
    learning:             probeLearning(),
    founderMode:          probeFounderMode(),
    executionDiagnostics: probeExecution(),
    confidenceEngine:      probeConfidenceEngine(),
    learningEngine:        probeLearningEngine(),
    globalRisk:            probeGlobalRisk(),
    operatorVisibility:    probeOperatorVisibility(),
    alphaResearch:         probeAlphaResearch(),
    liveTrading:           probeLiveTrading(),
  };

  const issues = detectStaleState(checks);

  const overallOk =
    checks.database.ok &&
    checks.treasury.ok;  // only hard-fail on DB or treasury

  return {
    ok: overallOk,
    timestamp: new Date().toISOString(),
    probeMs: Date.now() - startMs,
    websocket: {
      connectedClients: wsClientCount,
      active: wsClientCount > 0,
    },
    ...checks,
    issues,
    // ── Canonical execution state ─────────────────────────────────────────
    execution: {
      capital: checks.treasury.total ?? 0,
      available: checks.treasury.available ?? 0,
      openTrades: checks.agentRunner.openTrades ?? 0,
      isPaused: checks.treasury.isPaused ?? false,
      drawdownPct: checks.treasury.drawdownPct ?? 0,
      agentAlive: checks.agentRunner.agentAlive ?? false,
      lastTickAt: checks.agentRunner.lastTickAt ?? null,
      // PnL diagnostics
      realizedPnl: checks.executionDiagnostics?.realizedPnl ?? null,
      winRate: checks.executionDiagnostics?.winRate ?? null,
      totalTrades: checks.executionDiagnostics?.totalTrades ?? 0,
      stalePositionCount: checks.executionDiagnostics?.stalePositionCount ?? 0,
      unrealizedDegraded: checks.executionDiagnostics?.unrealizedDegraded ?? false,
      pnlFresh: checks.executionDiagnostics?.pnlFresh ?? null,
      unrealizedPnl: checks.executionDiagnostics?.unrealizedPnl ?? null,
      // Drawdown protection
      drawdownProtection: checks.executionDiagnostics?.drawdownProtection ?? null,
      // Startup reconciliation
      startupReconciliation: checks.executionDiagnostics?.startupReconciliation ?? null,
      // Confidence engine
      confidenceEngine: checks.confidenceEngine?.ok ? {
        lastScore:           checks.confidenceEngine.lastScore,
        lastBand:            checks.confidenceEngine.lastBand,
        averageScore:        checks.confidenceEngine.averageScore,
        blockedTrades:       checks.confidenceEngine.blockedTrades,
        noTradeReasonCounts: checks.confidenceEngine.noTradeReasonCounts,
        lastDecisionAt:      checks.confidenceEngine.lastDecisionAt,
      } : null,
    },
    // ── Alpha edge research ───────────────────────────────────────────────
    alphaResearch: {
      verdict:            checks.alphaResearch?.verdict          ?? 'NO_DATA',
      hasEdge:            checks.alphaResearch?.hasEdge          ?? null,
      verdictReason:      checks.alphaResearch?.verdictReason    ?? null,
      tradeHistory:       checks.alphaResearch?.tradeHistory     ?? 0,
      dataInsufficient:   checks.alphaResearch?.dataInsufficient ?? true,
      expectancy:         checks.alphaResearch?.expectancy       ?? null,
      winRate:            checks.alphaResearch?.winRate          ?? null,
      calibrationScore:   checks.alphaResearch?.calibrationScore ?? null,
      profitFactor:       checks.alphaResearch?.profitFactor     ?? null,
      bestAgent:          checks.alphaResearch?.bestAgent        ?? null,
      worstAgent:         checks.alphaResearch?.worstAgent       ?? null,
      strongestMarket:    checks.alphaResearch?.strongestMarket  ?? null,
      weakestMarket:      checks.alphaResearch?.weakestMarket    ?? null,
      confidenceAccuracy: checks.alphaResearch?.confidenceAccuracy ?? null,
      falsePositiveRate:  checks.alphaResearch?.falsePositiveRate  ?? null,
    },
    // ── Phase 6A live trading scheduler ──────────────────────────────────
    liveTrading: {
      ok:          checks.liveTrading?.ok          ?? false,
      started:     checks.liveTrading?.started     ?? false,
      startedAt:   checks.liveTrading?.startedAt   ?? null,
      mode:        checks.liveTrading?.mode        ?? 'paper',
      allocation:  checks.liveTrading?.allocation  ?? null,
      ticks:       checks.liveTrading?.ticks       ?? null,
      errors:      checks.liveTrading?.errors      ?? null,
      lastRun:     checks.liveTrading?.lastRun     ?? null,
      training:    checks.liveTrading?.training    ?? null,
    },
    // ── Operator observability ────────────────────────────────────────────
    operatorVisibility: {
      recentEvents:     checks.operatorVisibility?.recentEvents     ?? [],
      blockedTrades24h: checks.operatorVisibility?.blockedTrades24h ?? 0,
      activeWarnings:   checks.operatorVisibility?.activeWarnings   ?? [],
      topFailureReason: checks.operatorVisibility?.topFailureReason ?? null,
    },
    // ── Canonical learning state ──────────────────────────────────────────
    learning: {
      lessons: checks.learning.lessons ?? 0,
      activeVetoes: checks.learning.activeVetoes ?? 0,
      agentsTracked: checks.learning.agentsTracked ?? 0,
      lastConsensusDecision: checks.learning.lastConsensusDecision ?? null,
      // Global risk orchestrator
      globalRisk: {
        score:       checks.globalRisk?.score ?? 0,
        band:        checks.globalRisk?.band  ?? 'HEALTHY',
        safeMode:    checks.globalRisk?.safeMode ?? false,
        activeFlags: checks.globalRisk?.activeFlags ?? [],
        dimensions:  checks.globalRisk?.dimensions ?? {},
        lastRefreshAt: checks.globalRisk?.lastRefreshAt ?? null,
      },
      // Outcome learning loop
      outcomeEngine: checks.learningEngine?.ok ? {
        totalTradesAnalyzed: checks.learningEngine.totalTradesAnalyzed,
        recentAccuracy:      checks.learningEngine.recentAccuracy,
        avgPnl:              checks.learningEngine.avgPnl,
        activeWeights:       checks.learningEngine.activeWeights,
        lastCycleTime:       checks.learningEngine.lastCycleTime,
        lastCycleChanges:    checks.learningEngine.lastCycleChanges,
        highBandWinRate:     checks.learningEngine.highBandWinRate,
        cautionWinRate:      checks.learningEngine.cautionWinRate,
      } : null,
    },
  };
}

// ── Structured log helpers (exported for use in other server modules) ─────────

export const truthLog = {
  desync(system, message, data = {}) {
    console.warn(`[truth:desync:${system}] ${message}`, data);
  },
  stale(system, message, data = {}) {
    console.warn(`[truth:stale:${system}] ${message}`, data);
  },
  missing(system, message) {
    console.error(`[truth:missing:${system}] ${message}`);
  },
  syncFailed(system, message, err) {
    console.error(`[truth:sync_failed:${system}] ${message}:`, err?.message ?? err);
  },
};
