import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const VERSION = 'stat_arb_lab_v2_cross_asset_walkforward';
const BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const SYMBOLS = (process.env.GENESIS_STATARB_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,LINKUSDT').split(',').map((x) => x.trim()).filter(Boolean);
const INTERVALS = (process.env.GENESIS_STATARB_INTERVALS || '5m,15m,1h').split(',').map((x) => x.trim()).filter(Boolean);
const BARS = Math.max(1500, Math.min(5000, Number(process.env.GENESIS_STATARB_BARS || 3000)));
const ENTRY_Z = Number(process.env.GENESIS_STATARB_ENTRY_Z || 2);
const EXIT_Z = Number(process.env.GENESIS_STATARB_EXIT_Z || 0.5);
const MAX_HOLD = Number(process.env.GENESIS_STATARB_MAX_HOLD || 48);
const TOTAL_ROUND_TRIP_COST_BPS = Number(process.env.GENESIS_STATARB_TOTAL_COST_BPS || 20);
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'quant-evidence/stat-arb-lab-latest.json';
const round = (x, d = 4) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(d)) : null;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(symbol, interval, limit, endTime) {
  const q = new URLSearchParams({ symbol, interval, limit: String(limit) });
  if (endTime) q.set('endTime', String(endTime));
  const r = await fetch(`${BASE}/klines?${q}`, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`binance_${r.status}:${symbol}:${interval}`);
  return r.json();
}

async function history(symbol, interval) {
  const all = [];
  let end = Date.now();
  while (all.length < BARS) {
    const limit = Math.min(1000, BARS - all.length);
    const page = await fetchPage(symbol, interval, limit, end);
    if (!Array.isArray(page) || !page.length) break;
    all.unshift(...page);
    if (page.length < limit) break;
    end = Number(page[0][0]) - 1;
    await sleep(25);
  }
  const uniq = [...new Map(all.map((x) => [Number(x[0]), x])).values()].sort((a, b) => Number(a[0]) - Number(b[0])).slice(-BARS);
  if (uniq.length < 1200) throw new Error(`insufficient:${symbol}:${interval}:${uniq.length}`);
  return uniq.map((x) => ({ t: Number(x[0]), close: Number(x[4]) })).filter((x) => x.close > 0);
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
  const residualMean = mean(residuals), residualStd = std(residuals);
  let arNum = 0, arDen = 0;
  for (let i = 1; i < residuals.length; i++) { const prev = residuals[i - 1] - residualMean, now = residuals[i] - residualMean; arNum += prev * now; arDen += prev * prev; }
  const rho = arDen > 0 ? arNum / arDen : null;
  const halfLifeBars = rho > 0 && rho < 1 ? -Math.log(2) / Math.log(rho) : null;
  return { alpha, beta, residualMean, residualStd, rho, halfLifeBars };
}

function stats(trades) {
  const p = trades.map((x) => x.netBps), wins = p.filter((x) => x > 0), losses = p.filter((x) => x < 0);
  const gp = wins.reduce((s, x) => s + x, 0), gl = Math.abs(losses.reduce((s, x) => s + x, 0));
  const ev = mean(p), sd = std(p);
  let curve = 0, peak = 0, dd = 0;
  for (const x of p) { curve += x; peak = Math.max(peak, curve); dd = Math.max(dd, peak - curve); }
  return { trades: p.length, expectancyBps: round(ev, 4), profitFactor: gl > 0 ? round(gp / gl, 4) : (gp > 0 ? 99 : null), tStat: ev != null && sd > 0 ? round(ev / (sd / Math.sqrt(p.length)), 4) : null, maxDrawdownPct: round(dd / 100, 4), totalNetBps: round(p.reduce((s, x) => s + x, 0), 4) };
}

function simulate(rows, model) {
  if (!(model.residualStd > 0)) return [];
  const residual = rows.map((x) => x.a - model.alpha - model.beta * x.b);
  const z = residual.map((r) => (r - model.residualMean) / model.residualStd);
  const trades = [];
  const betaAbs = Math.abs(model.beta), wA = 1 / (1 + betaAbs), wB = betaAbs / (1 + betaAbs);
  let i = 0;
  while (i < rows.length - 2) {
    const zi = z[i];
    if (!Number.isFinite(zi) || Math.abs(zi) < ENTRY_Z) { i++; continue; }
    const side = zi > 0 ? 'SHORT_SPREAD' : 'LONG_SPREAD', entry = rows[i];
    let exitIndex = Math.min(rows.length - 1, i + MAX_HOLD);
    for (let j = i + 1; j <= exitIndex; j++) if (Number.isFinite(z[j]) && Math.abs(z[j]) <= EXIT_Z) { exitIndex = j; break; }
    const exit = rows[exitIndex], dA = exit.a - entry.a, dB = exit.b - entry.b;
    const gross = side === 'SHORT_SPREAD' ? (-dA * wA + dB * wB) : (dA * wA - dB * wB);
    const grossBps = gross * 10_000, netBps = grossBps - TOTAL_ROUND_TRIP_COST_BPS;
    trades.push({ entryTime: entry.t, exitTime: exit.t, side, entryZ: round(zi, 3), exitZ: round(z[exitIndex], 3), grossBps: round(grossBps, 4), costBps: TOTAL_ROUND_TRIP_COST_BPS, netBps: round(netBps, 4), holdBars: exitIndex - i });
    i = Math.max(i + 1, exitIndex + 1);
  }
  return trades;
}

function passesOos(validation, holdout, model) {
  return validation.trades >= 8 && holdout.trades >= 8
    && (validation.expectancyBps ?? -Infinity) > 0 && (holdout.expectancyBps ?? -Infinity) > 0
    && (validation.profitFactor ?? 0) >= 1.05 && (holdout.profitFactor ?? 0) >= 1.10
    && (holdout.tStat ?? -Infinity) >= 0.75 && holdout.maxDrawdownPct <= 12
    && model.halfLifeBars != null && model.halfLifeBars > 0 && model.halfLifeBars <= MAX_HOLD * 2;
}

async function main() {
  const data = new Map();
  for (const interval of INTERVALS) for (const symbol of SYMBOLS) data.set(`${symbol}:${interval}`, await history(symbol, interval));
  const candidates = [];
  for (const interval of INTERVALS) {
    for (let i = 0; i < SYMBOLS.length; i++) for (let j = i + 1; j < SYMBOLS.length; j++) {
      const aSymbol = SYMBOLS[i], bSymbol = SYMBOLS[j];
      const rows = align(data.get(`${aSymbol}:${interval}`), data.get(`${bSymbol}:${interval}`));
      const trainCut = Math.floor(rows.length * 0.60), validCut = Math.floor(rows.length * 0.80);
      const trainRows = rows.slice(0, trainCut), validRows = rows.slice(trainCut, validCut), holdRows = rows.slice(validCut);
      const model = regress(trainRows);
      if (!(model.residualStd > 0) || !Number.isFinite(model.beta)) continue;
      const validationTrades = simulate(validRows, model), holdoutTrades = simulate(holdRows, model);
      const validation = stats(validationTrades), holdout = stats(holdoutTrades);
      const passed = passesOos(validation, holdout, model);
      const oosTrades = validation.trades + holdout.trades;
      const evidenceQuality = passed ? Math.min(0.95, 0.70 + Math.min(oosTrades, 60) / 240) : Math.min(0.65, 0.45 + Math.min(oosTrades, 40) / 200);
      candidates.push({
        pair: `${aSymbol}/${bSymbol}`, interval, beta: round(model.beta, 5), rho: round(model.rho, 5), halfLifeBars: round(model.halfLifeBars, 2),
        entryZ: ENTRY_Z, exitZ: EXIT_Z, maxHoldBars: MAX_HOLD, totalRoundTripCostBps: TOTAL_ROUND_TRIP_COST_BPS,
        validation, holdout, oosTrades, passedOos: passed, evidenceQuality: round(evidenceQuality, 4),
        evidenceStatus: passed ? 'OOS_GATE_PASS' : 'OOS_GATE_FAIL', recentHoldoutTrades: holdoutTrades.slice(-5),
      });
    }
  }
  candidates.sort((a, b) => Number(b.passedOos) - Number(a.passedOos) || (b.holdout.expectancyBps ?? -Infinity) - (a.holdout.expectancyBps ?? -Infinity));
  const best = candidates[0] ?? null;
  const output = {
    ok: true, version: VERSION, generatedAt: new Date().toISOString(), mode: 'RESEARCH_ONLY', paperOnly: true, liveOrders: false, executionAuthority: false, liveLocked: true,
    methodology: { source: 'Binance public klines', symbols: SYMBOLS, intervals: INTERVALS, barsPerSeries: BARS, split: '60% train / 20% validation / 20% holdout', entryZ: ENTRY_Z, exitZ: EXIT_Z, maxHoldBars: MAX_HOLD, totalRoundTripCostBps: TOTAL_ROUND_TRIP_COST_BPS, model: 'train-only OLS log-price residual + mean-reversion half-life; validation and holdout never refit' },
    testedCandidates: candidates.length, oosPassCount: candidates.filter((x) => x.passedOos).length, candidates: candidates.slice(0, 25), best,
    sleeve: best ? { sleeveKey: 'STAT_ARB', engineVersion: VERSION, samples: best.oosTrades, expectancyBps: best.holdout.expectancyBps, profitFactor: best.holdout.profitFactor, tStat: best.holdout.tStat, maxDrawdownPct: best.holdout.maxDrawdownPct, evidenceQuality: best.evidenceQuality, paperCapitalEligible: best.passedOos === true } : null,
    invariants: { signsTransactions: false, broadcastsTransactions: false, unlocksLive: false },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ version: VERSION, testedCandidates: output.testedCandidates, oosPassCount: output.oosPassCount, best: best ? { pair: best.pair, interval: best.interval, validation: best.validation, holdout: best.holdout, oosTrades: best.oosTrades, passedOos: best.passedOos } : null }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
