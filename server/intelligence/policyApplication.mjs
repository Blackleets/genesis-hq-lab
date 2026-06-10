import db from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

const OVERRIDES_KEY = 'futures_runtime_policy_overrides';
const APPLY_SCOPE = 'futures_supervisor';
const DEFAULT_OVERRIDE_TTL_HOURS = Math.max(1, parseInt(process.env.FUTURES_SUPERVISOR_OVERRIDE_TTL_HOURS ?? '24', 10));

const PARAM_DEFS = {
  FUTURES_BREAKOUT_SHORT_MICRO_ENABLED: {
    type: 'boolean',
    defaultValue: false,
    label: 'short_micro enabled',
  },
  FUTURES_BREAKOUT_SHORT_CORE_MIN_EXPECTED_NET_USD: {
    type: 'number',
    defaultValue: 40,
    min: 20,
    max: 150,
    label: 'short_core min expected net',
  },
  FUTURES_BREAKOUT_SHORT_CORE_MIN_REWARD_RISK: {
    type: 'number',
    defaultValue: 2.4,
    min: 1,
    max: 5,
    label: 'short_core min reward/risk',
  },
  FUTURES_BREAKOUT_SHORT_ALT_MIN_EXPECTED_NET_USD: {
    type: 'number',
    defaultValue: 26,
    min: 15,
    max: 120,
    label: 'short_alt min expected net',
  },
  FUTURES_BREAKOUT_SHORT_ALT_MIN_REWARD_RISK: {
    type: 'number',
    defaultValue: 2.1,
    min: 1,
    max: 5,
    label: 'short_alt min reward/risk',
  },
  FUTURES_BREAKOUT_LONG_ENABLED: {
    type: 'boolean',
    defaultValue: true,
    label: 'long_probe enabled',
  },
};

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function round3(value) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value ?? '').trim().toLowerCase();
  return !['0', 'false', 'no', 'off', ''].includes(normalized);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function coerceValue(key, value) {
  const def = PARAM_DEFS[key];
  if (!def) return null;
  if (def.type === 'boolean') return toBoolean(value);
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return round3(clamp(numeric, def.min, def.max));
}

function getEnvDefault(key) {
  const def = PARAM_DEFS[key];
  if (!def) return null;
  const raw = process.env[key];
  if (raw == null || raw === '') return def.defaultValue;
  return coerceValue(key, raw) ?? def.defaultValue;
}

function readStoredOverrideEnvelope() {
  const row = db.prepare(`SELECT value FROM org_state WHERE key = ?`).get(OVERRIDES_KEY);
  return parseJson(row?.value, null);
}

function writeStoredOverrideEnvelope(envelope) {
  db.prepare(`
    INSERT OR REPLACE INTO org_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(OVERRIDES_KEY, JSON.stringify(envelope));
}

function clearStoredOverrides() {
  db.prepare(`DELETE FROM org_state WHERE key = ?`).run(OVERRIDES_KEY);
}

function isExpiredEnvelope(envelope) {
  if (!envelope?.expiresAt) return false;
  return new Date(envelope.expiresAt).getTime() <= Date.now();
}

function writeApplyAuditRow({
  id = `policy-apply-${nanoid()}`,
  runId,
  status,
  overrides,
  appliedBy,
  createdAt,
  expiresAt = null,
}) {
  db.prepare(`
    INSERT INTO intelligence_policy_applies (
      id, run_id, scope, status, applied_overrides, applied_by, created_at, expires_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    runId ?? 'manual',
    APPLY_SCOPE,
    status,
    JSON.stringify(overrides ?? []),
    appliedBy,
    createdAt,
    expiresAt,
  );
  return id;
}

function expireEnvelopeIfNeeded() {
  const envelope = readStoredOverrideEnvelope();
  if (!envelope || !isExpiredEnvelope(envelope)) return envelope;
  const expiredAt = new Date().toISOString();
  writeApplyAuditRow({
    runId: envelope.sourceRunId ?? 'manual',
    status: 'expired',
    overrides: Object.entries(envelope.overrides ?? {}).map(([key, value]) => ({
      key,
      label: PARAM_DEFS[key]?.label ?? key,
      proposedValue: value,
      reason: 'runtime override expired automatically',
    })),
    appliedBy: 'system',
    createdAt: expiredAt,
    expiresAt: envelope.expiresAt ?? expiredAt,
  });
  clearStoredOverrides();
  return null;
}

export function getActiveFuturesRuntimeOverrides() {
  const envelope = expireEnvelopeIfNeeded();
  const parsed = envelope?.overrides && typeof envelope.overrides === 'object'
    ? envelope.overrides
    : {};
  const normalized = {};
  for (const key of Object.keys(PARAM_DEFS)) {
    if (!(key in parsed)) continue;
    const coerced = coerceValue(key, parsed[key]);
    if (coerced != null) normalized[key] = coerced;
  }
  return normalized;
}

export function getCurrentFuturesPolicyParamValue(key) {
  const overrides = getActiveFuturesRuntimeOverrides();
  if (key in overrides) return overrides[key];
  return getEnvDefault(key);
}

export function getAllowedFuturesPolicyParams() {
  return Object.entries(PARAM_DEFS).map(([key, def]) => ({
    key,
    label: def.label,
    type: def.type,
    min: def.min ?? null,
    max: def.max ?? null,
    defaultValue: def.defaultValue,
    currentValue: getCurrentFuturesPolicyParamValue(key),
  }));
}

function buildChange(key, proposedValue, reason, profileId) {
  const def = PARAM_DEFS[key];
  if (!def) return null;
  const currentValue = getCurrentFuturesPolicyParamValue(key);
  const nextValue = coerceValue(key, proposedValue);
  if (nextValue == null) return null;
  if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) return null;
  return {
    key,
    label: def.label,
    type: def.type,
    profileId,
    currentValue,
    proposedValue: nextValue,
    reason,
  };
}

export function buildSupervisorProposedChanges(mission) {
  if (!mission) return [];
  const proposals = [];
  const byId = new Map((mission.governorProfiles ?? []).map((profile) => [profile.id, profile]));
  const lessonPressure = new Set((mission.lessonSummaries ?? []).map((lesson) => lesson.tradeType));

  const shortMicro = byId.get('short_micro');
  if (
    shortMicro
    && (shortMicro.mode !== 'active'
      || shortMicro.supervisor?.mode === 'cooldown'
      || (shortMicro.totalPnl ?? 0) < 0)
  ) {
    const change = buildChange(
      'FUTURES_BREAKOUT_SHORT_MICRO_ENABLED',
      false,
      'short_micro is under pressure; keep the micro lane off until profitable paper closes return.',
      'short_micro',
    );
    if (change) proposals.push(change);
  }

  const shortCore = byId.get('short_core');
  if (
    shortCore
    && (
      shortCore.mode === 'degraded'
      || shortCore.supervisor?.mode === 'cooldown'
      || (shortCore.totalPnl ?? 0) < 0
      || lessonPressure.has(shortCore.tradeType)
    )
  ) {
    const currentMinNet = Number(getCurrentFuturesPolicyParamValue('FUTURES_BREAKOUT_SHORT_CORE_MIN_EXPECTED_NET_USD') ?? 40);
    const currentMinRr = Number(getCurrentFuturesPolicyParamValue('FUTURES_BREAKOUT_SHORT_CORE_MIN_REWARD_RISK') ?? 2.4);
    const netChange = buildChange(
      'FUTURES_BREAKOUT_SHORT_CORE_MIN_EXPECTED_NET_USD',
      currentMinNet + 8,
      'short_core needs wider post-fee expectancy before new entries are accepted.',
      'short_core',
    );
    const rrChange = buildChange(
      'FUTURES_BREAKOUT_SHORT_CORE_MIN_REWARD_RISK',
      currentMinRr + 0.2,
      'short_core should require a higher reward/risk floor after recent pressure.',
      'short_core',
    );
    if (netChange) proposals.push(netChange);
    if (rrChange) proposals.push(rrChange);
  }

  const shortAlt = byId.get('short_alt');
  if (
    shortAlt
    && (
      shortAlt.mode === 'degraded'
      || shortAlt.supervisor?.mode === 'cooldown'
      || (shortAlt.totalPnl ?? 0) < 0
    )
  ) {
    const currentMinNet = Number(getCurrentFuturesPolicyParamValue('FUTURES_BREAKOUT_SHORT_ALT_MIN_EXPECTED_NET_USD') ?? 26);
    const currentMinRr = Number(getCurrentFuturesPolicyParamValue('FUTURES_BREAKOUT_SHORT_ALT_MIN_REWARD_RISK') ?? 2.1);
    const netChange = buildChange(
      'FUTURES_BREAKOUT_SHORT_ALT_MIN_EXPECTED_NET_USD',
      currentMinNet + 4,
      'short_alt needs more room above fees before it can reopen risk.',
      'short_alt',
    );
    const rrChange = buildChange(
      'FUTURES_BREAKOUT_SHORT_ALT_MIN_REWARD_RISK',
      currentMinRr + 0.1,
      'short_alt should reject thinner reward/risk setups while pressure remains.',
      'short_alt',
    );
    if (netChange) proposals.push(netChange);
    if (rrChange) proposals.push(rrChange);
  }

  const longProbe = byId.get('long_probe');
  if (
    longProbe
    && mission.aggregate?.closedTrades > 0
    && (
      longProbe.mode === 'paused'
      || longProbe.supervisor?.mode === 'cooldown'
      || (longProbe.totalPnl ?? 0) < 0
    )
  ) {
    const change = buildChange(
      'FUTURES_BREAKOUT_LONG_ENABLED',
      false,
      'long_probe has not earned runtime capital right now; disable it until paper evidence improves.',
      'long_probe',
    );
    if (change) proposals.push(change);
  }

  return proposals;
}

function toApplyRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    runId: row.run_id,
    status: row.status,
    appliedBy: row.applied_by,
    appliedAt: row.created_at,
    expiresAt: row.expires_at ?? null,
    overrides: parseJson(row.applied_overrides, []),
  };
}

function summarizeWindow(fromIso, toIso) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS closedTrades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(pnl), 0) AS totalPnl,
      COALESCE(AVG(pnl), 0) AS avgPnl
    FROM trades
    WHERE status = 'closed'
      AND trade_type LIKE 'crypto_futures_%'
      AND closed_at >= ?
      AND closed_at < ?
  `).get(fromIso, toIso);
  const closedTrades = row?.closedTrades ?? 0;
  const wins = row?.wins ?? 0;
  return {
    closedTrades,
    wins,
    losses: Math.max(0, closedTrades - wins),
    winRate: closedTrades > 0 ? round3(wins / closedTrades) : null,
    totalPnl: round3(row?.totalPnl ?? 0),
    avgPnl: round3(row?.avgPnl ?? 0),
  };
}

function getActiveOverrideImpact(envelope) {
  if (!envelope?.appliedAt) return null;
  const appliedAtMs = new Date(envelope.appliedAt).getTime();
  if (!Number.isFinite(appliedAtMs)) return null;
  const nowMs = Date.now();
  const expiresAtMs = envelope.expiresAt ? new Date(envelope.expiresAt).getTime() : null;
  const activeWindowEndMs = Number.isFinite(expiresAtMs) ? Math.min(nowMs, expiresAtMs) : nowMs;
  const elapsedMs = Math.max(60_000, activeWindowEndMs - appliedAtMs);
  const preWindow = summarizeWindow(
    new Date(appliedAtMs - elapsedMs).toISOString(),
    new Date(appliedAtMs).toISOString(),
  );
  const postWindow = summarizeWindow(
    new Date(appliedAtMs).toISOString(),
    new Date(activeWindowEndMs).toISOString(),
  );
  return {
    comparisonWindowHours: round3(elapsedMs / 36e5),
    preWindow,
    postWindow,
    delta: {
      closedTrades: postWindow.closedTrades - preWindow.closedTrades,
      totalPnl: round3((postWindow.totalPnl ?? 0) - (preWindow.totalPnl ?? 0)),
      avgPnl: round3((postWindow.avgPnl ?? 0) - (preWindow.avgPnl ?? 0)),
      winRate: preWindow.winRate == null || postWindow.winRate == null
        ? null
        : round3(postWindow.winRate - preWindow.winRate),
    },
  };
}

export function getAppliedFuturesPolicyState() {
  const envelope = expireEnvelopeIfNeeded();
  const overrides = getActiveFuturesRuntimeOverrides();
  const rows = db.prepare(`
    SELECT *
    FROM intelligence_policy_applies
    WHERE scope = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(APPLY_SCOPE);
  const latestApply = toApplyRecord(rows[0] ?? null);
  return {
    active: Object.keys(overrides).length > 0,
    sourceRunId: envelope?.sourceRunId ?? latestApply?.runId ?? null,
    appliedAt: envelope?.appliedAt ?? latestApply?.appliedAt ?? null,
    appliedBy: envelope?.appliedBy ?? latestApply?.appliedBy ?? null,
    expiresAt: envelope?.expiresAt ?? latestApply?.expiresAt ?? null,
    overrides: Object.entries(overrides).map(([key, value]) => ({
      key,
      label: PARAM_DEFS[key]?.label ?? key,
      value,
    })),
    latestApply,
    impact: getActiveOverrideImpact(envelope),
  };
}

export function applySupervisorRecommendation(run, appliedBy = 'operator') {
  if (!run || run.scope !== APPLY_SCOPE) {
    throw new Error('supervisor_run_not_found');
  }
  if (run.status !== 'recommended') {
    throw new Error('supervisor_run_not_recommended');
  }
  const proposedChanges = Array.isArray(run.proposedChanges) ? run.proposedChanges : [];
  if (proposedChanges.length === 0) {
    throw new Error('no_applicable_changes');
  }

  const currentOverrides = getActiveFuturesRuntimeOverrides();
  const nextOverrides = { ...currentOverrides };
  for (const change of proposedChanges) {
    const coerced = coerceValue(change.key, change.proposedValue);
    if (coerced == null) continue;
    nextOverrides[change.key] = coerced;
  }

  const appliedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + (DEFAULT_OVERRIDE_TTL_HOURS * 60 * 60 * 1000)).toISOString();
  const envelope = {
    scope: APPLY_SCOPE,
    sourceRunId: run.id,
    appliedAt,
    appliedBy,
    expiresAt,
    overrides: nextOverrides,
  };

  writeStoredOverrideEnvelope(envelope);
  const applyId = writeApplyAuditRow({
    runId: run.id,
    status: 'applied',
    overrides: proposedChanges,
    appliedBy,
    createdAt: appliedAt,
    expiresAt,
  });

  return {
    ok: true,
    applyId,
    appliedAt,
    appliedBy,
    expiresAt,
    sourceRunId: run.id,
    proposedChanges,
    state: getAppliedFuturesPolicyState(),
  };
}

export function rollbackSupervisorOverrides(appliedBy = 'operator', reason = 'manual rollback') {
  const envelope = readStoredOverrideEnvelope();
  if (!envelope) throw new Error('no_active_overrides');
  const rolledBackAt = new Date().toISOString();
  const changes = Object.entries(envelope.overrides ?? {}).map(([key, value]) => ({
    key,
    label: PARAM_DEFS[key]?.label ?? key,
    proposedValue: value,
    reason,
  }));
  writeApplyAuditRow({
    runId: envelope.sourceRunId ?? 'manual',
    status: 'rolled_back',
    overrides: changes,
    appliedBy,
    createdAt: rolledBackAt,
    expiresAt: envelope.expiresAt ?? null,
  });
  clearStoredOverrides();
  return {
    ok: true,
    rolledBackAt,
    appliedBy,
    sourceRunId: envelope.sourceRunId ?? null,
    state: getAppliedFuturesPolicyState(),
  };
}
