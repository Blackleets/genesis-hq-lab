#!/usr/bin/env node
// 1Hz paper scanner. No orders. No invented fills. LIVE_OFF.
//
// Algebra (same as harvest.mjs, ticker-only prefilter):
//   H_pre = spreadBps * 0.35 - 2 * makerFeeBps
//   makerFeeBps = 0.0002 * 10000 = 2  ⇒  2*fee = 4 bps
//   pre-quote iff H_pre >= 0.5 and notional(USDT) >= 1e6
// Then Kalman+VPIN+GLFT on the book can still refuse (WOULD_CROSS / VPIN_HALT).
// Taker scalping is NOT this desk: 2*taker ≈ 10 bps, ETH spread ≈ 0.04 bps.
// This loop does not mint a 6-gate GO.

import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scoreTapeAndBook, LIVE_OFF } from './captureCore.mjs';
import { replayCapture } from './captureEngine.mjs';
import { harvestScore } from './math/harvest.mjs';
import { tickerRows, OKX, MIN_NOTIONAL } from './captureUniverse.mjs';
import { selectScore, intersection, preH, MIN_EDGE_BPS } from './math/select.mjs';

const MAKER = 0.0002;
const TICK_MS = 1000;
const SCORE_COOLDOWN_MS = 3000;
const MAX_FULL_PER_TICK = 4;
const JSONL_CAP = 8000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

const OUT = arg('--out', 'paper-tape/hz1-latest.json');
const JSONL = arg('--jsonl', 'paper-tape/hz1.jsonl');
const once = process.argv.includes('--once');

const lastFull = new Map(); // instId -> ts

async function fetchTickers() {
  const r = await fetch(`${OKX}/api/v5/market/tickers?instType=SWAP`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} tickers`);
  const j = await r.json();
  return tickerRows(j.data);
}

async function fetchJson(url, ms = 5000) {
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
    fetchJson(`${OKX}/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=5`, 5000),
    fetchJson(`${OKX}/api/v5/market/trades?instId=${encodeURIComponent(instId)}&limit=80`, 5000),
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

function prefilter(rows, now) {
  const out = [];
  for (const s of rows) {
    const score = selectScore(s);
    s.preH = preH(s.spread);
    s.select = score;
    s.preQuote = s.preH >= MIN_EDGE_BPS;
    if (!Number.isFinite(score)) continue;
    const prev = lastFull.get(s.instId) || 0;
    if (now - prev < SCORE_COOLDOWN_MS) continue;
    out.push(s);
  }
  out.sort((a, b) => b.select - a.select);
  return out.slice(0, MAX_FULL_PER_TICK);
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

async function tick() {
  const t0 = Date.now();
  const all = await fetchTickers();
  const inter = intersection(all);
  const cand = prefilter(all, t0);
  const scored = [];
  for (const s of cand) {
    lastFull.set(s.instId, t0);
    try {
      const name = await loadName(s.instId);
      if (!name) {
        scored.push({
          symbol: s.instId,
          preH: s.preH,
          spread: s.spread,
          quote: false,
          reason: 'TAPE_PENDING',
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
      let fillCount = 0;
      let netPnl = 0;
      let captureReason = row.reason;
      if (row.quote) {
        const session = replayCapture({
          symbol: name.symbol,
          bid: name.bid,
          ask: name.ask,
          bidSz: name.bidSz,
          askSz: name.askSz,
          trades: name.trades,
          makerFeePct: MAKER,
        });
        fillCount = session.fills ? session.fills.length : 0;
        netPnl = Number.isFinite(session.netPnl) ? session.netPnl : 0;
        captureReason = session.reason || row.reason;
      }
      scored.push({
        symbol: row.symbol,
        preH: s.preH,
        spread: s.spread,
        quote: !!row.quote,
        reason: row.reason,
        harvestBps: Number.isFinite(row.harvestBps) ? +row.harvestBps.toFixed(4) : null,
        vpin: Number.isFinite(row.vpin) ? +row.vpin.toFixed(4) : null,
        fillCount,
        netPnl,
        captureReason,
      });
    } catch {
      scored.push({
        symbol: s.instId,
        preH: s.preH,
        spread: s.spread,
        quote: false,
        reason: 'TAPE_PENDING',
      });
    }
  }
  const reasons = {};
  for (const r of scored) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const quoted = scored.filter((r) => r.quote);
  const preN = inter.hGe;
  const snap = {
    ts: new Date().toISOString(),
    liveOff: LIVE_OFF,
    paper: true,
    go: false,
    hz: 1,
    tickers: all.length,
    preQuote: preN,
    full: scored.length,
    quoted: quoted.length,
    quotedNames: quoted.map((r) => r.symbol),
    filled: scored.filter((r) => r.fillCount > 0).length,
    paperPnl: scored.reduce((a, r) => a + (Number.isFinite(r.netPnl) ? r.netPnl : 0), 0),
    reasons,
    ms: Date.now() - t0,
    scored,
    intersection: inter,
    formula: 'H=spread*0.35-4bps; width is a toxicity prior. Kalman+VPIN+GLFT. not a GO.',
  };
  mkdirSync(dirname(OUT), { recursive: true });
  mkdirSync(dirname(JSONL), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snap, null, 2));
  appendFileSync(
    JSONL,
    JSON.stringify({
      ts: snap.ts,
      preQuote: snap.preQuote,
      full: snap.full,
      quoted: snap.quoted,
      quotedNames: snap.quotedNames,
      filled: snap.filled,
      paperPnl: snap.paperPnl,
      reasons: snap.reasons,
    }) + '\n',
  );
  trimJsonl(JSONL);
  console.log(
    JSON.stringify({
      ts: snap.ts,
      tickers: snap.tickers,
      preQuote: snap.preQuote,
      full: snap.full,
      quoted: snap.quoted,
      reasons: snap.reasons,
      ms: snap.ms,
    }),
  );
  return snap;
}

const first = await tick();
if (once) process.exit(0);
setInterval(() => {
  tick().catch((e) => console.error('hz1_fail', e && e.message));
}, TICK_MS);
console.error('harvest1hz 1s loop. first preQuote', first.preQuote, 'quoted', first.quoted);
