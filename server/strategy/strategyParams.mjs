// strategyParams.mjs — Per-venue trading strategy configuration.
// Persisted to SQLite strategy_params table.
// One venue active at a time; API to switch or update.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

// ─── Venue presets ────────────────────────────────────────────────────────────

const VENUE_PRESETS = {
  kalshi: {
    venue: 'kalshi',
    min_confidence: 0.65,
    max_entry_price: 0.90,
    min_entry_price: 0.10,
    max_position_usd: 500,
    max_position_pct: 0.05,
    max_open_trades: 5,
    stop_loss_pct: 0.20,
    take_profit_pct: 0.50,
    max_hold_days: 45,
    min_liquidity_usd: 5000,
    settings_json: JSON.stringify({
      retryBackoffMs: 100,
      maxRetries: 3,
      timeout: 10000,
      websocketReconnectIntervalMs: 5000,
    }),
  },
  polymarket: {
    venue: 'polymarket',
    min_confidence: 0.70,
    max_entry_price: 0.95,
    min_entry_price: 0.05,
    max_position_usd: 300,
    max_position_pct: 0.03,
    max_open_trades: 3,
    stop_loss_pct: 0.25,
    take_profit_pct: 0.40,
    max_hold_days: 60,
    min_liquidity_usd: 10000,
    settings_json: JSON.stringify({
      retryBackoffMs: 150,
      maxRetries: 2,
      timeout: 15000,
    }),
  },
  crypto: {
    venue: 'crypto',
    min_confidence: 0.60,
    max_entry_price: 1.0,
    min_entry_price: 0.01,
    max_position_usd: 1000,
    max_position_pct: 0.10,
    max_open_trades: 7,
    stop_loss_pct: 0.15,
    take_profit_pct: 1.00,
    max_hold_days: 30,
    min_liquidity_usd: 1000,
    settings_json: JSON.stringify({
      retryBackoffMs: 200,
      maxRetries: 5,
      timeout: 5000,
      leverage: 1,
    }),
  },
};

// ─── Initialize default venue params if table is empty ───────────────────────

export function ensureDefaults() {
  const existing = db.prepare('SELECT venue FROM strategy_params').all();
  if (existing.length > 0) return; // already initialized

  tx(() => {
    for (const [_, preset] of Object.entries(VENUE_PRESETS)) {
      const id = `strategy-${preset.venue}-${nanoid()}`;
      db.prepare(`
        INSERT INTO strategy_params
          (id, venue, is_active, min_confidence, max_entry_price, min_entry_price,
           max_position_usd, max_position_pct, max_open_trades,
           stop_loss_pct, take_profit_pct, max_hold_days, min_liquidity_usd,
           settings_json, created_at, updated_at)
        VALUES
          (?, ?, ?, ?, ?, ?,
           ?, ?, ?,
           ?, ?, ?, ?,
           ?, ?, ?)
      `).run(
        id,
        preset.venue,
        preset.venue === 'kalshi' ? 1 : 0, // Kalshi is default active
        preset.min_confidence,
        preset.max_entry_price,
        preset.min_entry_price,
        preset.max_position_usd,
        preset.max_position_pct,
        preset.max_open_trades,
        preset.stop_loss_pct,
        preset.take_profit_pct,
        preset.max_hold_days,
        preset.min_liquidity_usd,
        preset.settings_json,
        new Date().toISOString(),
        new Date().toISOString(),
      );
    }
  });

  console.log('[strategyParams] initialized default venue presets (Kalshi active)');
}

// ─── Get active venue ─────────────────────────────────────────────────────────

export function getActiveVenue() {
  const row = db.prepare('SELECT venue FROM strategy_params WHERE is_active = 1').get();
  return row?.venue ?? 'kalshi';
}

// ─── Get params for a venue ───────────────────────────────────────────────────

export function getStrategyParams(venue = null) {
  const targetVenue = venue ?? getActiveVenue();
  const row = db.prepare('SELECT * FROM strategy_params WHERE venue = ?').get(targetVenue);

  if (!row) {
    // Return preset if DB row missing
    return VENUE_PRESETS[targetVenue] ?? VENUE_PRESETS.kalshi;
  }

  // Parse JSON fields
  return {
    ...row,
    settings_json: JSON.parse(row.settings_json ?? '{}'),
  };
}

// ─── Switch active venue ──────────────────────────────────────────────────────

export function setActiveVenue(newVenue) {
  if (!VENUE_PRESETS[newVenue]) {
    throw new Error(`unknown venue: ${newVenue}`);
  }

  ensureDefaults(); // ensure all venues exist

  tx(() => {
    // Deactivate all
    db.prepare('UPDATE strategy_params SET is_active = 0, deactivated_at = ?')
      .run(new Date().toISOString());

    // Activate target
    db.prepare(`
      UPDATE strategy_params
      SET is_active = 1, activated_at = ?, updated_at = ?
      WHERE venue = ?
    `).run(new Date().toISOString(), new Date().toISOString(), newVenue);
  });

  console.log(`[strategy] venue switched: ${newVenue}`);
  return getStrategyParams(newVenue);
}

// ─── Update params for a venue ────────────────────────────────────────────────

export function updateStrategyParams(venue, updates) {
  if (!VENUE_PRESETS[venue]) {
    throw new Error(`unknown venue: ${venue}`);
  }

  ensureDefaults();

  tx(() => {
    const current = db.prepare('SELECT * FROM strategy_params WHERE venue = ?').get(venue);
    if (!current) {
      throw new Error(`no strategy params for venue: ${venue}`);
    }

    const sets = [];
    const values = [];
    for (const [key, val] of Object.entries(updates)) {
      if (key === 'settings_json' && typeof val === 'object') {
        sets.push(`${key} = ?`);
        values.push(JSON.stringify(val));
      } else if (key !== 'id' && key !== 'venue' && key !== 'created_at') {
        sets.push(`${key} = ?`);
        values.push(val);
      }
    }

    if (sets.length === 0) return; // nothing to update

    sets.push('updated_at = ?');
    values.push(new Date().toISOString());
    values.push(venue);

    db.prepare(`UPDATE strategy_params SET ${sets.join(', ')} WHERE venue = ?`).run(...values);
  });

  return getStrategyParams(venue);
}

// ─── Get all venues (for UI)──────────────────────────────────────────────────

export function getAllVenues() {
  ensureDefaults();
  return db.prepare('SELECT * FROM strategy_params ORDER BY venue').all()
    .map(row => ({
      ...row,
      settings_json: JSON.parse(row.settings_json ?? '{}'),
    }));
}

// ─── Get active venue summary ─────────────────────────────────────────────────

export function getActiveSummary() {
  const active = getActiveVenue();
  const params = getStrategyParams(active);
  return {
    venue: active,
    confidence: params.min_confidence,
    maxPosition: params.max_position_usd,
    stopLoss: `${(params.stop_loss_pct * 100).toFixed(0)}%`,
    takeProfit: `${(params.take_profit_pct * 100).toFixed(0)}%`,
    maxOpenTrades: params.max_open_trades,
  };
}
