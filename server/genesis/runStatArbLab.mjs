import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const VERSION = 'stat_arb_lab_v1';
const BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const PAIRS = [['SOLUSDT', 'ETHUSDT'], ['ETHUSDT', 'BTCUSDT'], ['SOLUSDT', 'BTCUSDT']];
const INTERVAL = process.env.GENESIS_STATARB_INTERVAL || '15m';
const BARS = Math.max(500, Math.min(1000, Number(process.env.GENESIS_STATARB_BARS || 1000)));
const ENTRY_Z = Number(process.env.GENESIS_STATARB_ENTRY_Z || 2);
const EXIT_Z = Number(process.env.GENESIS_STATARB_EXIT_Z || 0.5);
const MAX_HOLD = Number(process.env.GENESIS_STATARB_MAX_HOLD || 48);
const TOTAL_ROUND_TRIP_COST_BPS = Number(process.env.GENESIS_STATARB_TOTAL_COST_BPS || 20);
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'quant-evidence/stat-arb-lab-latest.json';
const round = (x, d = 4) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(d)) : null;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

async function history(symbol) {
  const r = await fetch(`${BASE}/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(INTERVAL)}&limit=${BARS}`, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`binance_${r.status}:${symbol}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length < 400) throw new Error(`insufficient:${symbol}`);
  return rows.map((x) => ({ t: Number(x[0]), close: Number(x[4]) })).filter((x) => x.close > 0);
}

function align(a, b) {
  const bm = new Map(b.map((x) => [x.t, x.close]));
  return a.filter((x) => bm.has(x.t)).map((x) => ({ t: x.t, a: Math.log(x.close), b: Math.log(bm.get(x.t)) }));
}

function regress(rows) {
  const xb = rows.map((x) => x.b), ya = rows.map((x) => x.a), mx = mean(xb), my = mean(ya);
  let cov = 0, variance = 0;
  for (let i = 0; i < rows.length; i++) { cov += (xb[i] - mx) * (ya[i] - my); variance += (xb[i] - mx) ** 2; }
  const beta = variance > 0 ? cov / variance : 0;
  const alpha = my - beta * mx;
  const residuals = rows.map((x) => x.a - alpha - beta * x.b);
  return { alpha, beta, residualMean: mean(residuals), residualStd: std(residuals) };
}

function stats(trades) {
  const p = trades.map((x) => x.netBps), wins = p.filter((x) => x > 0), losses = p.filter((x) => x < 0);
  const gp = wins.reduce((s, x) => s + x, 0), gl = Math.abs(losses.reduce((s, x) => s + x, 0));
  const ev = mean(p), sd = std(p);
  let curve = 0, peak = 0, dd = 0;
  for (const x of p) { curve += x; peak = Math.max(peak, curve); dd = Math.max(dd, peak - curve); }
  return { trades: p.length, samples: p.length, expectancyBps: round(ev, 4), profitFactor: gl > 0 ? round(gp / gl, 4) : (gp > 0 ? 99 : null), tStat: ev != null && sd > 0 ? round(ev / (sd / Math.sqrt(p.length)), 4) : null, maxDrawdownPct: round(dd / 100, 4) };
}

function simulate(rows, model) {
  const residual = rows.map((x) => x.a - model.alpha - model.beta * x.b);
  const z = residual.map((r) => (r - model.residualMean) / model.residualStd);
  const trades = [];
  const betaAbs = Math.abs(model.beta);
  const wA = 1 / (1 + betaAbs), wB = betaAbs / (1 + betaAbs);
  let i = 0;
  while (i < rows.length - 2) {
    const zi = z[i];
    if (!Number.isFinite(zi) || Math.abs(zi) < ENTRY_Z) { i++; continue; }
    const side = zi > 0 ? 'SHORT_SPREAD' : 'LONG_SPREAD';
    const entry = rows[i];
    let exitIndex = Math.min(rows.length - 1, i + MAX_HOLD);
    for (let j = i + 1; j <= exitIndex; j++) { if (Number.isFinite(z[j]) && Math.abs(z[j]) <= EXIT_Z) { exitIndex = j; break; } }
    const exit = rows[exitIndex];
    const dA = exit.a - entry.a, dB = exit.b - entry.b;
    const gross = side === 'SHORT_SPREAD' ? (-dA * wA + dB * wB) : (dA * wA - dB * wB);
    const grossBps = gross * 10_000;
    const netBps = grossBps - TOTAL_ROUND_TRIP_COST_BPS;
    trades.push({ entryTime: entry.t, exitTime: exit.t, side, entryZ: round(zi, 3), exitZ: round(z[exitIndex], 3), grossBps: round(grossBps, 4), costBps: TOTAL_ROUND_TRIP_COST_BPS, netBps: round(netBps, 4), holdBars: exitIndex - i });
    i = Math.max(i + 1, exitIndex + 1);
  }
  return trades;
}

async function main() {
  const symbols = [...new Set(PAIRS.flat())];
  const data = new Map(await Promise.all(symbols.map(async (s) => [s, await history(s)])));
  const candidates = [];
  for (const [aSymbol, bSymbol] of PAIRS) {
    const rows = align(data.get(aSymbol), data.get(bSymbol));
    const cut = Math.floor(rows.length * 0.70);
    const train = rows.slice(0, cut), holdout = rows.slice(cut);
    const model = regress(train);
    if (!(model.residualStd > 0) || !Number.isFinite(model.beta)) continue;
    const trades = simulate(holdout, model);
    const m = stats(trades);
    const evidenceQuality = Math.min(0.9, 0.55 + Math.min(m.trades, 50) / 150);
    candidates.push({ pair: `${aSymbol}/${bSymbol}`, interval: INTERVAL, beta: round(model.beta, 5), entryZ: ENTRY_Z, exitZ: EXIT_Z, maxHoldBars: MAX_HOLD, totalRoundTripCostBps: TOTAL_ROUND_TRIP_COST_BPS, ...m, evidenceQuality: round(evidenceQuality, 4), evidenceStatus: m.trades >= 20 ? 'HOLDOUT_SAMPLE_AVAILABLE' : 'HOLDOUT_SAMPLE_SMALL', recentTrades: trades.slice(-10) });
  }
  candidates.sort((a, b) => (b.expectancyBps ?? -Infinity) - (a.expectancyBps ?? -Infinity));
  const best = candidates[0] ?? null;
  const output = {
    ok: true, version: VERSION, generatedAt: new Date().toISOString(), mode: 'RESEARCH_ONLY', paperOnly: true,
    liveOrders: false, executionAuthority: false, liveLocked: true,
    methodology: { source: 'Binance public klines', interval: INTERVAL, bars: BARS, trainFraction: 0.70, pairs: PAIRS.map((x) => x.join('/')), entryZ: ENTRY_Z, exitZ: EXIT_Z, maxHoldBars: MAX_HOLD, totalRoundTripCostBps: TOTAL_ROUND_TRIP_COST_BPS, model: 'OLS log-price residual; holdout-only pair-trade simulation' },
    candidates, best,
    sleeve: best ? { sleeveKey: 'STAT_ARB', engineVersion: VERSION, samples: best.samples, expectancyBps: best.expectancyBps, profitFactor: best.profitFactor, tStat: best.tStat, maxDrawdownPct: best.maxDrawdownPct, evidenceQuality: best.evidenceQuality, paperCapitalEligible: best.trades >= 20 } : null,
    invariants: { signsTransactions: false, broadcastsTransactions: false, unlocksLive: false },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ version: VERSION, best: best ? { pair: best.pair, trades: best.trades, expectancyBps: best.expectancyBps, profitFactor: best.profitFactor } : null }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
