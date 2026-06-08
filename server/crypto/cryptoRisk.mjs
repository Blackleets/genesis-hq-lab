// cryptoRisk.mjs — crypto-specific circuit breakers layered ON TOP of the global
// treasury drawdown/loss-streak limits. Risk controls are env-configured (NOT
// strategy params) so the optimizer can never "tune them away" for more profit.
//
// Pure helpers (exceedsDailyCap, isAssetInCooldown) are unit-tested; the thin DB
// wrappers query closed crypto_scalp trades.

import db from '../db/database.mjs';
import { CRYPTO_TRADE_TYPES_SQL } from './cryptoTradeUniverse.mjs';

function num(v, def) {
  const n = parseFloat(v ?? '');
  return Number.isFinite(n) ? n : def;
}

export function getCryptoRiskConfig() {
  return {
    cooldownMin:     num(process.env.CRYPTO_COOLDOWN_MIN, 15),   // pause an asset after a loss
    dailyLossCapUsd: num(process.env.CRYPTO_DAILY_LOSS_CAP, 300), // halt new crypto entries for the day
  };
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/** Block new entries once the day's realized crypto PnL is at/below -cap. */
export function exceedsDailyCap(dailyRealizedPnl, capUsd) {
  return dailyRealizedPnl <= -Math.abs(capUsd);
}

/** An asset is on cooldown if its most recent closed trade was a loss within the window. */
export function isAssetInCooldown(lastClosedTrade, nowMs, cooldownMin) {
  if (!lastClosedTrade) return false;
  if ((lastClosedTrade.pnl ?? 0) >= 0) return false;
  const closedMs = new Date(lastClosedTrade.closed_at).getTime();
  if (!Number.isFinite(closedMs)) return false;
  return (nowMs - closedMs) < cooldownMin * 60_000;
}

// ── DB wrappers ──────────────────────────────────────────────────────────────

function utcMidnightIso(nowMs = Date.now()) {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

export function dailyCryptoRealizedPnl(nowMs = Date.now()) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(pnl), 0) AS s
    FROM trades
    WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status = 'closed' AND closed_at >= ?
  `).get(utcMidnightIso(nowMs));
  return row?.s ?? 0;
}

export function lastClosedCryptoTrade(pair) {
  return db.prepare(`
    SELECT pnl, closed_at
    FROM trades
    WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status = 'closed' AND asset_pair = ?
    ORDER BY closed_at DESC LIMIT 1
  `).get(pair);
}

/** Global gate: true (with reason) when the daily loss cap is hit. */
export function dailyLossHalt() {
  const { dailyLossCapUsd } = getCryptoRiskConfig();
  const pnl = dailyCryptoRealizedPnl();
  if (exceedsDailyCap(pnl, dailyLossCapUsd)) {
    return { halt: true, reason: `Daily crypto loss cap hit ($${pnl.toFixed(2)} ≤ -$${dailyLossCapUsd})` };
  }
  return { halt: false };
}

/** Per-asset gate: true (with reason) when the asset is cooling down after a loss. */
export function assetCooldown(pair) {
  const { cooldownMin } = getCryptoRiskConfig();
  if (isAssetInCooldown(lastClosedCryptoTrade(pair), Date.now(), cooldownMin)) {
    return { cooling: true, reason: `${pair} cooling down ${cooldownMin}m after a loss` };
  }
  return { cooling: false };
}
