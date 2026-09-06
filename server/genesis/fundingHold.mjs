// Paper funding hold on OKX SWAP. Never sends an order. LIVE_OFF frozen.
// Positive funding => longs pay shorts. We paper-short to collect.
// Credit ONLY realized history prints, never the predicted rate.
// MTM is mark, not a win.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

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

/** No new paper tickets while fees already beat collected funding. Stops PONS-class churn. */
export function feesDominate(state) {
  const cobrado = Number(state?.realizedFundingUsdt) || 0;
  const fees = Number(state?.feesUsdt) || 0;
  return fees > cobrado;
}

function nowIso() {
  return new Date().toISOString();
}

async function getJson(url, ms = 9000) {
  const r = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function emptyState() {
  return {
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
  };
}

function loadState(path) {
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    if (!j || j.paper !== true) return emptyState();
    j.holds = Array.isArray(j.holds) ? j.holds : [];
    j.closed = Array.isArray(j.closed) ? j.closed : [];
    return j;
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
  const state = loadState(statePath);
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

  // settle + mark existing
  for (const h of state.holds) {
    const mkt = byId.get(h.instId);
    if (mkt) {
      h.mid = mkt.mid;
      h.mtmUsdt = mtmUsdt(h, mkt.mid);
      const mtmBps = (h.mtmUsdt / h.notional) * 1e4;
      if (!h.halt && mtmBps <= -HALT_BPS) {
        const exitFee = TAKER * h.notional;
        state.feesUsdt += exitFee;
        h.halt = true;
        h.haltReason = 'MARKOUT_HALT';
        h.closedTs = nowIso();
        h.exitPx = mkt.mid;
        state.closed.push({ ...h });
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
        // opened after this settle → skip
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
  }
  state.holds = state.holds.filter((h) => !h.halt);

  // open slots: predicted |bps| >= 4, last realized same sign, liquid
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
  // Hard lock: while fees > cobrado, do not open — burning entry fees is not an edge.
  const feeLocked = feesDominate(state);
  if (feeLocked) {
    state.feeLock = true;
    state.feeLockReason = 'FEES_DOMINATE';
  } else {
    state.feeLock = false;
    state.feeLockReason = null;
  }
  if (!feeLocked && state.holds.length < MAX_HOLDS) {
    const cand = liquid.filter((s) => !openIds.has(s.instId) && !denied.has(s.instId)).slice(0, 30);
    const scored = [];
    await pool(cand, 4, async (s) => {
      try {
        const fr = await getJson(`${OKX}/api/v5/public/funding-rate?instId=${s.instId}`);
        const d = (fr.data || [])[0] || {};
        const rate = +d.fundingRate;
        const next = Number(d.nextFundingTime) || 0;
        if (!Number.isFinite(rate) || !(Math.abs(rate) * 1e4 >= MIN_PRED_BPS)) return;
        if (Math.abs(rate) * 1e4 > MAX_PRED_BPS) return; // toxic wide funding
        const hist = await getJson(
          `${OKX}/api/v5/public/funding-rate-history?instId=${s.instId}&limit=8`,
        );
        const rows = Array.isArray(hist.data) ? hist.data : [];
        const last = rows[0];
        const lastRate = last ? +last.fundingRate : 0;
        if (last && Number.isFinite(lastRate) && lastRate !== 0 && Math.sign(lastRate) !== Math.sign(rate)) {
          return; // predicted flipped vs last print
        }
        const bps = rows.map((x) => +x.fundingRate * 1e4).filter((b) => Number.isFinite(b));
        if (bps.length < 4) return;
        const sign = Math.sign(rate);
        const persist = bps.filter((b) => Math.sign(b) === sign).length;
        if (persist < 4) return; // sticky funding
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
        feeUsdt: fee,
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
  const names = state.holds.map((h) => `${h.instId.replace('-USDT-SWAP', '')} ${h.side}`).join(', ');
  const cobrado = Number(state.realizedFundingUsdt) || 0;
  const fees = Number(state.feesUsdt) || 0;
  if (names) {
    state.note = `paper hold ${names}. cobrado ${cobrado.toFixed(2)} USDT en ${state.settledCount} settles. a mercado ${state.mtmUsdt.toFixed(2)}. fees ${fees.toFixed(2)}. live off. no es un GO.`;
  } else if (feeLocked) {
    state.note = `candado fees: cobrado ${cobrado.toFixed(2)} < fees ${fees.toFixed(2)}. sin ticket nuevo hasta que el cobro gane. live off. no es un GO.`;
  } else {
    state.note = 'sin hold paper. live off. no se inventa un cobro.';
  }
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
          realized: s.realizedFundingUsdt,
          mtm: s.mtmUsdt,
          fees: s.feesUsdt,
          names: s.holds.map((h) => h.instId),
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
