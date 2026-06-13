// state.mjs — shared in-memory state for Solana Alpha Lab.
// DB is source of truth; this is a hot cache for real-time processing.

const _state = {
  connected:    false,
  wsStatus:     'disconnected',   // 'disconnected' | 'connecting' | 'connected' | 'error'
  tokens:       new Map(),        // mint → { name, symbol, marketCapSol, bondingCurvePct, riskScore, lastPriceSol, ... }
  wallets:      new Map(),        // address → { score, totalTrades, wins, ... }
  priceMap:     new Map(),        // mint → last trade price in SOL
  recentSignals: [],              // last 50 signals
  paperBalance: 100,              // SOL available (reloaded from DB on init)
  paperPositions: [],             // open paper positions (reloaded from DB)
  stats: {
    tokensTracked:   0,
    walletsTracked:  0,
    signalsToday:    0,
    tradesOpened:    0,
    tradesClosed:    0,
  },
  broadcastFn: null,              // set by index.mjs after server init
  startedAt: null,
};

export function getState() { return _state; }

export function setBroadcast(fn) { _state.broadcastFn = fn; }

export function broadcast(event) {
  if (_state.broadcastFn) {
    try { _state.broadcastFn(event); } catch { /* never throw */ }
  }
}

export function updateToken(mint, data) {
  const existing = _state.tokens.get(mint) ?? {};
  _state.tokens.set(mint, { ...existing, ...data, mint });
  if (!existing.mint) _state.stats.tokensTracked++;
  if (data.lastPriceSol != null) _state.priceMap.set(mint, data.lastPriceSol);
}

export function updateWallet(address, data) {
  const existing = _state.wallets.get(address) ?? {};
  _state.wallets.set(address, { ...existing, ...data, address });
  if (!existing.address) _state.stats.walletsTracked++;
}

export function addSignal(signal) {
  _state.recentSignals.unshift(signal);
  if (_state.recentSignals.length > 50) _state.recentSignals.length = 50;
  _state.stats.signalsToday++;
}

export function getCurrentPrice(mint) {
  return _state.priceMap.get(mint) ?? null;
}

export function getTokens(limit = 50) {
  return Array.from(_state.tokens.values())
    .sort((a, b) => (b.marketCapSol ?? 0) - (a.marketCapSol ?? 0))
    .slice(0, limit);
}

export function getWallets(limit = 50) {
  return Array.from(_state.wallets.values())
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}
