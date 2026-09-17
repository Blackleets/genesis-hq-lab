import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const VERSION = 'market_making_lab_v1';
const BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const SYMBOLS = (process.env.GENESIS_MM_SYMBOLS || 'SOLUSDT,BTCUSDT,ETHUSDT').split(',').map((x) => x.trim()).filter(Boolean);
const SAMPLE_ROUNDS = Math.max(4, Number(process.env.GENESIS_MM_SAMPLE_ROUNDS || 8));
const SAMPLE_INTERVAL_MS = Math.max(250, Number(process.env.GENESIS_MM_SAMPLE_INTERVAL_MS || 750));
const MAKER_FEE_BPS_PER_SIDE = Number(process.env.GENESIS_MM_MAKER_FEE_BPS || 10);
const INVENTORY_RESERVE_BPS = Number(process.env.GENESIS_MM_INVENTORY_RESERVE_BPS || 1);
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'quant-evidence/market-making-lab-latest.json';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const std = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const round = (x, d = 4) => Number.isFinite(Number(x)) ? Number(Number(x).toFixed(d)) : null;

async function fetchJson(path) {
  const response = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`binance_${response.status}:${path}`);
  return response.json();
}

function topDepthUsd(levels, count = 5) {
  return (levels || []).slice(0, count).reduce((sum, row) => sum + Number(row[0]) * Number(row[1]), 0);
}

async function snapshot(symbol) {
  const [ticker, depth] = await Promise.all([
    fetchJson(`/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`),
    fetchJson(`/depth?symbol=${encodeURIComponent(symbol)}&limit=20`),
  ]);
  const bid = Number(ticker.bidPrice), ask = Number(ticker.askPrice);
  if (!(bid > 0 && ask > bid)) throw new Error(`invalid_book:${symbol}`);
  const mid = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  const bidDepthUsd = topDepthUsd(depth.bids), askDepthUsd = topDepthUsd(depth.asks);
  const denom = bidDepthUsd + askDepthUsd;
  return {
    timestamp: new Date().toISOString(), symbol, bid, ask, mid,
    spreadBps: round(spreadBps, 4), bidDepthUsd: round(bidDepthUsd, 2), askDepthUsd: round(askDepthUsd, 2),
    imbalance: denom > 0 ? round((bidDepthUsd - askDepthUsd) / denom, 4) : null,
  };
}

function metrics(samples) {
  const pnl = samples.map((x) => x.netCaptureBps).filter(Number.isFinite);
  const positive = pnl.filter((x) => x > 0), negative = pnl.filter((x) => x < 0);
  const gp = positive.reduce((s, x) => s + x, 0), gl = Math.abs(negative.reduce((s, x) => s + x, 0));
  const ev = mean(pnl), sd = std(pnl);
  let curve = 0, peak = 0, dd = 0;
  for (const x of pnl) { curve += x; peak = Math.max(peak, curve); dd = Math.max(dd, peak - curve); }
  return {
    samples: pnl.length,
    expectancyBps: round(ev, 4),
    profitFactor: gl > 0 ? round(gp / gl, 4) : (gp > 0 ? 99 : null),
    tStat: ev != null && sd > 0 ? round(ev / (sd / Math.sqrt(pnl.length)), 4) : null,
    maxDrawdownPct: round(dd / 100, 4),
  };
}

async function main() {
  const bySymbol = new Map(SYMBOLS.map((symbol) => [symbol, []]));
  const errors = [];
  for (let roundIndex = 0; roundIndex < SAMPLE_ROUNDS; roundIndex++) {
    const results = await Promise.allSettled(SYMBOLS.map(snapshot));
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') bySymbol.get(SYMBOLS[i]).push(result.value);
      else errors.push(`${SYMBOLS[i]}:${String(result.reason?.message || result.reason)}`);
    });
    if (roundIndex < SAMPLE_ROUNDS - 1) await sleep(SAMPLE_INTERVAL_MS);
  }

  const candidates = [];
  for (const [symbol, rows] of bySymbol) {
    const evaluated = [];
    for (let i = 0; i < rows.length - 1; i++) {
      const current = rows[i], next = rows[i + 1];
      const adverseSelectionBps = Math.abs((next.mid - current.mid) / current.mid) * 10_000;
      const netCaptureBps = current.spreadBps - 2 * MAKER_FEE_BPS_PER_SIDE - adverseSelectionBps - INVENTORY_RESERVE_BPS;
      evaluated.push({ ...current, nextMid: next.mid, adverseSelectionBps: round(adverseSelectionBps, 4), netCaptureBps: round(netCaptureBps, 4) });
    }
    const m = metrics(evaluated);
    candidates.push({
      symbol,
      ...m,
      averageSpreadBps: round(mean(evaluated.map((x) => x.spreadBps).filter(Number.isFinite)), 4),
      averageAdverseSelectionBps: round(mean(evaluated.map((x) => x.adverseSelectionBps).filter(Number.isFinite)), 4),
      averageBidDepthUsd: round(mean(rows.map((x) => x.bidDepthUsd).filter(Number.isFinite)), 2),
      averageAskDepthUsd: round(mean(rows.map((x) => x.askDepthUsd).filter(Number.isFinite)), 2),
      fillProbability: null,
      evidenceQuality: 0.45,
      evidenceStatus: 'TOP_OF_BOOK_ONLY_FILL_EVIDENCE_MISSING',
      eligibleForPaperAllocation: false,
    });
  }
  candidates.sort((a, b) => (b.expectancyBps ?? -Infinity) - (a.expectancyBps ?? -Infinity));
  const best = candidates[0] ?? null;
  const output = {
    ok: true, version: VERSION, generatedAt: new Date().toISOString(), mode: 'RESEARCH_ONLY', paperOnly: true,
    liveOrders: false, executionAuthority: false, liveLocked: true,
    methodology: {
      source: 'Binance public top-of-book + depth', symbols: SYMBOLS, sampleRounds: SAMPLE_ROUNDS, sampleIntervalMs: SAMPLE_INTERVAL_MS,
      makerFeeBpsPerSide: MAKER_FEE_BPS_PER_SIDE, inventoryReserveBps: INVENTORY_RESERVE_BPS,
      netCaptureFormula: 'quoted spread - 2*maker fee - next-snapshot adverse selection - inventory reserve',
      limitation: 'No order placement and no empirical passive-fill probability yet; this lab cannot authorize capital.',
    },
    candidates, best,
    sleeve: best ? { sleeveKey: 'MARKET_MAKING', engineVersion: VERSION, samples: best.samples, expectancyBps: best.expectancyBps, profitFactor: best.profitFactor, tStat: best.tStat, maxDrawdownPct: best.maxDrawdownPct, evidenceQuality: best.evidenceQuality, paperCapitalEligible: false } : null,
    errors: errors.slice(0, 30),
    invariants: { signsTransactions: false, broadcastsTransactions: false, unlocksLive: false },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ version: VERSION, best: best ? { symbol: best.symbol, expectancyBps: best.expectancyBps, evidenceStatus: best.evidenceStatus } : null, errors: output.errors.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
