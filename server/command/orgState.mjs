// orgState.mjs — the single source of truth for Genesis HQ's operational state.
// Written by commandExecutor. Read by agentRunner every tick.
// If org-state.json doesn't exist, system runs in default mode.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_PATH = join(__dir, '..', '..', 'data', 'org-state.json');
const DATA_DIR   = join(__dir, '..', '..', 'data');

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ─── Default org state ────────────────────────────────────────────────────────

const DEFAULT_STATE = {
  mode: 'normal',          // normal | rest | focused | aggressive | conservative | emergency | sprint
  activeDepts: {
    prediction_markets: true,
    research:           true,
    marketing:          true,
    sales:              false,   // not activated yet
    operations:         true,
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
    if (!existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
    const raw = readFileSync(STATE_PATH, 'utf8');
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
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
  writeFileSync(STATE_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

// ─── Helpers used by agentRunner ─────────────────────────────────────────────

export function isDeptActive(deptName) {
  const state = getOrgState();
  if (state.mode === 'rest' || state.mode === 'emergency') return false;
  if (state.activeDepts[deptName] === false) return false;
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

  const depts = Object.entries(state.activeDepts)
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
