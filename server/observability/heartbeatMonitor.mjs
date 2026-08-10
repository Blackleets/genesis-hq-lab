// heartbeatMonitor.mjs — detect silent failures in background processes
// ═══════════════════════════════════════════════════════════════════════════════════════

import db from '../db/database.mjs';

// ─── Register a component's heartbeat ────────────────────────────────────────

export function recordHeartbeat(component, status = 'running', cycleResult = 'success', error = null) {
  try {
    db.prepare(`
      INSERT INTO agent_heartbeat (id, component, status, last_ping, last_cycle_result, last_error, updated_at)
      VALUES (?, ?, ?, datetime('now'), ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        last_ping = excluded.last_ping,
        last_cycle_result = excluded.last_cycle_result,
        last_error = excluded.last_error,
        cycle_number = cycle_number + 1,
        updated_at = datetime('now')
    `).run(`${component}-heartbeat`, component, status, cycleResult, error || null);
  } catch (err) {
    console.error('[heartbeatMonitor] recordHeartbeat error:', err.message);
  }
}

// ─── Check if component is healthy (heartbeat within threshold) ─────────────

export function isComponentHealthy(component, thresholdMinutes = 10) {
  try {
    const result = db.prepare(`
      SELECT last_ping FROM agent_heartbeat WHERE component = ?
    `).get(component);

    if (!result) {
      return { healthy: false, reason: 'no_heartbeat_recorded' };
    }

    const lastPingTime = new Date(result.last_ping).getTime();
    const nowTime = Date.now();
    const ageMinutes = (nowTime - lastPingTime) / 60000;

    if (ageMinutes > thresholdMinutes) {
      return {
        healthy: false,
        reason: `heartbeat_stale_${Math.round(ageMinutes)}min`,
        ageMinutes,
      };
    }

    return { healthy: true, ageMinutes };
  } catch (err) {
    console.error('[heartbeatMonitor] isComponentHealthy error:', err.message);
    return { healthy: false, reason: 'error_checking_heartbeat' };
  }
}

// ─── Get all component statuses ──────────────────────────────────────────────

export function getAllHeartbeats() {
  try {
    return db.prepare(`
      SELECT
        component,
        status,
        last_ping,
        last_cycle_result,
        last_error,
        cycle_number,
        (
          CAST((julianday('now') - julianday(last_ping)) * 1440 AS INTEGER)
        ) AS age_minutes
      FROM agent_heartbeat
      ORDER BY component
    `).all();
  } catch (err) {
    console.error('[heartbeatMonitor] getAllHeartbeats error:', err.message);
    return [];
  }
}

// ─── Check system health (true if all critical components respond) ─────────

export function getSystemHealth() {
  try {
    const heartbeats = getAllHeartbeats();

    const componentStatuses = {};
    const failures = [];

    for (const hb of heartbeats) {
      const isHealthy = hb.age_minutes <= 10;
      componentStatuses[hb.component] = {
        healthy: isHealthy,
        ageMinutes: hb.age_minutes,
        status: hb.status,
        lastCycleResult: hb.last_cycle_result,
        lastError: hb.last_error,
      };

      if (!isHealthy) {
        failures.push({
          component: hb.component,
          reason: `no_heartbeat_${hb.age_minutes}min`,
          lastError: hb.last_error,
        });
      }
    }

    return {
      healthy: failures.length === 0,
      componentStatuses,
      failures,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error('[heartbeatMonitor] getSystemHealth error:', err.message);
    return {
      healthy: false,
      componentStatuses: {},
      failures: [{ reason: 'error_checking_health' }],
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Clear stale heartbeats (older than threshold) ─────────────────────────

export function cleanupStaleHeartbeats(thresholdDays = 7) {
  try {
    const result = db.prepare(`
      DELETE FROM agent_heartbeat
      WHERE datetime(last_ping) < datetime('now', '-' || ? || ' days')
    `).run(thresholdDays);

    console.log(`[heartbeatMonitor] Cleaned up ${result.changes} stale heartbeat records`);
    return result.changes;
  } catch (err) {
    console.error('[heartbeatMonitor] cleanupStaleHeartbeats error:', err.message);
    return 0;
  }
}
