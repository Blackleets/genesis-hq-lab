// server/genesis/liquidationStream.mjs
// LIVE LIQUIDATION STREAM — Binance futures !forceOrder@arr websocket.
// Captures every forced-liquidation order on the market in real time (free,
// no key), aggregates rolling stats per symbol, and persists a JSONL log.
//
// Why it matters: liquidation cascades are the highest-signal events in
// crypto — forced sellers/buyers create predictable mean-reversion pressure
// once the cascade exhausts. This module MEASURES them; strategies decide.
//
// Usage:
//   node liquidationStream.mjs --once        # connect for 60s, print stats, exit
//   node liquidationStream.mjs               # run until Ctrl+C
//
// Module API:
//   import { startLiquidationStream, getLiquidationStats } from './liquidationStream.mjs';
//   const stop = startLiquidationStream(); // idempotent
//   getLiquidationStats('COTIUSDT', { minutes: 60 });

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const LOG_FILE = path.join(__dirname, '../../data/liquidations/stream.jsonl');
const WS_URL = 'wss://stream.binancefuture.com/ws/!forceOrder@arr';
// NOTE: fstream.binance.com accepts the TCP/WS handshake but delivers zero
// frames on some networks (CDN-level block); the legacy host works.

let ws = null;
let started = false;
let reconnectTimer = null;
let events = []; // in-memory ring buffer [{t, symbol, side, price, qty, usd}]

function loadRecentFromDisk() {
  try {
    const raw = fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean);
    const cutoff = Date.now() - 24 * 3600 * 1000;
    return raw.slice(-20000).map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(e => e && e.t >= cutoff);
  } catch { return []; }
}

function appendToDisk(e) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, JSON.stringify(e) + '\n');
}

/** Rolling stats for one symbol over the last N minutes. */
export function getLiquidationStats(symbol = null, { minutes = 60 } = {}) {
  const cutoff = Date.now() - minutes * 60 * 1000;
  const rows = events.filter(e => e.t >= cutoff && (!symbol || e.symbol === symbol));
  const longs = rows.filter(e => e.side === 'SELL');  // longs liquidated -> forced sells
  const shorts = rows.filter(e => e.side === 'BUY');  // shorts liquidated -> forced buys
  const sumUsd = arr => +arr.reduce((s, e) => s + e.usd, 0).toFixed(0);
  const totalLongsUsd = sumUsd(longs);
  const totalShortsUsd = sumUsd(shorts);
  const biggest = rows.reduce((m, e) => (e.usd > (m?.usd ?? 0) ? e : m), null);
  return {
    symbol: symbol || 'ALL',
    windowMinutes: minutes,
    count: rows.length,
    longsLiquidatedUsd: totalLongsUsd,
    shortsLiquidatedUsd: totalShortsUsd,
    dominance: totalLongsUsd + totalShortsUsd > 0
      ? (totalLongsUsd > totalShortsUsd ? 'longs' : 'shorts')
      : 'none',
    imbalancePct: totalLongsUsd + totalShortsUsd > 0
      ? +(((totalLongsUsd - totalShortsUsd) / (totalLongsUsd + totalShortsUsd)) * 100).toFixed(1)
      : 0,
    biggestSingleUsd: biggest ? biggest.usd : 0,
    updatedAt: new Date().toISOString(),
  };
}

function handleMsg(raw) {
  try {
    const m = JSON.parse(raw);
    const o = m.o; // forceOrder payload
    if (!o) return;
    const evt = {
      t: +o.T ?? Date.now(),
      symbol: o.s,
      side: o.S,                    // SELL = long liquidated, BUY = short liquidated
      price: +o.ap || +o.p,
      qty: +o.q,
      usd: Math.round((+o.ap || +o.p) * (+o.q)),
    };
    events.push(evt);
    appendToDisk(evt);
    // keep ~24h of 1s-granularity events bounded in memory
    if (events.length > 30000) events = events.slice(-25000);
  } catch { /* malformed frame */ }
}

export function startLiquidationStream() {
  if (started) return () => {};
  started = true;
  events = loadRecentFromDisk();
  let alive = false;

  const connect = () => {
    try {
      ws = new WebSocket(WS_URL);
      alive = true;
      ws.onmessage = ev => handleMsg(typeof ev.data === 'string' ? ev.data : '');
      ws.onclose = () => {
        alive = false;
        reconnectTimer = setTimeout(connect, 5000); // auto-reconnect
      };
      ws.onerror = () => { try { ws.close(); } catch { /* noop */ } };
    } catch {
      reconnectTimer = setTimeout(connect, 5000);
    }
  };
  connect();

  return () => {
    started = false;
    clearTimeout(reconnectTimer);
    if (ws && alive) { try { ws.close(); } catch { /* noop */ } }
  };
}

// ----- CLI -----
const isCli = process.argv[1] && process.argv[1].endsWith('liquidationStream.mjs');
if (isCli) {
  const once = process.argv.includes('--once');
  startLiquidationStream();
  const tick = () => {
    const all = getLiquidationStats(null, { minutes: 15 });
    console.log(`[${new Date().toLocaleTimeString()}] 15min: ${all.count} liq | longs $${all.longsLiquidatedUsd.toLocaleString()} | shorts $${all.shortsLiquidatedUsd.toLocaleString()} | dominan ${all.dominance} (${all.imbalancePct}%)`);
  };
  tick(); // show disk-reloaded history immediately
  if (once) {
    setTimeout(() => { tick(); console.log('done (--once)'); process.exit(0); }, 60000);
  } else {
    setInterval(tick, 15000);
  }
}
