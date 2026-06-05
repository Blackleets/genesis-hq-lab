// KalshiWS — WebSocket client for Kalshi real-time portfolio updates.
// Connects to wss://trading-api.kalshi.com/trade-api/ws/v2 with Bearer auth,
// subscribes to the 'portfolio' channel, and emits fill/position events.
//
// Production hardening:
//   - try-catch wraps all message handling (exceptions cannot reach ws internals)
//   - fill deduplication via Set<orderId> (capped at FILL_DEDUP_LIMIT)
//   - periodic ping with pong deadline to detect zombie sockets
//   - exponential backoff reconnect (2s → 60s)

import { EventEmitter } from 'node:events';
import { WebSocket } from 'ws';

const WS_URL           = 'wss://trading-api.kalshi.com/trade-api/ws/v2';
const INITIAL_DELAY_MS = 2_000;
const MAX_DELAY_MS     = 60_000;
const PING_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS  = 5_000;
const FILL_DEDUP_LIMIT = 500;   // max seen orderId entries before Set is cleared

export default class KalshiWS extends EventEmitter {
  #apiKey;
  #ws             = null;
  #reconnectMs    = INITIAL_DELAY_MS;
  #reconnectTimer = null;
  #stopping       = false;
  #pingInterval   = null;
  #pingDeadline   = null;
  #seenFills      = new Set();  // orderId deduplication across reconnects

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
      this.#ws.on('pong',    ()    => this.#onPong());
      this.#ws.on('close',   ()    => this.#onClose());
      this.#ws.on('error',   (err) => this.#onError(err));
    } catch (err) {
      console.warn('[kalshi:ws] connect() threw:', err.message);
      this.#scheduleReconnect();
    }
  }

  stop() {
    this.#stopping = true;
    this.#clearTimers();
    this.#ws?.close();
    this.#ws = null;
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  #onOpen() {
    this.#reconnectMs = INITIAL_DELAY_MS;
    this.#clearTimers();
    console.log('[kalshi:ws] connected — subscribing to portfolio channel');
    this.emit('connected');

    try {
      this.#ws.send(JSON.stringify({
        id:     1,
        cmd:    'subscribe',
        params: { channels: ['portfolio'] },
      }));
    } catch (err) {
      console.warn('[kalshi:ws] subscribe send failed:', err.message);
    }

    // Periodic ping to detect zombie sockets
    this.#pingInterval = setInterval(() => {
      if (this.#ws?.readyState === WebSocket.OPEN) {
        this.#ws.ping();
        this.#pingDeadline = setTimeout(() => {
          console.warn('[kalshi:ws] ping timeout — terminating zombie socket');
          this.#ws?.terminate();
        }, PING_TIMEOUT_MS);
      }
    }, PING_INTERVAL_MS);
  }

  #onPong() {
    clearTimeout(this.#pingDeadline);
    this.#pingDeadline = null;
  }

  #onMessage(rawData) {
    // try-catch is mandatory: an exception here would propagate into the ws
    // library's internal event dispatch and could crash the process.
    try {
      let msg;
      try { msg = JSON.parse(rawData.toString()); } catch { return; }

      // Subscription acknowledgment — nothing to do
      if (msg.type === 'subscribed' || msg.id === 1) return;

      // Portfolio update — parse defensively across format variations
      const data = msg.data ?? msg.msg ?? {};

      // Order fills — deduplicated by orderId to handle reconnect replay
      const fills = data.order_fills ?? data.fills ?? [];
      for (const fill of (Array.isArray(fills) ? fills : [])) {
        const orderId = fill.order_id ?? fill.id ?? fill.trade_id;
        if (orderId != null) {
          if (this.#seenFills.has(orderId)) continue;
          if (this.#seenFills.size >= FILL_DEDUP_LIMIT) this.#seenFills.clear();
          this.#seenFills.add(orderId);
        }
        this.emit('order_filled', {
          ticker:  fill.ticker ?? fill.market_ticker,
          orderId,
          side:    fill.side,
          count:   fill.count ?? 0,
          price:   (fill.yes_price ?? fill.price ?? 0) / 100,
          ts:      fill.created_time ?? new Date().toISOString(),
        });
      }

      // Position updates — no dedup needed (latest value always wins)
      const positions = data.positions ?? data.portfolio ?? [];
      for (const pos of (Array.isArray(positions) ? positions : [])) {
        if (!pos.ticker && !pos.market_ticker) continue;
        this.emit('position_updated', {
          ticker:   pos.ticker ?? pos.market_ticker,
          position: pos.position ?? 0,
          value:    (pos.market_exposure ?? pos.value ?? 0) / 100,
        });
      }
    } catch (err) {
      console.error('[kalshi:ws] message handler error:', err.message);
    }
  }

  #onClose() {
    this.#clearTimers();
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

  #clearTimers() {
    clearInterval(this.#pingInterval);
    clearTimeout(this.#pingDeadline);
    clearTimeout(this.#reconnectTimer);
    this.#pingInterval   = null;
    this.#pingDeadline   = null;
    this.#reconnectTimer = null;
  }
}
