// api/genesis/capture.js — public OKX tape → paper Capture Desk (score + replay).
// Never sends an order. Never flips REAL_TRADING. LIVE_OFF is frozen true.
// No session: same public-market posture as /api/crypto/executions.
// If OKX is down or H does not clear, we return honest zeros — never a fake fill.
import { sendJson, sendMethodNotAllowed } from '../_lib/http.js';
import {
  replayUniverse,
  PAPER_CAPITAL,
} from '../../server/genesis/captureEngine.mjs';
import { scoreTapeAndBook, LIVE_OFF } from '../../server/genesis/captureCore.mjs';
import { loadDeny } from '../../server/genesis/captureDeny.mjs';

const OKX = 'https://www.okx.com';
const MAKER = 0.0002; // OKX SWAP listed maker, not a fitted edge
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 10;
const TRADE_LIMIT = 80;

function clampLimit(n) {
  const x = Number.parseInt(String(n ?? DEFAULT_LIMIT), 10);
  if (!Number.isFinite(x) || x < 1) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, x);
}

async function fetchJson(url, ms = 8000) {
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
  const j = await fetchJson(`${OKX}/api/v5/market/tickers?instType=SWAP`, 9000);
  const rows = Array.isArray(j.data) ? j.data : [];
  const scored = [];
  for (const t of rows) {
    const bid = +t.bidPx;
    const ask = +t.askPx;
    const vol = +t.volCcy24h;
    if (!(bid > 0) || !(ask > bid) || !(vol > 0)) continue;
    const instId = String(t.instId || '');
    if (!instId.endsWith('-USDT-SWAP')) continue;
    scored.push({ instId, bid, ask, vol, spread: spreadBps(bid, ask) });
  }
  scored.sort((a, b) => b.spread - a.spread);
  // Prefer names with real 24h notional so the tape is not empty.
  const liquid = scored.filter((s) => s.vol >= 50_000);
  const pool = liquid.length >= limit ? liquid : scored;
  return pool.slice(0, limit);
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
    fetchJson(`${OKX}/api/v5/market/books?instId=${encodeURIComponent(instId)}&sz=5`, 8000),
    fetchJson(`${OKX}/api/v5/market/trades?instId=${encodeURIComponent(instId)}&limit=${TRADE_LIMIT}`, 8000),
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
    const loaded = await Promise.all(uni.map((u) => loadName(u.instId).catch(() => null)));
    // Read-only deny skip. Serverless must not persist the map.
    const denyMap = loadDeny();
    const rows = [];
    for (const name of loaded) {
      if (!name) continue;
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
      rows.push(row);
    }
    const book = replayUniverse(rows, { denyMap });
    const bySym = new Map((book.sessions || []).map((s) => [s.symbol, s]));
    const out = rows.map((r) => {
      const s = bySym.get(r.symbol);
      const tape = r.tape;
      delete r.tape;
      return {
        symbol: r.symbol,
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
    });
    const quoted = out.filter((r) => r.quote).length;
    const filled = out.filter((r) => r.fillCount > 0).length;
    return sendJson(res, 200, {
      ok: true,
      liveOff: LIVE_OFF,
      paper: true,
      go: false,
      venue: 'okx',
      makerFeePct: MAKER,
      capital: PAPER_CAPITAL,
      scanned: out.length,
      quoted,
      filled,
      rows: out,
      ledger: { start: PAPER_CAPITAL, ...(book.ledger || emptyLedger), liveOff: LIVE_OFF },
      note: 'QUOTE/CAPTURED is paper only. Not a 6-gate GO. No orders sent.',
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
