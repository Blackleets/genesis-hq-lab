// api/genesis/capture.js — public OKX tape → paper Capture Desk (score + replay).
// Never sends an order. Never flips REAL_TRADING. LIVE_OFF is frozen true.
// Universe = top N USDT-SWAP by 24h volume, NOT widest spread (spread-sort
// was feeding toxic junk: PURR / VPIN_HALT). Full Kalman score per name;
// if a book fetch dies, that row is TAPE_PENDING — never a fake fill.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import {
  replayUniverse,
  PAPER_CAPITAL,
} from '../../server/genesis/captureEngine.mjs';
import { scoreTapeAndBook, LIVE_OFF } from '../../server/genesis/captureCore.mjs';
import { loadDeny } from '../../server/genesis/captureDeny.mjs';
import { pickUniverse as pickOkxUniverse } from '../../server/genesis/captureUniverse.mjs';

const OKX = 'https://www.okx.com';
const MAKER = 0.0002; // OKX SWAP listed maker, not a fitted edge
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 40;
const TRADE_LIMIT = 80;
const CONC = 8;

function clampLimit(n) {
  const x = Number.parseInt(String(n ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(x) || x < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, x);
}

async function fetchJson(url, ms = 7000) {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function spreadBps(bid, ask) {
  const mid = (bid + ask) / 2;
  if (!(mid > 0)) return 0;
  return ((ask - bid) / mid) * 1e4;
}

async function pickUniverse(limit) {
  return pickOkxUniverse(limit);
}

function mapTrades(data) {
  const arr = Array.isArray(data) ? data : [];
  return arr.map((t) => ({
    price: +t.px,
    amount: +t.sz,
    side: t.side === 'buy' || t.side === 'sell' ? t.side : undefined,
  })).filter((t) => t.price > 0 && t.amount > 0);
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
  const name = {
    symbol: instId,
    bid,
    ask,
    trades: mapTrades(tradeJ.data),
  };
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
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

function pendingRow(u) {
  return {
    symbol: u.instId,
    sleeve: u.sleeve || null,
    quote: false,
    reason: 'TAPE_PENDING',
    harvestBps: Number.NEGATIVE_INFINITY,
    spreadBps: u.spread,
    feeBps: 0,
    asBps: 0,
    vpin: 0,
    netPnl: 0,
    fillCount: 0,
    captureReason: 'TAPE_PENDING',
    tapeLen: 0,
    mid: (u.bid + u.ask) / 2,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendMethodNotAllowed(res);
  const url = new URL(req.url, `http://${req.headers.host}`);
  const limit = clampLimit(url.searchParams.get('limit'));
  const emptyLedger = {
    paperBalanceUSDT: PAPER_CAPITAL,
    start: PAPER_CAPITAL,
    liveOff: LIVE_OFF,
  };
  try {
    const uni = await pickUniverse(limit);
    const loaded = await poolMap(uni, CONC, (u) => loadName(u.instId));
    const denyMap = loadDeny();
    const scored = [];
    const byIndex = new Array(uni.length);
    for (let i = 0; i < uni.length; i++) {
      const name = loaded[i];
      if (!name) {
        byIndex[i] = pendingRow(uni[i]);
        continue;
      }
      const scoreOpts = {
        symbol: name.symbol,
        bid: name.bid,
        ask: name.ask,
        trades: name.trades,
        makerFeePct: MAKER,
        denyMap,
      };
      if (name.bidSz > 0 && name.askSz > 0) {
        scoreOpts.bidSz = name.bidSz;
        scoreOpts.askSz = name.askSz;
      }
      const row = scoreTapeAndBook(scoreOpts);
      row.tape = name.trades;
      if (name.bidSz > 0) row.bidSz = name.bidSz;
      if (name.askSz > 0) row.askSz = name.askSz;
      scored.push(row);
      byIndex[i] = row;
    }
    const book = replayUniverse(scored, { denyMap });
    const bySym = new Map((book.sessions || []).map((s) => [s.symbol, s]));
    const out = byIndex.map((r, i) => {
      if (!r || r.reason === 'TAPE_PENDING') return r || pendingRow(uni[i]);
      const s = bySym.get(r.symbol);
      const tape = r.tape;
      delete r.tape;
      const rowOut = {
        symbol: r.symbol,
        sleeve: r.sleeve || (uni.find((u) => u.instId === r.symbol) || {}).sleeve || null,
        quote: !!r.quote,
        reason: r.reason,
        harvestBps: r.harvestBps,
        spreadBps: r.spreadBps,
        feeBps: r.feeBps,
        asBps: r.asBps,
        vpin: r.vpin,
        netPnl: s ? s.netPnl : 0,
        fillCount: s && s.fills ? s.fills.length : 0,
        captureReason: s ? s.reason : r.reason,
        tapeLen: Array.isArray(tape) ? tape.length : 0,
      };
      if (Number.isFinite(r.fair)) rowOut.fair = r.fair;
      if (Number.isFinite(r.mid)) rowOut.mid = r.mid;
      if (Number.isFinite(r.imbalance)) rowOut.imbalance = r.imbalance;
      if (s && Number.isFinite(s.kellyF)) rowOut.kellyF = s.kellyF;
      return rowOut;
    });
    const quoted = out.filter((r) => r.quote).length;
    const filled = out.filter((r) => r.fillCount > 0).length;
    const pending = out.filter((r) => r.reason === 'TAPE_PENDING').length;
    return sendJson(res, 200, {
      ok: true,
      liveOff: LIVE_OFF,
      paper: true,
      go: false,
      venue: 'okx',
      makerFeePct: MAKER,
      capital: PAPER_CAPITAL,
      scanned: out.length,
      scored: scored.length,
      pending,
      quoted,
      filled,
      rows: out,
      ledger: { start: PAPER_CAPITAL, ...(book.ledger || emptyLedger), liveOff: LIVE_OFF },
      note: 'Maker sleeve: notional ≥ $1M and spread ≥ 5 bps, then watch majors. QUOTE is paper only. Not a 6-gate GO. No orders sent.',
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    return sendJson(res, 200, {
      ok: false,
      liveOff: LIVE_OFF,
      paper: true,
      go: false,
      venue: 'okx',
      scanned: 0,
      quoted: 0,
      filled: 0,
      rows: [],
      ledger: emptyLedger,
      error: e && e.message ? String(e.message) : 'capture_scan_failed',
      note: 'desk stood down. no invented fills.',
      updatedAt: new Date().toISOString(),
    });
  }
}
