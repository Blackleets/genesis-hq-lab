// Paper funding hold on OKX SWAP. Never sends an order. LIVE_OFF frozen.
// Positive funding => longs pay shorts. We paper-short to collect.
// Credit ONLY realized history prints, never the predicted rate.
// MTM is mark, not a win. Closed price losses/gains are persisted in Truth Ledger v2.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  pricePnlForClosedTrade,
  reconcileFundingState,
} from './fundingTruthLedger.mjs';

export const OKX = 'https://www.okx.com';
export const TAKER = 0.0005; // listed VIP0 SWAP taker 5bps
export const NOTIONAL = 2500; // paper size-up; fees scale too
export const MAX_HOLDS = 1; // one ticket — no fee churn
export const HALT_BPS = 25;
export const MIN_LIQ = 20_000_000; // size-up floor
export const MIN_PRED_BPS = 5;
export const MAX_PRED_BPS = 12; // above: toxic junk (PONS-class)
export const MAX_SPREAD_BPS = 8;
export const LIVE_OFF = true;

function nowIso() {
  return new Date().toISOString();
}

async function getJson(url, ms = 9000) {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function emptyState() {
  return reconcileFundingState({
    paper: true,
    liveOff: true,
    go: false,
    ts: nowIso(),
    capital: 10000,
    realizedFundingUsdt: 0,
    feesUsdt: 0,
    mtmUsdt: 0,
    settledCount: 0,
    holds: [],
    closed: [],
    note: 'paper funding. live off. no es un GO.',
  });
}

function loadState(path) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    if (!j || j.paper !== true) return emptyState();
    j.holds = Array.isArray(j.holds) ? j.holds : [];
    j.closed = Array.isArray(j.closed) ? j.closed : [];
    // Migrates legacy snapshots in memory: any loss trapped only in closed[].mtmUsdt
    // becomes visible immediately in realizedPricePnlUsdt/equity.
    return reconcileFundingState(j);
  } catch {
    return emptyState();
  }
}

function saveState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2) + '\n');
}

function midOf(t) {
  const bid = +t.bidPx;
  const ask = +t.askPx;
  if (!(bid > 0) || !(ask > bid)) return null;
  return (bid + ask) / 2;
}

function mtmUsdt(h, mid) {
  if (!(mid > 0) || !(h.entryPx > 0)) return 0;
  if (h.side === 'short') return ((h.entryPx - mid) / h.entryPx) * h.notional;
  return ((mid - h.entryPx) / h.entryPx) * h.notional;
}

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const k = i++;
      out[k] = await fn(items[k], k);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

export async function runHold({ statePath, once = false } = {}) {
  let state = loadState(statePath);
  const tickersJ = await getJson(`${OKX}/api/v5/market/tickers?instType=SWAP`);
  const tickers = Array.isArray(tickersJ.data) ? tickersJ.data : [];
  const byId = new Map();
  const liquid = [];
  for (const t of tickers) {
    const instId = String(t.instId || '');
    if (!instId.endsWith('-USDT-SWAP')) continue;
    const mid = midOf(t);
    if (!mid) continue;
    const vol = +t.volCcy24h;
    const notional = (vol > 0 ? vol : 0) * mid;
    const spread = mid > 0 ? ((+t.askPx - +t.bidPx) / mid) * 1e4 : 0;
    const row = { instId, bid: +t.bidPx, ask: +t.askPx, mid, notional, spread };
    byId.set(instId, row);
    if (notional >= MIN_LIQ) liquid.push(row);
  }
  liquid.sort((a, b) => b.notional - a.notional);

  // Settle + mark existing. If a markout halt is triggered, funding history is
  // reconciled first and only then is the final closed snapshot persisted.
  for (const h of state.holds) {
    let pendingClose = null;
    const mkt = byId.get(h.instId);
    if (mkt) {
      h.mid = mkt.mid;
      h.mtmUsdt = mtmUsdt(h, mkt.mid);
      const mtmBps = (h.mtmUsdt / h.notional) * 1e4;
      if (!h.halt && mtmBps <= -HALT_BPS) {
        pendingClose = {
          exitPx: mkt.mid,
          exitFeeUsdt: TAKER * h.notional,
          haltReason: 'MARKOUT_HALT',
        };
      }
    }

    try {
      const hist = await getJson(
        `${OKX}/api/v5/public/funding-rate-history?instId=${h.instId}&limit=5`,
      );
      const rows = Array.isArray(hist.data) ? hist.data : [];
      for (const ev of rows.reverse()) {
        const ts = Number(ev.fundingTime);
        const rate = +ev.fundingRate;
        if (!Number.isFinite(ts) || !Number.isFinite(rate)) continue;
        if (ts <= (h.lastSettledTime || 0)) continue;
        if (ts > Date.now()) continue;
        const opened = Date.parse(h.entryTs) || 0;
        if (ts < opened) continue;
        const signed = h.side === 'short' ? rate : -rate;
        const pay = signed * h.notional;
        h.realizedFundingUsdt = (h.realizedFundingUsdt || 0) + pay;
        state.realizedFundingUsdt += pay;
        state.settledCount += 1;
        h.lastSettledTime = ts;
        h.lastSettledBps = rate * 1e4;
      }
    } catch {
      /* public hist miss — do not invent a settle */
    }

    if (pendingClose) {
      state.feesUsdt += pendingClose.exitFeeUsdt;
      h.halt = true;
      h.haltReason = pendingClose.haltReason;
      h.closedTs = nowIso();
      h.exitPx = pendingClose.exitPx;
      h.entryFeeUsdt = Number.isFinite(+h.entryFeeUsdt) ? +h.entryFeeUsdt : (+h.feeUsdt || 0);
      h.exitFeeUsdt = pendingClose.exitFeeUsdt;
      h.realizedPricePnlUsdt = pricePnlForClosedTrade(h);
      state.closed.push({ ...h });
    }
  }
  state.holds = state.holds.filter((h) => !h.halt);

  const denyUntil = 24 * 3600 * 1000;
  const denied = new Set(
    (state.closed || [])
      .filter((c) => {
        const age = Date.now() - (Date.parse(c.closedTs) || 0);
        if (c.haltReason === 'THIN_TOXIC' && age < 7 * 24 * 3600 * 1000) return true;
        return c.haltReason === 'MARKOUT_HALT' && age < denyUntil;
      })
      .map((c) => c.instId),
  );
  const openIds = new Set(state.holds.map((h) => h.instId));

  // Size-up paper: may reopen when flat. Never stack tickets (MAX_HOLDS=1).
  if (state.holds.length < MAX_HOLDS) {
    const cand = liquid.filter((s) => !openIds.has(s.instId) && !denied.has(s.instId)).slice(0, 30);
    const scored = [];
    await pool(cand, 4, async (s) => {
      try {
        const fr = await getJson(`${OKX}/api/v5/public/funding-rate?instId=${s.instId}`);
        const d = (fr.data || [])[0] || {};
        const rate = +d.fundingRate;
        const next = Number(d.nextFundingTime) || 0;
        if (!Number.isFinite(rate) || !(Math.abs(rate) * 1e4 >= MIN_PRED_BPS)) return;
        if (Math.abs(rate) * 1e4 > MAX_PRED_BPS) return;
        const hist = await getJson(
          `${OKX}/api/v5/public/funding-rate-history?instId=${s.instId}&limit=8`,
        );
        const rows = Array.isArray(hist.data) ? hist.data : [];
        const last = rows[0];
        const lastRate = last ? +last.fundingRate : 0;
        if (last && Number.isFinite(lastRate) && lastRate !== 0 && Math.sign(lastRate) !== Math.sign(rate)) {
          return;
        }
        const bps = rows.map((x) => +x.fundingRate * 1e4).filter((b) => Number.isFinite(b));
        if (bps.length < 4) return;
        const sign = Math.sign(rate);
        const persist = bps.filter((b) => Math.sign(b) === sign).length;
        if (persist < 4) return;
        const mean8 = bps.reduce((a, b) => a + b, 0) / bps.length;
        if (Math.abs(mean8) < 2.5) return;
        if (s.spread > MAX_SPREAD_BPS) return;
        scored.push({
          ...s,
          rate,
          next,
          predBps: rate * 1e4,
          lastBps: lastRate * 1e4,
          mean8,
          persist,
        });
      } catch {
        /* skip name */
      }
    });
    scored.sort((a, b) => Math.abs(b.mean8 || b.predBps) - Math.abs(a.mean8 || a.predBps));
    for (const s of scored) {
      if (state.holds.length >= MAX_HOLDS) break;
      const side = s.rate > 0 ? 'short' : 'long';
      const px = side === 'short' ? s.bid : s.ask;
      if (!(px > 0)) continue;
      const fee = TAKER * NOTIONAL;
      const qty = NOTIONAL / px;
      state.feesUsdt += fee;
      const hold = {
        instId: s.instId,
        side,
        qty,
        entryPx: px,
        entryTs: nowIso(),
        notional: NOTIONAL,
        feeUsdt: fee, // legacy compatibility
        entryFeeUsdt: fee,
        exitFeeUsdt: 0,
        predictedBps: s.predBps,
        lastRealizedBps: s.lastBps,
        nextFundingTime: s.next,
        lastSettledTime: 0,
        realizedFundingUsdt: 0,
        mtmUsdt: 0,
        mid: s.mid,
        halt: false,
      };
      hold.mtmUsdt = mtmUsdt(hold, s.mid);
      state.holds.push(hold);
      openIds.add(s.instId);
    }
  }

  state.mtmUsdt = state.holds.reduce((a, h) => a + (h.mtmUsdt || 0), 0);
  state.ts = nowIso();
  state.paper = true;
  state.liveOff = true;
  state.go = false;

  // Recompute from auditable closed rows every tick. This is intentionally
  // fail-honest: a closed price loss can no longer disappear from top-line P&L.
  state = reconcileFundingState(state);

  const names = state.holds.map((h) => `${h.instId.replace('-USDT-SWAP', '')} ${h.side}`).join(', ');
  state.note = names
    ? `paper hold ${names}. funding ${state.realizedFundingUsdt.toFixed(2)}. precio realizado ${state.realizedPricePnlUsdt.toFixed(2)}. fees ${state.feesUsdt.toFixed(2)}. MTM ${state.mtmUsdt.toFixed(2)}. neto económico ${state.economicPnlUsdt.toFixed(2)}. live off. no es un GO.`
    : `sin hold paper. funding ${state.realizedFundingUsdt.toFixed(2)}. precio realizado ${state.realizedPricePnlUsdt.toFixed(2)}. fees ${state.feesUsdt.toFixed(2)}. neto realizado ${state.realizedNetPnlUsdt.toFixed(2)}. live off. no es un GO.`;
  saveState(statePath, state);
  return state;
}

function parseArgs(argv) {
  const out = { once: false, statePath: '/workspace/capture-harvest/funding-latest.json' };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--once') out.once = true;
    else if (argv[i] === '--state' && argv[i + 1]) out.statePath = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) out.statePath = argv[++i];
  }
  return out;
}

const isMain = process.argv[1] && process.argv[1].endsWith('fundingHold.mjs');
if (isMain) {
  const args = parseArgs(process.argv);
  const loop = async () => {
    try {
      const s = await runHold(args);
      console.log(
        JSON.stringify({
          ts: s.ts,
          holds: s.holds.length,
          settled: s.settledCount,
          funding: s.realizedFundingUsdt,
          realizedPrice: s.realizedPricePnlUsdt,
          realizedNet: s.realizedNetPnlUsdt,
          mtm: s.mtmUsdt,
          economicPnl: s.economicPnlUsdt,
          equity: s.equityUsdt,
          fees: s.feesUsdt,
          names: s.holds.map((h) => h.instId),
          ledgerVersion: s.ledgerVersion,
          liveOff: true,
          go: false,
        }),
      );
    } catch (e) {
      console.error('fundingHold', e && e.message ? e.message : e);
    }
  };
  await loop();
  if (!args.once) {
    setInterval(loop, 60_000);
  }
}
