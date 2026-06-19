// feed.mjs — PumpPortal WebSocket connection.
// Streams new tokens and trades from pump.fun in real time.
// No API key required. Reconnects on disconnect.

import { WebSocket } from 'ws';
import db from '../db/database.mjs';
import { updateToken, broadcast, getState } from './state.mjs';
import { processWalletTrade } from './walletTracker.mjs';
import { registerBuy } from './patternAnalyst.mjs';
import { evaluateSignal } from './signalAgent.mjs';
import {
  tickPaperPositions, openPaperPosition, getPaperStats,
  getOpenPaperPositions, getTradeById,
} from './paperEngine.mjs';
import { fetchTokenState } from './priceOracle.mjs';
import {
  evaluateLaunchSignal, recordLaunch, recordCreatorLaunch, recordCreatorOutcome,
} from './launchSignal.mjs';

const WS_URL = process.env.PUMPPORTAL_WS_URL ?? 'wss://pumpportal.fun/api/data';
// PumpPortal's free tier only streams token CREATIONS (subscribeTokenTrade is
// paywalled), so we trade on launch-time signals. Threshold kept reachable.
const MIN_CONFIDENCE_AUTO_TRADE = 62;    // auto paper-trade signals above this
const AUTO_PAPER_TRADE = true;           // enable auto paper trading on signals
const MAX_TRACKED_TOKENS = 500;          // cap in-memory tracked tokens

let _ws = null;
let _reconnectTimer = null;
let _tickTimer = null;
let _subscribedMints = new Set();
let _warnedPaywall = false;

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
  // PumpPortal status / ack messages (incl. the paywall notice for trade
  // streams). They carry no mint — log the paywall once, then ignore.
  if (msg.message && !msg.mint) {
    if (!_warnedPaywall && /api key/i.test(msg.message)) {
      _warnedPaywall = true;
      console.log('[solana-alpha] PumpPortal trade stream is paywalled — running on the free launch-signal engine.');
    }
    return;
  }

  // New token launch (free tier tags these txType:'create').
  if (msg.txType === 'create' || (msg.mint && !msg.txType)) {
    const creator = msg.traderPublicKey ?? msg.creator ?? null;
    const tokenData = upsertToken({ ...msg, creator });
    recordLaunch();
    recordCreatorLaunch(creator);
    broadcast({ type: 'solana:new_token', token: tokenData });

    if (tokenData) {
      const signal = evaluateLaunchSignal({
        ...tokenData,
        creator,
        initialBuySol: msg.solAmount ?? 0,
      });
      if (signal && signal.confidence >= MIN_CONFIDENCE_AUTO_TRADE && AUTO_PAPER_TRADE) {
        _maybeAutoTrade(signal).catch((err) => {
          console.warn('[solana-alpha] auto paper trade skipped:', err.message);
        });
      }
    }
    return;
  }

  // Live trade event — only arrives with a funded PumpPortal API key.
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

    const token = getState().tokens.get(msg.mint);
    if (token && (msg.solAmount ?? 0) >= 0.1) {
      evaluateSignal(token).then(signal => {
        if (signal && signal.confidence >= MIN_CONFIDENCE_AUTO_TRADE && AUTO_PAPER_TRADE) {
          _maybeAutoTrade(signal).catch((err) => {
            console.warn('[solana-alpha] auto paper trade skipped:', err.message);
          });
        }
      }).catch(() => {});
    }
  }
}

async function _maybeAutoTrade(signal) {
  const stats = getPaperStats();
  if (stats.openPositions >= 10) return;

  // Prefer the free pump.fun oracle. At launch, the frontend API can lag a few
  // seconds behind PumpPortal, so fall back to the bonding-curve price carried
  // by the launch event. Both are reserve-derived prices, not simulated data.
  const state = await fetchTokenState(signal.tokenMint);
  const entryPrice = state?.priceSol && state.priceSol > 0
    ? state.priceSol
    : signal.lastPriceSol;
  if (!entryPrice || entryPrice <= 0 || state?.complete) return;

  const result = openPaperPosition({
    tokenMint:    signal.tokenMint,
    tokenSymbol:  signal.tokenSymbol,
    priceSol:     entryPrice,
    sizeSol:      Math.min(1, stats.balance * 0.1), // max 10% of balance, capped at 1 SOL
    signalReason: signal.reason,
    signalId:     signal.id,
  });

  if (result.ok) {
    console.log(`[solana-alpha] Paper trade opened: ${signal.tokenSymbol} @ ${entryPrice.toExponential(3)} SOL | conf ${signal.confidence}%`);
  }
}

// ── Periodic tick ─────────────────────────────────────────────────────────────

export function startPaperTick() {
  if (_tickTimer) return;
  _tickTimer = setInterval(async () => {
    try {
      const positions = getOpenPaperPositions();
      if (positions.length === 0) return;

      // Pull a fresh price for each open position from the free oracle.
      const priceMap = new Map();
      for (const pos of positions) {
        const s = await fetchTokenState(pos.token_mint);
        if (s?.priceSol && s.priceSol > 0) priceMap.set(pos.token_mint, s.priceSol);
      }

      const openIds = positions.map((p) => p.id);
      tickPaperPositions(priceMap);

      // Feed closed-trade outcomes back into creator reputation.
      for (const id of openIds) {
        const t = getTradeById(id);
        if (t && t.status !== 'open') {
          const creator = db.prepare(`SELECT creator FROM solana_tokens WHERE mint = ?`).get(t.token_mint)?.creator;
          const profitX = t.entry_price_sol > 0 && t.exit_price_sol ? t.exit_price_sol / t.entry_price_sol : 1;
          recordCreatorOutcome(creator, (t.pnl_sol ?? 0) > 0, profitX);
        }
      }

      broadcast({ type: 'solana:tick' });
    } catch (err) {
      console.error('[solana-alpha] paper tick error:', err.message);
    }
  }, 20_000); // every 20s — polls the free pump.fun price for each open position
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
