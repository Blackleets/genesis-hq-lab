// KalshiAdapter — real-time WebSocket layer for Kalshi portfolio events.
// REST operations (market data, order placement) remain in marketScanner.mjs
// and execution.mjs. This module adds fills/positions via the Kalshi WS API
// and pipes them into the existing broadcast channel used by all agents.
//
// Usage:
//   import { setBroadcast, startWS, stopWS, getKalshiStatus } from './kalshi/adapter.mjs';
//   setBroadcast(broadcast);   // call once, before startWS
//   startWS();                 // call after server is listening
//
// Silent degraded mode: when KALSHI_API_KEY is not set, startWS() is a no-op.
// All events are optional — missing them does not affect the trading pipeline.

import KalshiWS from './ws.mjs';

// ─── Broadcast injection ──────────────────────────────────────────────────────

let _broadcast = null;

export function setBroadcast(fn) {
  _broadcast = fn;
}

// ─── Runtime state ────────────────────────────────────────────────────────────

const state = {
  wsConnected:        false,
  lastFill:           null,   // most recent order fill received via WS
  lastPositionUpdate: null,   // most recent position update received via WS
};

let _ws = null;

// ─── Lifecycle ────────────────────────────────────────────────────────────────

export function startWS() {
  if (_ws) return;  // already running — idempotent
  const apiKey = process.env.KALSHI_API_KEY;
  if (!apiKey) {
    console.log('[kalshi] No KALSHI_API_KEY — WebSocket disabled (REST polling still active)');
    return;
  }

  _ws = new KalshiWS(apiKey);

  _ws.on('connected', () => {
    state.wsConnected = true;
  });

  _ws.on('disconnected', () => {
    state.wsConnected = false;
  });

  _ws.on('order_filled', (fill) => {
    // try-catch: this handler runs inside KalshiWS.emit() — an uncaught
    // exception here would propagate back through ws.mjs's #onMessage.
    // ws.mjs wraps #onMessage in try-catch, but defensive here too.
    try {
      state.lastFill = { ...fill, receivedAt: Date.now() };
      console.log(`[kalshi] ORDER FILLED: ${fill.ticker} ${fill.side} ×${fill.count} @ $${(fill.price ?? 0).toFixed(2)}`);
      _broadcast?.({ type: 'kalshi:order_filled', ...fill, ts: Date.now() });
    } catch (err) {
      console.error('[kalshi] order_filled handler error:', err.message);
    }
  });

  _ws.on('position_updated', (pos) => {
    try {
      state.lastPositionUpdate = { ...pos, receivedAt: Date.now() };
      _broadcast?.({ type: 'kalshi:position_updated', ...pos, ts: Date.now() });
    } catch (err) {
      console.error('[kalshi] position_updated handler error:', err.message);
    }
  });

  _ws.connect();
}

export function stopWS() {
  _ws?.stop();
  _ws = null;
  state.wsConnected = false;
}

// ─── Status ───────────────────────────────────────────────────────────────────

export function getKalshiStatus() {
  return {
    enabled:            !!process.env.KALSHI_API_KEY,
    wsConnected:        state.wsConnected,
    lastFill:           state.lastFill,
    lastPositionUpdate: state.lastPositionUpdate,
  };
}
