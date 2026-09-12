#!/usr/bin/env node
// Paper harvest worker. No orders. No invented fills. LIVE_OFF.
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scoreTapeAndBook, LIVE_OFF } from './captureCore.mjs';
import { pickUniverse, OKX } from './captureUniverse.mjs';

const MAKER = 0.0002;
const CONC = 8;
const TRADE_LIMIT = 80;
const CYCLE_MS = 90_000;
const JSONL_CAP = 2000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const OUT = arg('--out', 'paper-tape/capture-latest.json');
const JSONL = arg('--jsonl', 'paper-tape/capture.jsonl');
const once = process.argv.includes('--once');

async function fetchJson(url, ms = 7000) {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

function mapTrades(data) {
  const arr = Array.isArray(data) ? data : [];
  return arr
    .map((t) => ({
      price: +t.px,
      amount: +t.sz,
      side: t.side === 'buy' || t.side === 'sell' ? t.side : undefined,
    }))
    .filter((t) => t.price > 0 && t.amount > 0);
}

async function loadName(instId) {
  const [bookJ, tradeJ] = await Promise.all([
    fetchJson(`${OKX}/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=5`, 7000),
    fetchJson(`${OKX}/api/v5/market/trades?instId=${encodeURIComponent(instId)}&limit=${TRADE_LIMIT}`, 7000),
  ]);
  const book = bookJ.data && bookJ.data[0];
  const bidRow = book && book.bids && book.bids[0];
  const askRow = book && book.asks && book.asks[0];
  const bid = bidRow ? +bidRow[0] : NaN;
  const ask = askRow ? +askRow[0] : NaN;
  const bidSz = bidRow && +bidRow[1] > 0 ? +bidRow[1] : undefined;
  const askSz = askRow && +askRow[1] > 0 ? +askRow[1] : undefined;
  if (!(bid > 0) || !(ask > bid)) return null;
  const name = { symbol: instId, bid, ask, trades: mapTrades(tradeJ.data) };
  if (bidSz > 0 && askSz > 0) {
    name.bidSz = bidSz;
    name.askSz = askSz;
  }
  return name;
}

async function poolMap(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, Math.max(1, items.length)) }, worker));
  return out;
}

function compact(row, sleeve) {
  return {
    symbol: row.symbol,
    sleeve: sleeve || null,
    quote: !!row.quote,
    reason: row.reason,
    harvestBps: Number.isFinite(row.harvestBps) ? +row.harvestBps.toFixed(4) : null,
    spreadBps: Number.isFinite(row.spreadBps) ? +row.spreadBps.toFixed(4) : null,
    vpin: Number.isFinite(row.vpin) ? +row.vpin.toFixed(4) : null,
    fair: Number.isFinite(row.fair) ? row.fair : null,
    mid: Number.isFinite(row.mid) ? row.mid : null,
  };
}

function trimJsonl(path) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= JSONL_CAP) return;
    writeFileSync(path, lines.slice(-JSONL_CAP).join('\n') + '\n');
  } catch {
    /* first write */
  }
}

async function cycle() {
  const t0 = Date.now();
  const uni = await pickUniverse(40);
  const loaded = await poolMap(uni, CONC, (u) => loadName(u.instId));
  const rows = [];
  const sleeveOf = new Map(uni.map((u) => [u.instId, u.sleeve]));
  for (let i = 0; i < uni.length; i++) {
    const name = loaded[i];
    const sleeve = sleeveOf.get(uni[i].instId);
    if (!name) {
      rows.push({
        symbol: uni[i].instId,
        sleeve: sleeve || null,
        quote: false,
        reason: 'TAPE_PENDING',
        harvestBps: null,
        spreadBps: Number.isFinite(uni[i].spread) ? +uni[i].spread.toFixed(4) : null,
        vpin: null,
        fair: null,
        mid: Number.isFinite(uni[i].mid) ? uni[i].mid : null,
      });
      continue;
    }
    const opts = {
      symbol: name.symbol,
      bid: name.bid,
      ask: name.ask,
      trades: name.trades,
      makerFeePct: MAKER,
    };
    if (name.bidSz > 0 && name.askSz > 0) {
      opts.bidSz = name.bidSz;
      opts.askSz = name.askSz;
    }
    const row = scoreTapeAndBook(opts);
    rows.push(compact(row, sleeve));
  }
  const reasons = {};
  for (const r of rows) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const quoted = rows.filter((r) => r.quote);
  const snap = {
    ts: new Date().toISOString(),
    liveOff: LIVE_OFF,
    paper: true,
    go: false,
    venue: 'okx',
    universe: uni.length,
    scored: rows.length,
    quoted: quoted.length,
    reasons,
    ms: Date.now() - t0,
    quotedNames: quoted.map((r) => r.symbol),
    rows,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  mkdirSync(dirname(JSONL), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snap, null, 2));
  appendFileSync(
    JSONL,
    JSON.stringify({
      ts: snap.ts,
      scored: snap.scored,
      quoted: snap.quoted,
      reasons: snap.reasons,
      quotedNames: snap.quotedNames,
    }) + '\n',
  );
  trimJsonl(JSONL);
  console.log(JSON.stringify({ ts: snap.ts, scored: snap.scored, quoted: snap.quoted, reasons: snap.reasons, ms: snap.ms }));
  return snap;
}

let first = await cycle();
if (first.scored === 0) first = await cycle();
if (once) process.exit(0);
setInterval(() => {
  cycle().catch((e) => console.error('cycle_fail', e && e.message));
}, CYCLE_MS);
console.error('harvestWorker looping', CYCLE_MS, 'first quoted', first.quoted);
