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

// Pre-trade economics. A funding print is not edge if fees/spread consume it.
// Require two conservative funding events because a single 5-12bps print cannot
// reliably pay a 10bps taker round-trip plus spread. This remains PAPER only.
export const ROUND_TRIP_FEE_BPS = TAKER * 2 * 1e4;
export const EXPECTED_SETTLES = 2;
export const EXECUTION_BUFFER_BPS = 2;
export const MIN_NET_EDGE_BPS = 2;

function strictNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Conservative pre-trade funding economics; missing evidence always fails closed. */
export function fundingEconomics({ predBps, meanBps, spreadBps, expectedSettles = EXPECTED_SETTLES } = {}) {
  const pred = strictNumber(predBps);
  const mean = strictNumber(meanBps);
  const spread = strictNumber(spreadBps);
  const settles = strictNumber(expectedSettles);
  if (pred === null || mean === null || spread === null || settles === null || settles < 1) {
    return {
      pass: false,
      reason: 'ECONOMICS_EVIDENCE_MISSING',
      conservativePerSettleBps: null,
      grossCaptureBps: null,
      executionCostBps: null,
      netEdgeBps: null,
    };
  }
  const conservativePerSettleBps = Math.min(Math.abs(pred), Math.abs(mean));
  const grossCaptureBps = conservativePerSettleBps * settles;
  // One full spread approximates crossing half-spread on entry + half-spread on exit.
  const executionCostBps = ROUND_TRIP_FEE_BPS + Math.max(0, spread) + EXECUTION_BUFFER_BPS;
  const netEdgeBps = grossCaptureBps - executionCostBps;
  return {
    pass: netEdgeBps >= MIN_NET_EDGE_BPS,
    reason: netEdgeBps >= MIN_NET_EDGE_BPS ? null : 'FUNDING_EDGE_BELOW_EXECUTION_HURDLE',
    conservativePerSettleBps,
    grossCaptureBps,
    executionCostBps,
    netEdgeBps,
  };
}

/** The PAPER lifecycle must match the settlement count used by the entry economics. */
export function targetSettlesReached(hold = {}, fallbackTarget = EXPECTED_SETTLES) {
  const count = strictNumber(hold?.settledCount) ?? 0;
  const target = strictNumber(hold?.expectedSettles) ?? strictNumber(fallbackTarget);
  return target !== null && target >= 1 && count >= target;
}

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

function executableExitPx(h, mkt) {
  if (!mkt) return null;
  const px = h.side === 'short' ? Number(mkt.ask) : Number(mkt.bid);
  return px > 0 ? px : null;
}

function closePaperHold(state, h, mkt, reason) {
  if (h.halt) return false;
  const exitPx = executableExitPx(h, mkt);
  if (!(exitPx > 0) || !(h.notional > 0)) return false;
  const exitFeeUsdt = TAKER * h.notional;
  const realizedPricePnlUsdt = mtmUsdt(h, exitPx);
  state.feesUsdt += exitFeeUsdt;
  h.halt = true;
  h.haltReason = reason;
  h.closedTs = nowIso();
  h.exitPx = exitPx;
  h.exitFeeUsdt = exitFeeUsdt;
  h.realizedPricePnlUsdt = realizedPricePnlUsdt;
  h.mtmUsdt = realizedPricePnlUsdt;
  state.closed.push({ ...h });
  return true;
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

  // Settle + mark existing PAPER holds. Markout can stop early; otherwise the
  // planned lifecycle closes after the same number of settles used by entry economics.
  for (const h of state.holds) {
    const mkt = byId.get(h.instId);
    if (mkt) {
      h.mid = mkt.mid;
      h.mtmUsdt = mtmUsdt(h, mkt.mid);
      const mtmBps = (h.mtmUsdt / h.notional) * 1e4;
      if (!h.halt && mtmBps <= -HALT_BPS) {
        closePaperHold(state, h, mkt, 'MARKOUT_HALT');
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
        h.settledCount = (Number(h.settledCount) || 0) + 1;
        h.lastSettledTime = ts;
        h.lastSettledBps = rate * 1e4;
      }
    } catch {
      /* public hist miss — do not invent a settle */
    }
    if (!h.halt && mkt && targetSettlesReached(h)) {
      closePaperHold(state, h, mkt, 'TARGET_SETTLES_REACHED');
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
        if (Math.abs(rate) * 1e4 > MAX_PRED_BPS) return;
        const hist = await getJson(
          `${OKX}/api/v5/public/funding-rate-history?instId=${s.instId}&limit=8`,
        );
        const rows = Array.isArray(hist.data) ? hist.data : [];
        const last = rows[0];
        const lastRate = last ? +last.fundingRate : 0;
        if (last && Number.isFinite(lastRate) && lastRate !== 0 && Math.sign(lastRate) !== Math.sign(rate)) return;
        const bps = rows.map((x) => +x.fundingRate * 1e4).filter((b) => Number.isFinite(b));
        if (bps.length < 4) return;
        const sign = Math.sign(rate);
        const persist = bps.filter((b) => Math.sign(b) === sign).length;
        if (persist < 4) return;
        const mean8 = bps.reduce((a, b) => a + b, 0) / bps.length;
        if (Math.abs(mean8) < 2.5) return;
        if (s.spread > MAX_SPREAD_BPS) return;
        const economics = fundingEconomics({ predBps: rate * 1e4, meanBps: mean8, spreadBps: s.spread });
        if (!economics.pass) return;
        scored.push({ ...s, rate, next, predBps: rate * 1e4, lastBps: lastRate * 1e4, mean8, persist, economics });
      } catch {
        /* skip name */
      }
    });
    scored.sort((a, b) => (b.economics?.netEdgeBps ?? -Infinity) - (a.economics?.netEdgeBps ?? -Infinity));
    for (const s of scored) {
      if (state.holds.length >= MAX_HOLDS) break;
      const side = s.rate > 0 ? 'short' : 'long';
      const px = side === 'short' ? s.bid : s.ask;
      if (!(px > 0)) continue;
      const entryFeeUsdt = TAKER * NOTIONAL;
      const qty = NOTIONAL / px;
      state.feesUsdt += entryFeeUsdt;
      const hold = {
        instId: s.instId,
        side,
        qty,
        entryPx: px,
        entryTs: nowIso(),
        notional: NOTIONAL,
        feeUsdt: entryFeeUsdt,
        entryFeeUsdt,
        predictedBps: s.predBps,
        lastRealizedBps: s.lastBps,
        meanFundingBps: s.mean8,
        expectedSettles: EXPECTED_SETTLES,
        settledCount: 0,
        projectedGrossFundingBps: s.economics.grossCaptureBps,
        projectedExecutionCostBps: s.economics.executionCostBps,
        projectedNetEdgeBps: s.economics.netEdgeBps,
        economicsGate: 'PASS',
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
  state.unitEconomicsPolicy = {
    version: 'funding_unit_economics_v2_target_settles',
    roundTripFeeBps: ROUND_TRIP_FEE_BPS,
    expectedSettles: EXPECTED_SETTLES,
    executionBufferBps: EXECUTION_BUFFER_BPS,
    minimumNetEdgeBps: MIN_NET_EDGE_BPS,
    ranking: 'PROJECTED_NET_EDGE_AFTER_COSTS',
    exitAfterTargetSettles: true,
    realizedExitUsesExecutableQuote: true,
    realizedPricePnlPersisted: true,
  };
  const names = state.holds.map((h) => `${h.instId.replace('-USDT-SWAP', '')} ${h.side}`).join(', ');
  const cobrado = Number(state.realizedFundingUsdt) || 0;
  const fees = Number(state.feesUsdt) || 0;
  if (names) {
    state.note = `paper hold ${names}. cobrado ${cobrado.toFixed(2)} USDT en ${state.settledCount} settles. a mercado ${state.mtmUsdt.toFixed(2)}. fees ${fees.toFixed(2)}. nuevos tickets exigen net edge post-costes y cierran tras ${EXPECTED_SETTLES} settles. live off. no es un GO.`;
  } else if (feeLocked) {
    state.note = `candado fees: cobrado ${cobrado.toFixed(2)} < fees ${fees.toFixed(2)}. sin ticket nuevo hasta que el cobro gane. live off. no es un GO.`;
  } else {
    state.note = 'sin hold paper. nuevos tickets exigen unit economics positivos. live off. no se inventa un cobro.';
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
      console.log(JSON.stringify({
        ts: s.ts,
        holds: s.holds.length,
        settled: s.settledCount,
        realized: s.realizedFundingUsdt,
        mtm: s.mtmUsdt,
        fees: s.feesUsdt,
        names: s.holds.map((h) => h.instId),
        liveOff: true,
        go: false,
      }));
    } catch (e) {
      console.error('fundingHold', e && e.message ? e.message : e);
    }
  };
  await loop();
  if (!args.once) setInterval(loop, 60_000);
}
