// orgState.mjs — Genesis HQ operational state.
// Written by commandExecutor. Read by agentRunner every tick.
// Persisted to SQLite org_state table (atomic writes, survives crashes).

import db, { tx } from '../db/database.mjs';

// ─── Default org state ────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  mode: 'normal',          // normal | rest | focused | aggressive | conservative | emergency | sprint
  activeDepts: {
    prediction_markets: true,
    research:           true,
    marketing:          true,
    sales:              false,   // not activated yet
    operations:         true,
    crypto_scalping:    true,
  },
  riskTolerance: 'normal', // conservative | normal | aggressive
  focus: null,             // { topic, dept, reason, since, expiresAt }
  goal: null,              // { description, target, unit, current, deadline, createdAt }
  emergency: null,         // { type, reason, activatedAt }
  schedule: [],            // [{ commandId, action, executesAt }]
  founderNote: null,       // last command in plain text
  maxOpenTrades: 5,
  minConfidence: 0.65,
  maxRiskPct: 0.05,
  lastUpdated: null,
  commandCount: 0,
};

// ─── Read current state ───────────────────────────────────────────────────────

export function getOrgState() {
  try {
    const rows = db.prepare('SELECT key, value FROM org_state').all();
    if (rows.length === 0) return { ...DEFAULT_STATE };
    const stored = {};
    for (const { key, value } of rows) {
      try { stored[key] = JSON.parse(value); } catch { stored[key] = value; }
    }
    return { ...DEFAULT_STATE, ...stored };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

// ─── Write state ──────────────────────────────────────────────────────────────

export function setOrgState(updates) {
  const current = getOrgState();
  const next = {
    ...current,
    ...updates,
    lastUpdated: new Date().toISOString(),
    commandCount: (current.commandCount ?? 0) + 1,
  };
  try {
    tx(() => {
      const now = new Date().toISOString();
      const upsert = db.prepare(
        `INSERT OR REPLACE INTO org_state (key, value, updated_at) VALUES (?, ?, ?)`
      );
      for (const [key, value] of Object.entries(next)) {
        upsert.run(key, JSON.stringify(value), now);
      }
    });
  } catch (e) {
    console.error('[orgState] Failed to persist:', e.message);
  }
  return next;
}

// ─── Helpers used by agentRunner ─────────────────────────────────────────────

export function isDeptActive(deptName) {
  const state = getOrgState();
  if (state.mode === 'rest' || state.mode === 'emergency') return false;
  if (state.activeDepts?.[deptName] === false) return false;
  return true;
}

export function getRiskSettings() {
  const state = getOrgState();
  switch (state.riskTolerance) {
    case 'conservative': return { maxRiskPct: 0.02, minConfidence: 0.72, maxOpenTrades: 3 };
    case 'aggressive':   return { maxRiskPct: 0.08, minConfidence: 0.60, maxOpenTrades: 7 };
    default:             return { maxRiskPct: state.maxRiskPct, minConfidence: state.minConfidence, maxOpenTrades: state.maxOpenTrades };
  }
}

export function getWeeklyGoal() {
  const state = getOrgState();
  if (!state.goal) return null;
  const expired = state.goal.deadline && new Date(state.goal.deadline) < new Date();
  if (expired) return null;
  return state.goal;
}

// ─── Expire scheduled commands ────────────────────────────────────────────────

export function processExpiredSchedules() {
  const state = getOrgState();
  const now   = new Date();
  const expired = [];
  const active  = [];

  for (const item of (state.schedule ?? [])) {
    if (item.expiresAt && new Date(item.expiresAt) < now) {
      expired.push(item);
    } else {
      active.push(item);
    }
  }

  if (expired.length > 0) {
    // Restore normal mode if "rest today" expired
    const restExpired = expired.find(s => s.action?.type === 'REST');
    const patch = { schedule: active };
    if (restExpired && state.mode === 'rest') patch.mode = 'normal';
    setOrgState(patch);
    console.log(`[orgState] ${expired.length} scheduled commands expired`);
  }

  return expired;
}

// ─── Get a human-readable status summary ─────────────────────────────────────

export function getStatusSummary() {
  const state = getOrgState();
  const risk  = getRiskSettings();
  const lines = [];

  lines.push(`Mode: ${state.mode.toUpperCase()}`);
  lines.push(`Risk: ${state.riskTolerance} (max ${(risk.maxRiskPct*100).toFixed(0)}%/trade, confidence ≥ ${(risk.minConfidence*100).toFixed(0)}%)`);

  const depts = Object.entries(state.activeDepts ?? {})
    .map(([d, active]) => `${active ? '●' : '○'} ${d}`)
    .join('  ');
  lines.push(`Depts: ${depts}`);

  if (state.focus) {
    lines.push(`Focus: ${state.focus.topic || state.focus.dept} (since ${state.focus.since?.slice(0,10)})`);
  }

  if (state.goal) {
    lines.push(`Goal: ${state.goal.description} by ${state.goal.deadline?.slice(0,10)}`);
  }

  if (state.founderNote) {
    lines.push(`Last order: "${state.founderNote}"`);
  }

  return lines.join('\n');
}
