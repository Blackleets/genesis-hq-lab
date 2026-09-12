// KalshiAdapter — real-time WebSocket layer for Kalshi portfolio events
// plus periodic REST polling that normalizes market state to market_update events.
//
// Two data streams, one adapter:
//   WS  (wss://trading-api.kalshi.com/trade-api/ws/v2)
//       → portfolio channel → fills → kalshi:order_filled → processFill()
//                           → positions → kalshi:position_updated → processPosition()
//
//   REST (GET /trade-api/v2/markets, every MARKET_POLL_MS)
//       → raw markets → normalizeMarket() → market_update
//
// Both streams flow through the same broadcast() channel.
// Silent degraded mode when KALSHI_API_KEY is not set.

import { EventEmitter } from 'node:events';
import KalshiWS from './ws.mjs';
import { withRetry } from '../utils/retry.mjs';
import { processFill, processPosition, trackPendingFill, clearPendingFills } from './fillProcessor.mjs';

const KALSHI_REST_BASE = 'https://trading-api.kalshi.com/trade-api/v2';
const MARKET_POLL_MS   = 5 * 60_000;   // every 5 minutes
const MARKET_LIMIT     = 50;            // max markets per REST call

// ─── Broadcast injection ──────────────────────────────────────────────────────

let _broadcast = null;

export function setBroadcast(fn) {
  _broadcast = fn;
}

// ─── Internal event bus (server-side consumers) ───────────────────────────────
//
// Separate from _broadcast (which only pushes to WS clients).
// Allows server-side modules like MarketAnalystAgent to subscribe to
// market_update events without going through the WS layer.

const _internalBus = new EventEmitter();

export function onMarketUpdate(fn) {
  _internalBus.on('market_update', fn);
}

// ─── Runtime state ────────────────────────────────────────────────────────────

const state = {
  wsConnected:        false,
  lastFill:           null,
  lastPositionUpdate: null,
};

let _ws              = null;
let _marketPollTimer = null;

// ─── Normalization helpers ────────────────────────────────────────────────────

// Coerce to finite number or null.
function _toNum(v) {
  const n = Number(v);
  return v != null && isFinite(n) ? n : null;
}

// Coerce Kalshi cent-integer price (0–100) to decimal fraction (0.00–1.00) or null.
// Handles: number, numeric string, null, undefined, non-numeric string.
function _toCents(v) {
  const n = Number(v);
  return v != null && isFinite(n) ? n / 100 : null;
}

// ─── normalizeMarket — pure function ─────────────────────────────────────────
//
// Input:  raw Kalshi REST market object from GET /trade-api/v2/markets
//         { ticker, yes_ask, no_ask, volume_24h, open_interest, category, close_time, ... }
//
// Output: canonical market_update event ready for broadcast
//         All fields are present; missing source data produces null (never undefined).

export function normalizeMarket(raw) {
  const ticker = raw?.ticker ?? null;

  // daysToClose: positive integer, 0 if already at close, null if no close_time
  let daysToClose = null;
  if (raw?.close_time) {
    const ms = new Date(raw.close_time).getTime() - Date.now();
    daysToClose = ms > 0 ? Math.round(ms / 86_400_000) : 0;
  }

  return {
    type:           'market_update',
    ticker,
    marketId:       ticker,                     // Kalshi ticker IS the market id
    yesPrice:       _toCents(raw?.yes_ask),     // cents → fraction  e.g. 55 → 0.55
    noPrice:        _toCents(raw?.no_ask),
    volume24h:      _toNum(raw?.volume_24h),
    liquidity:      _toNum(raw?.open_interest),
    daysToClose,
    marketCategory: raw?.category ?? null,
    ts:             Date.now(),
  };
}

// ─── publishMarketUpdates ─────────────────────────────────────────────────────
//
// Normalize and broadcast an array of raw Kalshi REST market objects.
// Skips any market where the ticker is null (unidentifiable).
// Never throws — errors per-market are logged and skipped.

export function publishMarketUpdates(rawMarkets) {
  if (!Array.isArray(rawMarkets) || rawMarkets.length === 0) return;
  let published = 0;
  for (const m of rawMarkets) {
    try {
      const event = normalizeMarket(m);
      if (event.ticker == null) continue;
      _internalBus.emit('market_update', event);  // server-side consumers first
      if (_broadcast) {
        _broadcast(event);                          // WS clients (frontend)
        published++;
      }
    } catch (err) {
      console.error('[kalshi] publishMarketUpdates error:', err.message);
    }
  }
  if (published > 0) {
    console.log(`[kalshi] market poll: ${published}/${rawMarkets.length} market_update events broadcast`);
  }
}

// ─── Internal REST poll ───────────────────────────────────────────────────────

async function _pollOnce(apiKey) {
  return withRetry(
    async () => {
      const res = await fetch(
        `${KALSHI_REST_BASE}/markets?limit=${MARKET_LIMIT}&status=open`,
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const body = await res.json();
      const markets = body?.markets ?? body ?? [];
      publishMarketUpdates(Array.isArray(markets) ? markets : []);
    },
    {
      initialDelayMs: 500,
      maxRetries: 2,
      maxDelayMs: 5000,
    },
    'kalshi market poll'
  ).catch(err => {
    // market poll is best-effort — don't throw
    console.warn('[kalshi] market poll exhausted retries:', err.message);
  });
}

function _startMarketPoll(apiKey) {
  _pollOnce(apiKey);  // immediate first run on startup
  _marketPollTimer = setInterval(() => _pollOnce(apiKey), MARKET_POLL_MS);
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function startWS() {
  if (_ws) return;  // idempotent — already started
  const apiKey = process.env.KALSHI_API_KEY;
  if (!apiKey) {
    console.log('[kalshi] No KALSHI_API_KEY — WebSocket and market poll disabled (REST scan still active)');
    return;
  }

  // ── WebSocket: real-time fills and position updates ──
  _ws = new KalshiWS(apiKey);

  _ws.on('connected', () => {
    state.wsConnected = true;
  });

  _ws.on('disconnected', () => {
    state.wsConnected = false;
  });

  _ws.on('order_filled', (fill) => {
    try {
      state.lastFill = { ...fill, receivedAt: Date.now() };
      console.log(`[kalshi] ORDER FILLED: ${fill.ticker} ${fill.side} ×${fill.count} @ $${(fill.price ?? 0).toFixed(2)}`);
      _broadcast?.({ type: 'kalshi:order_filled', ...fill, ts: Date.now() });
      // Process fill: close trade, settle capital, learn
      processFill(fill);
    } catch (err) {
      console.error('[kalshi] order_filled handler error:', err.message);
    }
  });

  _ws.on('position_updated', (pos) => {
    try {
      state.lastPositionUpdate = { ...pos, receivedAt: Date.now() };
      _broadcast?.({ type: 'kalshi:position_updated', ...pos, ts: Date.now() });
      // Process position: validate against open trades, detect orphans
      processPosition(pos);
    } catch (err) {
      console.error('[kalshi] position_updated handler error:', err.message);
    }
  });

  _ws.connect();

  // ── REST poll: periodic market state for market_update events ──
  _startMarketPoll(apiKey);
}

export function stopWS() {
  clearInterval(_marketPollTimer);
  _marketPollTimer = null;
  clearPendingFills();  // clean up pending fill timeouts
  _ws?.stop();
  _ws = null;
  state.wsConnected = false;
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function getKalshiStatus() {
  return {
    enabled:            !!process.env.KALSHI_API_KEY,
    wsConnected:        state.wsConnected,
    marketPollActive:   _marketPollTimer != null,
    lastFill:           state.lastFill,
    lastPositionUpdate: state.lastPositionUpdate,
  };
}
