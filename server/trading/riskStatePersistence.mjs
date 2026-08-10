// riskStatePersistence.mjs — persist peak capital and drawdown protection across restarts
// ═══════════════════════════════════════════════════════════════════════════════════════

import db from '../db/database.mjs';

// ─── Initialize risk state on startup ─────────────────────────────────────────

export function initializeRiskState(currentCapital) {
  try {
    // Try to load existing peak capital from DB
    const existing = db.prepare(`SELECT peak_capital, baseline_capital FROM risk_state WHERE id = 'singleton'`).get();

    if (existing) {
      // Peak capital exists and survived restart
      return {
        peakCapital: existing.peak_capital,
        baselineCapital: existing.baseline_capital,
        source: 'persisted',
      };
    }

    // First boot: initialize with current capital
    db.prepare(`
      INSERT OR REPLACE INTO risk_state (id, peak_capital, baseline_capital, updated_at, updated_by)
      VALUES ('singleton', ?, ?, datetime('now'), 'system:init')
    `).run(currentCapital, currentCapital);

    return {
      peakCapital: currentCapital,
      baselineCapital: currentCapital,
      source: 'initialized',
    };
  } catch (err) {
    console.error('[riskStatePersistence] initializeRiskState error:', err.message);
    // Fallback: return capital as both peak and baseline
    return {
      peakCapital: currentCapital,
      baselineCapital: currentCapital,
      source: 'fallback',
    };
  }
}

// ─── Update peak capital when capital increases ──────────────────────────────

export function updatePeakCapital(currentCapital) {
  try {
    const existing = db.prepare(`SELECT peak_capital FROM risk_state WHERE id = 'singleton'`).get();

    if (!existing) {
      // Should not happen if initializeRiskState was called, but handle gracefully
      initializeRiskState(currentCapital);
      return;
    }

    const peakCapital = existing.peak_capital;

    if (currentCapital > peakCapital) {
      // New peak reached: update DB
      db.prepare(`
        UPDATE risk_state
        SET peak_capital = ?, last_drawdown_pct = 0, updated_at = datetime('now'), updated_by = 'system:peak_update'
        WHERE id = 'singleton'
      `).run(currentCapital);
    }
  } catch (err) {
    console.error('[riskStatePersistence] updatePeakCapital error:', err.message);
  }
}

// ─── Calculate and persist current drawdown ────────────────────────────────

export function recordDrawdown(currentCapital, drawdownPct) {
  try {
    db.prepare(`
      UPDATE risk_state
      SET last_drawdown_pct = ?, updated_at = datetime('now'), updated_by = 'system:drawdown_update'
      WHERE id = 'singleton'
    `).run(drawdownPct);
  } catch (err) {
    console.error('[riskStatePersistence] recordDrawdown error:', err.message);
  }
}

// ─── Get current risk state ──────────────────────────────────────────────────

export function getRiskState() {
  try {
    const state = db.prepare(`SELECT * FROM risk_state WHERE id = 'singleton'`).get();

    if (!state) {
      return {
        peakCapital: 0,
        baselineCapital: 0,
        lastDrawdownPct: 0,
        updatedAt: null,
      };
    }

    return {
      peakCapital: state.peak_capital,
      baselineCapital: state.baseline_capital,
      lastDrawdownPct: state.last_drawdown_pct,
      updatedAt: state.updated_at,
    };
  } catch (err) {
    console.error('[riskStatePersistence] getRiskState error:', err.message);
    return {
      peakCapital: 0,
      baselineCapital: 0,
      lastDrawdownPct: 0,
      updatedAt: null,
    };
  }
}

// ─── For debugging/auditing ──────────────────────────────────────────────────

export function resetRiskState(newCapital) {
  try {
    db.prepare(`
      UPDATE risk_state
      SET peak_capital = ?, baseline_capital = ?, last_drawdown_pct = 0,
          updated_at = datetime('now'), updated_by = 'system:manual_reset'
      WHERE id = 'singleton'
    `).run(newCapital, newCapital);

    console.log(`[riskStatePersistence] Risk state reset: peakCapital=${newCapital}`);
  } catch (err) {
    console.error('[riskStatePersistence] resetRiskState error:', err.message);
  }
}
