import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const VERSION = 'profitability_sprint_v1';
const SOURCE = 'binance_public_spot_reference';
const BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const MAX_BARS = Number(process.env.GENESIS_SPRINT_BARS || 6000);
const PAGE_LIMIT = 1000;
const FEE_PER_SIDE = 0.0004;
const SLIPPAGE_PER_SIDE = 0.00015;
const FUNDING_8H = 0.0001;
const TRAIN_END = 0.60;
const VALID_END = 0.80;
const MIN_TRAIN = 30;
const MIN_VALID = 12;
const MIN_HOLDOUT = 12;

const MARKETS = [
  { pair: 'BTCUSDT', tf: '15m' },
  { pair: 'ETHUSDT', tf: '15m' },
  { pair: 'SOLUSDT', tf: '15m' },
  { pair: 'BTCUSDT', tf: '1h' },
  { pair: 'ETHUSDT', tf: '1h' },
  { pair: 'SOLUSDT', tf: '1h' },
  { pair: 'BNBUSDT', tf: '1h' },
  { pair: 'XRPUSDT', tf: '1h' },
];

const FAMILIES = [
  { id: 'breakout', periods: [12, 20, 34, 55], targets: [1.5, 2.0], stops: [0.75, 1.0], timeouts: [8, 16] },
  { id: 'momentum', periods: [12, 20, 34], targets: [1.5, 2.0], stops: [0.75, 1.0], timeouts: [8, 16] },
  { id: 'mean_reversion', periods: [20, 34, 55], targets: [1.0, 1.5], stops: [1.0, 1.5], timeouts: [8, 16] },
];

const round = (v, d = 6) => Number.isFinite(v) ? Number(v.toFixed(d)) : null;
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const tfMinutes = tf => { const m = /^(\d+)([mhd])$/.exec(tf); if (!m) return 60; const n = Number(m[1]); return m[2] === 'm' ? n : m[2] === 'h' ? n * 60 : n * 1440; };

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? fallback : fallback;
}

async function fetchHistory(pair, tf, maxBars = MAX_BARS) {
  const all = [];
  let endTime = Date.now();
  while (all.length < maxBars) {
    const limit = Math.min(PAGE_LIMIT, maxBars - all.length);
    const url = `${BASE}/klines?symbol=${encodeURIComponent(pair)}&interval=${encodeURIComponent(tf)}&limit=${limit}&endTime=${endTime}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`binance_${res.status}:${pair}:${tf}`);
    const page = await res.json();
    if (!Array.isArray(page) || !page.length) break;
    all.unshift(...page);
    const first = Number(page[0]?.[0]);
    if (!Number.isFinite(first) || page.length < limit) break;
    endTime = first - 1;
    await new Promise(r => setTimeout(r, 60));
  }
  const dedup = [...new Map(all.map(r => [Number(r?.[0]), r])).values()].sort((a, b) => Number(a[0]) - Number(b[0]));
  if (dedup.length < 1000) throw new Error(`insufficient_history:${pair}:${tf}:${dedup.length}`);
  return dedup.slice(-maxBars);
}

function atrPct(rows, i, period = 14) {
  if (i < period + 1) return null;
  let sum = 0;
  for (let j = i - period + 1; j <= i; j++) {
    const h = Number(rows[j]?.[2]), l = Number(rows[j]?.[3]), pc = Number(rows[j - 1]?.[4]);
    if (![h, l, pc].every(Number.isFinite)) return null;
    sum += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  const c = Number(rows[i]?.[4]);
  return c > 0 ? (sum / period) / c : null;
}

function sma(closes, i, p) {
  if (i < p - 1) return null;
  let s = 0;
  for (let j = i - p + 1; j <= i; j++) s += closes[j];
  return s / p;
}

function windowStd(closes, i, p) {
  if (i < p - 1) return null;
  return std(closes.slice(i - p + 1, i + 1));
}

function signalFor(family, rows, closes, i, p) {
  if (i < Math.max(60, p + 2)) return null;
  const c = closes[i], prev = closes[i - 1];
  const ma = sma(closes, i, p), ma55 = sma(closes, i, 55);
  if (![c, prev, ma, ma55].every(Number.isFinite)) return null;
  if (family === 'breakout') {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - p; j < i; j++) { hi = Math.max(hi, closes[j]); lo = Math.min(lo, closes[j]); }
    if (c > hi && c > ma55) return 'LONG';
    if (c < lo && c < ma55) return 'SHORT';
    return null;
  }
  if (family === 'momentum') {
    const fast = sma(closes, i, Math.max(4, Math.round(p / 3)));
    const fastPrev = sma(closes, i - 1, Math.max(4, Math.round(p / 3)));
    const slowPrev = sma(closes, i - 1, p);
    if (![fast, fastPrev, slowPrev].every(Number.isFinite)) return null;
    if (fastPrev <= slowPrev && fast > ma && c > ma55) return 'LONG';
    if (fastPrev >= slowPrev && fast < ma && c < ma55) return 'SHORT';
    return null;
  }
  if (family === 'mean_reversion') {
    const sd = windowStd(closes, i, p);
    if (!Number.isFinite(sd) || sd <= 0) return null;
    const z = (c - ma) / sd;
    if (z <= -2 && c > ma55 * 0.97) return 'LONG';
    if (z >= 2 && c < ma55 * 1.03) return 'SHORT';
  }
  return null;
}

function simulate(rows, market, candidate) {
  const closes = rows.map(r => Number(r?.[4]));
  const minutes = tfMinutes(market.tf);
  const trades = [];
  let lastExit = -1;
  for (let i = 60; i < rows.length - 2; i++) {
    if (i <= lastExit) continue;
    const side = signalFor(candidate.family, rows, closes, i, candidate.period);
    if (!side) continue;
    const a = atrPct(rows, i);
    if (!Number.isFinite(a) || a <= 0) continue;
    const entryIndex = i + 1;
    const rawEntry = Number(rows[entryIndex]?.[1]);
    if (!Number.isFinite(rawEntry) || rawEntry <= 0) continue;
    const entry = side === 'LONG' ? rawEntry * (1 + SLIPPAGE_PER_SIDE) : rawEntry * (1 - SLIPPAGE_PER_SIDE);
    const targetPct = Math.max(0.0008, a * candidate.targetAtr);
    const stopPct = Math.max(0.0008, a * candidate.stopAtr);
    const maxBars = candidate.timeoutBars;
    const target = side === 'LONG' ? entry * (1 + targetPct) : entry * (1 - targetPct);
    const stop = side === 'LONG' ? entry * (1 - stopPct) : entry * (1 + stopPct);
    let exitIndex = Math.min(rows.length - 1, entryIndex + maxBars);
    let rawExit = Number(rows[exitIndex]?.[4]);
    let reason = 'timeout';
    for (let j = entryIndex; j <= exitIndex; j++) {
      const h = Number(rows[j]?.[2]), l = Number(rows[j]?.[3]);
      if (![h, l].every(Number.isFinite)) continue;
      const stopHit = side === 'LONG' ? l <= stop : h >= stop;
      const targetHit = side === 'LONG' ? h >= target : l <= target;
      if (stopHit) { exitIndex = j; rawExit = stop; reason = 'stop'; break; }
      if (targetHit) { exitIndex = j; rawExit = target; reason = 'target'; break; }
    }
    if (!Number.isFinite(rawExit) || rawExit <= 0) continue;
    const exit = side === 'LONG' ? rawExit * (1 - SLIPPAGE_PER_SIDE) : rawExit * (1 + SLIPPAGE_PER_SIDE);
    const grossPct = side === 'LONG' ? (exit - entry) / entry : (entry - exit) / entry;
    const heldHours = Math.max(minutes / 60, (exitIndex - entryIndex + 1) * minutes / 60);
    const costsPct = (FEE_PER_SIDE * 2) + (FUNDING_8H * heldHours / 8);
    const netPct = grossPct - costsPct;
    trades.push({ pair: market.pair, tf: market.tf, side, openedAt: Number(rows[entryIndex]?.[0]), closedAt: Number(rows[exitIndex]?.[6] ?? rows[exitIndex]?.[0]), relativeIndex: entryIndex / rows.length, netPct, reason });
    lastExit = exitIndex;
  }
  return trades;
}

function metrics(trades) {
  const p = trades.map(t => t.netPct);
  const wins = p.filter(x => x > 0), losses = p.filter(x => x < 0);
  const gp = wins.reduce((s, x) => s + x, 0), gl = Math.abs(losses.reduce((s, x) => s + x, 0));
  const expectancy = p.length ? mean(p) : null;
  const sd = std(p);
  const tStat = p.length >= 2 && sd > 0 && expectancy != null ? expectancy / (sd / Math.sqrt(p.length)) : null;
  let curve = 0, peak = 0, dd = 0;
  for (const x of p) { curve += x; peak = Math.max(peak, curve); dd = Math.max(dd, peak - curve); }
  return {
    trades: p.length,
    winRate: p.length ? round(wins.length / p.length, 4) : null,
    netReturnPct: round(p.reduce((s, x) => s + x, 0) * 100, 4),
    expectancyBps: expectancy == null ? null : round(expectancy * 10000, 3),
    profitFactor: gl > 0 ? round(gp / gl, 4) : null,
    tStat: round(tStat, 4),
    maxDrawdownPct: round(dd * 100, 4),
  };
}

function walkForward(trades) {
  const folds = [[0.0,0.2],[0.2,0.4],[0.4,0.6],[0.6,0.8]].map(([s,e], i) => {
    const m = metrics(trades.filter(t => t.relativeIndex >= s && t.relativeIndex < e));
    const pass = m.trades >= 6 && (m.expectancyBps ?? -Infinity) > 0 && (m.profitFactor ?? 0) >= 1.0;
    return { fold: i + 1, range: [s,e], pass, ...m };
  });
  return { positiveFolds: folds.filter(f => f.pass).length, requiredPositiveFolds: 3, pass: folds.filter(f => f.pass).length >= 3, folds };
}

function qualifies(train, valid, holdout, wf) {
  return train.trades >= MIN_TRAIN && valid.trades >= MIN_VALID && holdout.trades >= MIN_HOLDOUT &&
    (train.expectancyBps ?? -Infinity) > 0 && (valid.expectancyBps ?? -Infinity) > 0 && (holdout.expectancyBps ?? -Infinity) > 0 &&
    (valid.profitFactor ?? 0) >= 1.15 && (holdout.profitFactor ?? 0) >= 1.10 &&
    (holdout.tStat ?? -Infinity) >= 0.75 && holdout.maxDrawdownPct <= 12 && wf.pass;
}

function score(valid, holdout, wf) {
  if (!qualifies({ trades: 999, expectancyBps: 1 }, valid, holdout, wf)) return -1e9;
  return round((valid.expectancyBps ?? 0) + (holdout.expectancyBps ?? 0) + 10 * ((holdout.profitFactor ?? 0) - 1) + 2 * wf.positiveFolds - (holdout.maxDrawdownPct ?? 0), 4);
}

function grid() {
  const out = [];
  for (const family of FAMILIES) for (const period of family.periods) for (const targetAtr of family.targets) for (const stopAtr of family.stops) for (const timeoutBars of family.timeouts) out.push({ family: family.id, period, targetAtr, stopAtr, timeoutBars });
  return out;
}

async function main() {
  const startedAt = new Date().toISOString();
  const outPath = arg('--out', 'quant-evidence/profitability-sprint-latest.json');
  const historyPath = arg('--history', null);
  const datasets = {};
  for (const market of MARKETS) {
    const key = `${market.pair}:${market.tf}`;
    const rows = await fetchHistory(market.pair, market.tf);
    datasets[key] = { market, rows, coverage: { bars: rows.length, startAt: new Date(Number(rows[0][0])).toISOString(), endAt: new Date(Number(rows.at(-1)[6] ?? rows.at(-1)[0])).toISOString() } };
  }

  const candidates = [];
  for (const candidate of grid()) {
    let allTrades = [];
    for (const { market, rows } of Object.values(datasets)) allTrades = allTrades.concat(simulate(rows, market, candidate));
    const train = metrics(allTrades.filter(t => t.relativeIndex < TRAIN_END));
    const validation = metrics(allTrades.filter(t => t.relativeIndex >= TRAIN_END && t.relativeIndex < VALID_END));
    const holdout = metrics(allTrades.filter(t => t.relativeIndex >= VALID_END));
    const wf = walkForward(allTrades);
    const pass = qualifies(train, validation, holdout, wf);
    candidates.push({ id: `${candidate.family}:p${candidate.period}:ta${candidate.targetAtr}:sa${candidate.stopAtr}:tb${candidate.timeoutBars}`, params: candidate, pass, score: pass ? score(validation, holdout, wf) : -1e9, train, validation, holdout, walkForward: wf });
  }
  candidates.sort((a,b) => b.score - a.score || (b.holdout.expectancyBps ?? -Infinity) - (a.holdout.expectancyBps ?? -Infinity));
  const survivors = candidates.filter(c => c.pass);
  const snapshot = {
    ok: true,
    version: VERSION,
    mode: 'RESEARCH_ONLY',
    source: SOURCE,
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    startedAt,
    completedAt: new Date().toISOString(),
    methodology: {
      barsPerMarketTarget: MAX_BARS,
      train: 'first_60pct', validation: 'next_20pct', finalHoldout: 'last_20pct', holdoutUsedForRanking: false,
      costs: { takerFeePerSide: FEE_PER_SIDE, slippagePerSide: SLIPPAGE_PER_SIDE, funding8h: FUNDING_8H },
      gates: { minTrainTrades: MIN_TRAIN, minValidationTrades: MIN_VALID, minHoldoutTrades: MIN_HOLDOUT, validationProfitFactor: 1.15, holdoutProfitFactor: 1.10, holdoutTStat: 0.75, maxHoldoutDrawdownPct: 12, walkForwardPositiveFolds: '3/4' },
    },
    coverage: Object.fromEntries(Object.entries(datasets).map(([k,v]) => [k, v.coverage])),
    candidateCount: candidates.length,
    survivorCount: survivors.length,
    verdict: survivors.length ? 'PAPER_CANDIDATE_FOUND' : 'NO_EDGE_FOUND',
    topCandidates: candidates.slice(0, 20),
    survivors: survivors.slice(0, 10),
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  if (historyPath) {
    await mkdir(dirname(historyPath), { recursive: true });
    await appendFile(historyPath, `${JSON.stringify({ ts: snapshot.completedAt, version: VERSION, verdict: snapshot.verdict, survivorCount: snapshot.survivorCount, top: snapshot.topCandidates.slice(0,3).map(c => ({ id:c.id, pass:c.pass, score:c.score, holdout:c.holdout })) })}\n`, 'utf8');
  }
  console.log(JSON.stringify({ ok: true, version: VERSION, verdict: snapshot.verdict, survivorCount: snapshot.survivorCount, candidateCount: snapshot.candidateCount, paperOnly: true, liveOrders: false, executionAuthority: false }));
}

main().catch(err => { console.error(`[profitability-sprint] ${err instanceof Error ? err.stack || err.message : String(err)}`); process.exitCode = 1; });
