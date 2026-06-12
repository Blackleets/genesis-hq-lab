import db from '../db/database.mjs';

const HEARTBEAT_KEY = 'external_runner_heartbeat';
const HEARTBEAT_WINDOW_MS = 10 * 60 * 1000;

function parseJson(value) {
  try { return value ? JSON.parse(value) : null; } catch { return null; }
}

export function readHostedRunnerHeartbeat() {
  try {
    const row = db.prepare(`SELECT value, updated_at FROM org_state WHERE key = ?`).get(HEARTBEAT_KEY);
    const payload = parseJson(row?.value);
    if (!payload?.lastTickAt) {
      return {
        source: 'external',
        lastTickAt: null,
        totalCycles: 0,
        claudeEnabled: false,
        agentAlive: false,
        msSinceLastTick: null,
      };
    }
    const msSinceLastTick = Date.now() - new Date(payload.lastTickAt).getTime();
    return {
      source: payload.source ?? 'external',
      lastTickAt: payload.lastTickAt,
      totalCycles: Number(payload.totalCycles ?? 0),
      claudeEnabled: Boolean(payload.claudeEnabled),
      lastResult: payload.lastResult ?? null,
      updatedAt: row?.updated_at ?? payload.lastTickAt,
      agentAlive: Number.isFinite(msSinceLastTick) && msSinceLastTick < HEARTBEAT_WINDOW_MS,
      msSinceLastTick: Number.isFinite(msSinceLastTick) ? msSinceLastTick : null,
    };
  } catch {
    return {
      source: 'external',
      lastTickAt: null,
      totalCycles: 0,
      claudeEnabled: false,
      agentAlive: false,
      msSinceLastTick: null,
    };
  }
}

export function writeHostedRunnerHeartbeat({
  source = 'external',
  lastResult = null,
  claudeEnabled = false,
} = {}) {
  const current = readHostedRunnerHeartbeat();
  const payload = {
    source,
    lastTickAt: new Date().toISOString(),
    totalCycles: Number(current.totalCycles ?? 0) + 1,
    claudeEnabled: Boolean(claudeEnabled),
    lastResult,
  };
  db.prepare(`
    INSERT OR REPLACE INTO org_state (key, value, updated_at)
    VALUES (?, ?, ?)
  `).run(HEARTBEAT_KEY, JSON.stringify(payload), payload.lastTickAt);
  return payload;
}
