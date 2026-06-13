// index.mjs — Solana Alpha Lab module entry point.
// Initialises DB tables, connects PumpPortal feed, exposes public API.

import { runSolanaAlphaMigrations } from './migrations.mjs';
import { setBroadcast as _setBroadcast, getState } from './state.mjs';
import { connectFeed, startPaperTick, stopFeed, getFeedStatus } from './feed.mjs';
import { getOpenPaperPositions, getClosedPaperTrades, getPaperStats, getEquityCurve, getPaperBalance, resetPaperBalance, openPaperPosition } from './paperEngine.mjs';
import { getRecentSignals } from './signalAgent.mjs';
import { getSmartMoneyWallets, getWalletSummary } from './walletTracker.mjs';

let _started = false;

export function setBroadcast(fn) {
  _setBroadcast(fn);
}

export function initSolanaAlpha() {
  if (_started) return;
  _started = true;

  try {
    runSolanaAlphaMigrations();
    connectFeed();
    startPaperTick();
    console.log('[solana-alpha] Module initialised');
  } catch (err) {
    console.error('[solana-alpha] Init error:', err.message);
  }
}

export function shutdownSolanaAlpha() {
  stopFeed();
}

// ── Public data getters (used by API routes) ──────────────────────────────────

export function getSolanaStatus() {
  const state = getState();
  return {
    ...getFeedStatus(),
    paperBalance: state.paperBalance,
    stats: state.stats,
  };
}

export function getSolanaTokens(limit = 50) {
  const tokens = [...getState().tokens.values()];
  return tokens
    .sort((a, b) => (b.updatedAt ?? '') > (a.updatedAt ?? '') ? 1 : -1)
    .slice(0, limit);
}

export function getSolanaWallets(limit = 50) {
  return getSmartMoneyWallets(0, limit);
}

export function getSolanaSignals(limit = 30) {
  return getRecentSignals(limit);
}

export {
  getOpenPaperPositions,
  getClosedPaperTrades,
  getPaperStats,
  getEquityCurve,
  getPaperBalance,
  resetPaperBalance,
  openPaperPosition,
  getWalletSummary,
};
