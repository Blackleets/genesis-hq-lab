import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const VERSION = 'funding_carry_lab_v2_causal_spot_close_oos';
const FUTURES_BASE = process.env.BINANCE_FUTURES_BASE || 'https://fapi.binance.com';
const SPOT_BASE = process.env.BINANCE_SPOT_BASE || 'https://data-api.binance.vision/api/v3';
const SYMBOLS = (process.env.GENESIS_FUNDING_SYMBOLS || 'BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT,XRPUSDT,DOGEUSDT,LINKUSDT').split(',').map((x) => x.trim()).filter(Boolean);
const FUNDING_LIMIT = Math.max(120, Math.min(1000, Number(process.env.GENESIS_FUNDING_HISTORY_LIMIT || 400)));
const SPOT_BAR_LIMIT = Math.max(1200, Math.min(5000, Number(process.env.GENESIS_FUNDING_SPOT_BARS || 3500)));
const SIGNAL_LOOKBACK = Math.max(2, Number(process.env.GENESIS_FUNDING_SIGNAL_LOOKBACK || 3));
const MIN_TRAILING_FUNDING_BPS = Number(process.env.GENESIS_MIN_TRAILING_FUNDING_BPS || 0.25);
const HOLD_HORIZONS = (process.env.GENESIS_FUNDING_HORIZONS || '3,6,12').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0);
const SPOT_TAKER_BPS_PER_SIDE = Number(process.env.GENESIS_FUNDING_SPOT_TAKER_BPS || 10);
const PERP_TAKER_BPS_PER_SIDE = Number(process.env.GENESIS_FUNDING_PERP_TAKER_BPS || 5);
const SLIPPAGE_RESERVE_BPS = Number(process.env.GENESIS_FUNDING_SLIPPAGE_RESERVE_BPS || 4);
const ROUND_TRIP_COST_BPS = 2 * (SPOT_TAKER_BPS_PER_SIDE + PERP_TAKER_BPS_PER_SIDE) + SLIPPAGE_RESERVE_BPS;
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'quant-evidence/funding-carry-lab-latest.json';

const HOUR_MS = 60 * 60 * 1000;
const round = (x, d = 4) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(d)) : null;
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`http_${response.status}:${url}:${body.slice(0, 100)}`);
  }
  return response.json();
}

async function fundingHistory(symbol) {
  const q = new URLSearchParams({ symbol, limit: String(FUNDING_LIMIT) });
  const rows = await fetchJson(`${FUTURES_BASE}/fapi/v1/fundingRate?${q}`);
  if (!Array.isArray(rows)) throw new Error(`invalid_funding:${symbol}`);
  return rows
    .map((row) => ({
      t: Number(row.fundingTime),
      rate: Number(row.fundingRate),
      rateBps: Number(row.fundingRate) * 10_000,
      perp: Number(row.markPrice),
    }))
    .filter((row) => Number.isFinite(row.t) && row.t > 0 && Number.isFinite(row.rate) && row.perp > 0)
    .sort((a, b) => a.t - b.t);
}

export function spotRowsFromKlines(rows = []) {
  return rows.map((row) => {
    const openTime = Number(row?.[0]);
    const close = Number(row?.[4]);
    const closeTime = Number(row?.[6]);
    if (!Number.isFinite(openTime) || !Number.isFinite(closeTime) || closeTime <= openTime || !(close > 0)) return null;
    return { t: closeTime, close, openTime };
  }).filter(Boolean).sort((a, b) => a.t - b.t);
}

async function spotHistory(symbol) {
  const all = [];
  let endTime = Date.now();
  while (all.length < SPOT_BAR_LIMIT) {
    const limit = Math.min(1000, SPOT_BAR_LIMIT - all.length);
    const q = new URLSearchParams({ symbol, interval: '1h', limit: String(limit), endTime: String(endTime) });
    const page = await fetchJson(`${SPOT_BASE}/klines?${q}`);
    if (!Array.isArray(page) || !page.length) break;
    all.unshift(...page);
    if (page.length < limit) break;
    endTime = Number(page[0][0]) - 1;
    await sleep(25);
  }
  const unique = [...new Map(all.map((row) => [Number(row[0]), row])).values()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(-SPOT_BAR_LIMIT);
  return spotRowsFromKlines(unique);
}

export function nearestSpot(spots, t) {
  if (!spots.length) return null;
  let lo = 0, hi = spots.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (spots[mid].t <= t) { best = spots[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  if (!best || t - best.t > 2 * HOUR_MS) return null;
  return best.close;
}

export function align(funding, spots) {
  return funding.map((row) => ({ ...row, spot: nearestSpot(spots, row.t) })).filter((row) => row.spot > 0);
}

function tradeStats(trades) {
  const pnl = trades.map((x) => x.netBps).filter(Number.isFinite);
  const wins = pnl.filter((x) => x > 0), losses = pnl.filter((x) => x < 0);
  const gp = wins.reduce((s, x) => s + x, 0), gl = Math.abs(losses.reduce((s, x) => s + x, 0));
  const ev = mean(pnl), sd = std(pnl);
  let curve = 0, peak = 0, maxDdBps = 0;
  for (const x of pnl) { curve += x; peak = Math.max(peak, curve); maxDdBps = Math.max(maxDdBps, peak - curve); }
  return {
    trades: pnl.length,
    samples: pnl.length,
    expectancyBps: round(ev, 4),
    profitFactor: gl > 0 ? round(gp / gl, 4) : (gp > 0 ? 99 : null),
    tStat: ev != null && sd > 0 ? round(ev / (sd / Math.sqrt(pnl.length)), 4) : null,
    winRate: pnl.length ? round(wins.length / pnl.length, 4) : null,
    maxDrawdownPct: round(maxDdBps / 100, 4),
    totalNetBps: round(pnl.reduce((s, x) => s + x, 0), 4),
  };
}

function simulate(rows, horizon, start = 0, end = rows.length) {
  const trades = [];
  let i = Math.max(start + SIGNAL_LOOKBACK, SIGNAL_LOOKBACK);
  while (i + horizon < end) {
    const signalWindow = rows.slice(i - SIGNAL_LOOKBACK, i);
    const trailingFundingBps = mean(signalWindow.map((x) => x.rateBps));
    const current = rows[i];
    // Direction is deliberately one-sided: positive/persistent funding only.
    // Negative funding would require spot borrowing; borrow cost is not assumed free.
    if (!(trailingFundingBps > MIN_TRAILING_FUNDING_BPS && current.rateBps > 0)) { i++; continue; }
    const exitIndex = i + horizon;
    const exit = rows[exitIndex];
    const fundingReceivedBps = rows.slice(i + 1, exitIndex + 1).reduce((sum, x) => sum + x.rateBps, 0);
    const spotReturnBps = Math.log(exit.spot / current.spot) * 10_000;
    const shortPerpReturnBps = -Math.log(exit.perp / current.perp) * 10_000;
    const basisPnlBps = spotReturnBps + shortPerpReturnBps;
    const grossBps = basisPnlBps + fundingReceivedBps;
    const netBps = grossBps - ROUND_TRIP_COST_BPS;
    trades.push({
      entryTime: current.t,
      exitTime: exit.t,
      horizonFundingEvents: horizon,
      trailingFundingSignalBps: round(trailingFundingBps, 4),
      fundingReceivedBps: round(fundingReceivedBps, 4),
      spotReturnBps: round(spotReturnBps, 4),
      shortPerpReturnBps: round(shortPerpReturnBps, 4),
      basisPnlBps: round(basisPnlBps, 4),
      grossBps: round(grossBps, 4),
      roundTripCostBps: round(ROUND_TRIP_COST_BPS, 4),
      netBps: round(netBps, 4),
    });
    i = exitIndex + 1;
  }
  return trades;
}

function chooseTrainHorizon(rows, trainEnd) {
  const ranked = HOLD_HORIZONS.map((horizon) => {
    const trades = simulate(rows, horizon, 0, trainEnd);
    const stats = tradeStats(trades);
    const score = stats.trades >= 8 && stats.expectancyBps != null ? stats.expectancyBps * Math.sqrt(stats.trades) : -Infinity;
    return { horizon, stats, score };
  }).sort((a, b) => b.score - a.score);
  return ranked[0] ?? null;
}

function passesOos(validation, holdout) {
  return validation.trades >= 8 && holdout.trades >= 8
    && (validation.expectancyBps ?? -Infinity) > 0 && (holdout.expectancyBps ?? -Infinity) > 0
    && (validation.profitFactor ?? 0) >= 1.05 && (holdout.profitFactor ?? 0) >= 1.10
    && (holdout.tStat ?? -Infinity) >= 0.75
    && (holdout.maxDrawdownPct ?? Infinity) <= 12;
}

async function evaluateSymbol(symbol) {
  const [funding, spots] = await Promise.all([fundingHistory(symbol), spotHistory(symbol)]);
  const rows = align(funding, spots);
  if (rows.length < 100) throw new Error(`insufficient_aligned_history:${symbol}:${rows.length}`);
  const trainEnd = Math.floor(rows.length * 0.60);
  const validEnd = Math.floor(rows.length * 0.80);
  const selected = chooseTrainHorizon(rows, trainEnd);
  if (!selected || !Number.isFinite(selected.score)) {
    return { symbol, alignedFundingEvents: rows.length, selectedHorizon: selected?.horizon ?? null, train: selected?.stats ?? tradeStats([]), validation: tradeStats([]), holdout: tradeStats([]), passedOos: false, evidenceQuality: 0.35, evidenceStatus: 'TRAIN_SAMPLE_INSUFFICIENT' };
  }
  const validationTrades = simulate(rows, selected.horizon, trainEnd, validEnd);
  const holdoutTrades = simulate(rows, selected.horizon, validEnd, rows.length);
  const validation = tradeStats(validationTrades), holdout = tradeStats(holdoutTrades);
  const passedOos = passesOos(validation, holdout);
  const oosTrades = validation.trades + holdout.trades;
  const evidenceQuality = passedOos ? Math.min(0.95, 0.72 + Math.min(oosTrades, 60) / 260) : Math.min(0.59, 0.40 + Math.min(oosTrades, 40) / 220);
  const latest = rows.at(-1);
  const recentMeanFundingBps = round(mean(rows.slice(-SIGNAL_LOOKBACK).map((x) => x.rateBps)), 4);
  return {
    symbol,
    alignedFundingEvents: rows.length,
    selectedHorizon: selected.horizon,
    latestFundingBps: round(latest?.rateBps, 4),
    recentMeanFundingBps,
    latestBasisBps: latest ? round(Math.log(latest.perp / latest.spot) * 10_000, 4) : null,
    train: selected.stats,
    validation,
    holdout,
    oosTrades,
    passedOos,
    evidenceQuality: round(evidenceQuality, 4),
    evidenceStatus: passedOos ? 'DELTA_NEUTRAL_CARRY_OOS_PASS' : 'DELTA_NEUTRAL_CARRY_OOS_FAIL',
    recentHoldoutTrades: holdoutTrades.slice(-5),
  };
}

async function main() {
  const candidates = [];
  const errors = [];
  for (const symbol of SYMBOLS) {
    try { candidates.push(await evaluateSymbol(symbol)); }
    catch (error) { errors.push(`${symbol}:${String(error?.message || error)}`); }
  }
  candidates.sort((a, b) => Number(b.passedOos) - Number(a.passedOos) || (b.holdout?.expectancyBps ?? -Infinity) - (a.holdout?.expectancyBps ?? -Infinity));
  const best = candidates[0] ?? null;
  const output = {
    ok: true,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'RESEARCH_ONLY',
    paperOnly: true,
    executionAuthority: false,
    liveLocked: true,
    liveOrders: false,
    methodology: {
      source: 'Binance public USD-M funding history + public spot 1h klines',
      causalPriceAlignment: 'Spot close is timestamped by Binance kline closeTime (column 6) and is eligible only when closeTime <= fundingTime.',
      priorEvidenceCompatibility: 'funding_carry_lab_v1_delta_neutral_oos used spot close values timestamped at kline open and must be treated as causally invalid.',
      symbols: SYMBOLS,
      fundingHistoryLimit: FUNDING_LIMIT,
      split: '60% train / 20% validation / 20% holdout',
      signal: `prior ${SIGNAL_LOOKBACK} funding events mean > ${MIN_TRAILING_FUNDING_BPS} bps and current funding > 0`,
      horizonsFundingEvents: HOLD_HORIZONS,
      horizonSelection: 'train only; frozen for validation and holdout',
      trade: 'long spot + short perpetual, equal notional approximation',
      pnl: 'spot log return - perp log return + received funding - explicit round-trip fees/slippage',
      spotTakerBpsPerSide: SPOT_TAKER_BPS_PER_SIDE,
      perpTakerBpsPerSide: PERP_TAKER_BPS_PER_SIDE,
      slippageReserveBps: SLIPPAGE_RESERVE_BPS,
      roundTripCostBps: ROUND_TRIP_COST_BPS,
      negativeFundingPolicy: 'FAIL_CLOSED: no short-spot/long-perp carry because borrow availability/cost is not modeled',
      limitation: 'Historical delta-neutral approximation; ignores margin liquidation path and venue/account-specific fee discounts. No real positions are opened.',
    },
    testedSymbols: candidates.length,
    oosPassCount: candidates.filter((x) => x.passedOos).length,
    candidates,
    best,
    sleeve: best ? {
      sleeveKey: 'FUNDING_CARRY',
      engineVersion: VERSION,
      samples: best.oosTrades ?? 0,
      expectancyBps: best.holdout?.expectancyBps ?? null,
      profitFactor: best.holdout?.profitFactor ?? null,
      tStat: best.holdout?.tStat ?? null,
      maxDrawdownPct: best.holdout?.maxDrawdownPct ?? null,
      evidenceQuality: best.evidenceQuality ?? 0,
      paperCapitalEligible: best.passedOos === true,
    } : null,
    errors: errors.slice(0, 30),
    invariants: { signsTransactions: false, broadcastsTransactions: false, unlocksLive: false },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ version: VERSION, testedSymbols: output.testedSymbols, oosPassCount: output.oosPassCount, best: best ? { symbol: best.symbol, selectedHorizon: best.selectedHorizon, validation: best.validation, holdout: best.holdout, passedOos: best.passedOos } : null, errors: output.errors.length }));
}

if (process.argv[1]?.endsWith('runFundingCarryLab.mjs')) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
