// feed.mjs — PumpPortal WebSocket connection.
// Streams new tokens and trades from pump.fun in real time.
// No API key required. Reconnects on disconnect.

import { WebSocket } from 'ws';
import db from '../db/database.mjs';
import { updateToken, broadcast, getState } from './state.mjs';
import { processWalletTrade } from './walletTracker.mjs';
import { registerBuy } from './patternAnalyst.mjs';
import { evaluateSignal } from './signalAgent.mjs';
import { tickPaperPositions, openPaperPosition, getPaperStats } from './paperEngine.mjs';

const WS_URL = process.env.PUMPPORTAL_WS_URL ?? 'wss://pumpportal.fun/api/data';
const MIN_CONFIDENCE_AUTO_TRADE = 70;    // auto paper-trade signals above this
const AUTO_PAPER_TRADE = true;           // enable auto paper trading on signals
const MAX_TRACKED_TOKENS = 500;          // cap in-memory tracked tokens

let _ws = null;
let _reconnectTimer = null;
let _tickTimer = null;
let _subscribedMints = new Set();

// ── Token management ─────────────────────────────────────────────────────────

function upsertToken(data) {
  const {
    mint, name, symbol, creator,
    marketCapSol, initialBuy, bondingCurveKey,
    vSolInBondingCurve, vTokensInBondingCurve,
    timestamp,
  } = data;

  if (!mint) return;

  // Estimate bonding curve % from reserves
  const bondingCurvePct = _estimateBondingCurve(vSolInBondingCurve, vTokensInBondingCurve);

  const tokenData = {
    mint,
    name: name ?? '???',
    symbol: symbol ?? '???',
    creator: creator ?? null,
    marketCapSol: marketCapSol ?? 0,
    bondingCurvePct,
    lastPriceSol: _estimatePrice(vSolInBondingCurve, vTokensInBondingCurve),
    tradeCount: 1,
    uniqueWallets: 1,
    createdTs: timestamp ? new Date(timestamp).getTime() : Date.now(),
    updatedAt: new Date().toISOString(),
  };

  updateToken(mint, tokenData);

  try {
    db.prepare(`
      INSERT OR REPLACE INTO solana_tokens
        (mint, name, symbol, creator, created_ts, market_cap_sol, bonding_curve_pct, last_price_sol, first_seen, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `).run(mint, tokenData.name, tokenData.symbol, tokenData.creator,
      tokenData.createdTs, tokenData.marketCapSol, bondingCurvePct, tokenData.lastPriceSol);
  } catch { /* non-fatal */ }

  return tokenData;
}

function _estimateBondingCurve(vSol, vTokens) {
  // Pump.fun launches with 79 SOL + 1B tokens. Progress = (79 - vSol) / 79 * 100
  if (vSol == null || vSol <= 0) return 0;
  const MAX_SOL = 79;
  return Math.max(0, Math.min(100, ((MAX_SOL - vSol) / MAX_SOL) * 100));
}

function _estimatePrice(vSol, vTokens) {
  if (!vSol || !vTokens || vTokens <= 0) return 0;
  return vSol / vTokens;
}

function updateTokenOnTrade(data) {
  const { mint, solAmount, tokenAmount, marketCapSol, traderPublicKey,
    vSolInBondingCurve, vTokensInBondingCurve, txType } = data;
  if (!mint) return;

  const currentToken = getState().tokens.get(mint);
  const priceSol = tokenAmount > 0 ? solAmount / tokenAmount : _estimatePrice(vSolInBondingCurve, vTokensInBondingCurve);
  const bondingCurvePct = _estimateBondingCurve(vSolInBondingCurve, vTokensInBondingCurve);

  const updated = {
    lastPriceSol: priceSol,
    marketCapSol: marketCapSol ?? currentToken?.marketCapSol ?? 0,
    bondingCurvePct: bondingCurvePct || currentToken?.bondingCurvePct || 0,
    tradeCount: (currentToken?.tradeCount ?? 0) + 1,
    volume_sol_1h: (currentToken?.volume_sol_1h ?? 0) + (solAmount ?? 0),
  };

  updateToken(mint, updated);

  try {
    db.prepare(`
      UPDATE solana_tokens SET
        last_price_sol = ?, market_cap_sol = ?, bonding_curve_pct = ?,
        trade_count = trade_count + 1,
        volume_sol_1h = volume_sol_1h + ?,
        updated_at = datetime('now')
      WHERE mint = ?
    `).run(priceSol, updated.marketCapSol, updated.bondingCurvePct, solAmount ?? 0, mint);
  } catch { /* non-fatal */ }

  // Register buy for pattern detection
  if (txType === 'buy' && traderPublicKey) {
    registerBuy({ mint, address: traderPublicKey, solAmount: solAmount ?? 0 });
  }
}

// ── WebSocket connection ──────────────────────────────────────────────────────

export function connectFeed() {
  if (_ws && _ws.readyState === WebSocket.OPEN) return;

  console.log('[solana-alpha] Connecting to PumpPortal...');
  getState().wsStatus = 'connecting';

  _ws = new WebSocket(WS_URL);

  _ws.on('open', () => {
    console.log('[solana-alpha] PumpPortal connected');
    getState().connected = true;
    getState().wsStatus = 'connected';
    getState().startedAt = new Date().toISOString();

    // Subscribe to new token launches
    _ws.send(JSON.stringify({ method: 'subscribeNewToken' }));

    broadcast({ type: 'solana:connected' });
  });

  _ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      _handleMessage(msg);
    } catch { /* malformed */ }
  });

  _ws.on('close', (code) => {
    console.warn(`[solana-alpha] PumpPortal disconnected (code ${code}), reconnecting in 5s...`);
    getState().connected = false;
    getState().wsStatus = 'disconnected';
    _ws = null;
    _subscribedMints.clear();
    _scheduleReconnect();
  });

  _ws.on('error', (err) => {
    console.error('[solana-alpha] PumpPortal WS error:', err.message);
    getState().wsStatus = 'error';
  });
}

function _scheduleReconnect() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectTimer = setTimeout(() => connectFeed(), 5_000);
}

function _handleMessage(msg) {
  // New token event
  if (msg.mint && !msg.txType) {
    const tokenData = upsertToken(msg);
    broadcast({ type: 'solana:new_token', token: tokenData });

    // Subscribe to this token's trades (cap at 500 tracked tokens)
    if (_subscribedMints.size < MAX_TRACKED_TOKENS && _ws?.readyState === WebSocket.OPEN) {
      _ws.send(JSON.stringify({ method: 'subscribeTokenTrade', keys: [msg.mint] }));
      _subscribedMints.add(msg.mint);
    }

    // Evaluate signal asynchronously
    if (tokenData) {
      evaluateSignal({ ...tokenData }).then(signal => {
        if (signal && signal.confidence >= MIN_CONFIDENCE_AUTO_TRADE && AUTO_PAPER_TRADE) {
          _maybeAutoTrade(signal, tokenData);
        }
      }).catch(() => {});
    }
    return;
  }

  // Trade event
  if (msg.mint && msg.txType) {
    updateTokenOnTrade(msg);
    processWalletTrade(msg);
    broadcast({ type: 'solana:trade', data: {
      mint: msg.mint,
      symbol: getState().tokens.get(msg.mint)?.symbol ?? '???',
      txType: msg.txType,
      solAmount: msg.solAmount,
      traderPublicKey: msg.traderPublicKey,
      marketCapSol: msg.marketCapSol,
    }});

    // Re-evaluate signal on each significant trade
    const token = getState().tokens.get(msg.mint);
    if (token && (msg.solAmount ?? 0) >= 0.1) {
      evaluateSignal(token).then(signal => {
        if (signal && signal.confidence >= MIN_CONFIDENCE_AUTO_TRADE && AUTO_PAPER_TRADE) {
          _maybeAutoTrade(signal, token);
        }
      }).catch(() => {});
    }
  }
}

function _maybeAutoTrade(signal, token) {
  if (!token.lastPriceSol || token.lastPriceSol <= 0) return;
  const stats = getPaperStats();
  if (stats.openPositions >= 10) return;

  const result = openPaperPosition({
    tokenMint:    signal.tokenMint,
    tokenSymbol:  signal.tokenSymbol,
    priceSol:     token.lastPriceSol,
    sizeSol:      Math.min(1, stats.balance * 0.1), // max 10% of balance, capped at 1 SOL
    signalReason: signal.reason,
    signalId:     signal.id,
  });

  if (result.ok) {
    console.log(`[solana-alpha] Paper trade opened: ${signal.tokenSymbol} @ ${token.lastPriceSol.toFixed(6)} SOL | conf ${signal.confidence}%`);
  }
}

// ── Periodic tick ─────────────────────────────────────────────────────────────

export function startPaperTick() {
  if (_tickTimer) return;
  _tickTimer = setInterval(() => {
    try {
      tickPaperPositions(getState().priceMap);
    } catch (err) {
      console.error('[solana-alpha] paper tick error:', err.message);
    }
  }, 30_000); // every 30s
}

export function stopFeed() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  if (_tickTimer) clearInterval(_tickTimer);
  if (_ws) _ws.close();
  _ws = null;
  getState().connected = false;
}

export function getFeedStatus() {
  return {
    connected:     getState().connected,
    wsStatus:      getState().wsStatus,
    subscribedTokens: _subscribedMints.size,
    startedAt:     getState().startedAt,
  };
}
