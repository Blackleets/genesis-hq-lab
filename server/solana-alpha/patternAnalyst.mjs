// patternAnalyst.mjs — detect tradeable patterns on Pump.fun tokens.

import { getSmartMoneyWallets } from './walletTracker.mjs';

// Track recent buys per token (window: 60s) for smart money accumulation detection
const _recentBuys = new Map(); // mint → [{ address, solAmount, ts }]

const SMART_MONEY_ACCUMULATION_WINDOW_MS = 60_000;
const VOLUME_SPIKE_MULTIPLIER = 4;

/**
 * Register a buy event for pattern detection.
 */
export function registerBuy({ mint, address, solAmount, ts = Date.now() }) {
  const arr = _recentBuys.get(mint) ?? [];
  arr.push({ address, solAmount, ts });
  // Keep only last 60s
  const cutoff = ts - SMART_MONEY_ACCUMULATION_WINDOW_MS;
  _recentBuys.set(mint, arr.filter(e => e.ts >= cutoff));
}

/**
 * Detect patterns for a given token.
 * @returns {{ patterns: string[], smartBuyers: string[], volumeSpike: boolean }}
 */
export function detectPatterns(token, smartMoneyAddresses = new Set()) {
  const mint = token.mint;
  const patterns = [];
  const recent = _recentBuys.get(mint) ?? [];

  // 1. Smart Money Accumulation: ≥2 smart wallets buying in last 60s
  const smartBuyers = recent
    .filter(e => smartMoneyAddresses.has(e.address))
    .map(e => e.address);
  const uniqueSmartBuyers = [...new Set(smartBuyers)];
  if (uniqueSmartBuyers.length >= 2) {
    patterns.push('smart_money_accumulation');
  } else if (uniqueSmartBuyers.length === 1) {
    patterns.push('smart_money_single');
  }

  // 2. Volume Spike: recent 60s volume > 4x average per-minute baseline
  const recentVolSol = recent.reduce((s, e) => s + e.solAmount, 0);
  const baselineVolSol = (token.volume_sol_1h ?? 0) / 60;
  if (recentVolSol > baselineVolSol * VOLUME_SPIKE_MULTIPLIER && recentVolSol > 0.5) {
    patterns.push('volume_spike');
  }

  // 3. Bonding Curve Sprint: rapid progression toward migration
  if (token.bondingCurvePct >= 85) {
    patterns.push('migration_imminent');
  } else if (token.bondingCurvePct >= 60 && token.bondingCurvePct < 85) {
    patterns.push('bonding_sprint');
  }

  // 4. Early Discovery: <15 trades but has smart money interest
  if ((token.tradeCount ?? 0) < 15 && uniqueSmartBuyers.length >= 1) {
    patterns.push('early_discovery');
  }

  return {
    patterns,
    smartBuyers: uniqueSmartBuyers,
    recentVolSol: Math.round(recentVolSol * 1000) / 1000,
    volumeSpike: patterns.includes('volume_spike'),
  };
}

/**
 * Get cached smart money address set (recomputed on each call from DB).
 */
let _smartMoneyCache = { set: new Set(), ts: 0 };
export async function getSmartMoneySet() {
  const now = Date.now();
  if (now - _smartMoneyCache.ts < 30_000) return _smartMoneyCache.set;
  const wallets = getSmartMoneyWallets(65, 100);
  _smartMoneyCache = { set: new Set(wallets.map(w => w.address)), ts: now };
  return _smartMoneyCache.set;
}
