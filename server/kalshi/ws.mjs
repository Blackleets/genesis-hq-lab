// KalshiWS — WebSocket client for Kalshi real-time portfolio updates.
// Connects to wss://trading-api.kalshi.com/trade-api/ws/v2 with Bearer auth,
// subscribes to the 'portfolio' channel, and emits fill/position events.
// Reconnects automatically with exponential backoff on disconnect or error.

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

const WS_URL           = 'wss://trading-api.kalshi.com/trade-api/ws/v2';
const INITIAL_DELAY_MS = 2_000;
const MAX_DELAY_MS     = 60_000;

export default class KalshiWS extends EventEmitter {
  #apiKey;
  #ws             = null;
  #reconnectMs    = INITIAL_DELAY_MS;
  #reconnectTimer = null;
  #stopping       = false;

  constructor(apiKey) {
    super();
    this.#apiKey = apiKey;
  }

  connect() {
    if (this.#stopping) return;
    try {
      this.#ws = new WebSocket(WS_URL, {
        headers: { Authorization: `Bearer ${this.#apiKey}` },
      });
      this.#ws.on('open',    ()    => this.#onOpen());
      this.#ws.on('message', (raw) => this.#onMessage(raw));
      this.#ws.on('close',   ()    => this.#onClose());
      this.#ws.on('error',   (err) => this.#onError(err));
    } catch (err) {
      console.warn('[kalshi:ws] connect() threw:', err.message);
      this.#scheduleReconnect();
    }
  }

  stop() {
    this.#stopping = true;
    clearTimeout(this.#reconnectTimer);
    this.#ws?.close();
    this.#ws = null;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  #onOpen() {
    this.#reconnectMs = INITIAL_DELAY_MS;
    console.log('[kalshi:ws] connected — subscribing to portfolio channel');
    this.emit('connected');
    this.#ws.send(JSON.stringify({
      id:     1,
      cmd:    'subscribe',
      params: { channels: ['portfolio'] },
    }));
  }

  #onMessage(rawData) {
    let msg;
    try { msg = JSON.parse(rawData.toString()); } catch { return; }

    // Subscription acknowledgment — nothing to do
    if (msg.type === 'subscribed' || msg.id === 1) return;

    // Portfolio update — parse defensively across format variations
    const data = msg.data ?? msg.msg ?? {};

    // Order fills
    const fills = data.order_fills ?? data.fills ?? [];
    for (const fill of (Array.isArray(fills) ? fills : [])) {
      this.emit('order_filled', {
        ticker:  fill.ticker ?? fill.market_ticker,
        orderId: fill.order_id ?? fill.id,
        side:    fill.side,
        count:   fill.count ?? 0,
        price:   (fill.yes_price ?? fill.price ?? 0) / 100,
        ts:      fill.created_time ?? new Date().toISOString(),
      });
    }

    // Position updates
    const positions = data.positions ?? data.portfolio ?? [];
    for (const pos of (Array.isArray(positions) ? positions : [])) {
      if (!pos.ticker && !pos.market_ticker) continue;
      this.emit('position_updated', {
        ticker:   pos.ticker ?? pos.market_ticker,
        position: pos.position ?? 0,
        value:    (pos.market_exposure ?? pos.value ?? 0) / 100,
      });
    }
  }

  #onClose() {
    this.emit('disconnected');
    if (!this.#stopping) this.#scheduleReconnect();
  }

  #onError(err) {
    // 'close' fires after 'error' — reconnect is handled there
    console.warn('[kalshi:ws] error:', err.message);
  }

  #scheduleReconnect() {
    const delay = this.#reconnectMs;
    this.#reconnectMs = Math.min(this.#reconnectMs * 2, MAX_DELAY_MS);
    console.warn(`[kalshi:ws] reconnecting in ${Math.round(delay / 1000)}s…`);
    this.#reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
