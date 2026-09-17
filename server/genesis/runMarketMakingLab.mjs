import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const VERSION = 'market_making_lab_v2_passive_fill_proxy';
const BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const SYMBOLS = (process.env.GENESIS_MM_SYMBOLS || 'SOLUSDT,BTCUSDT,ETHUSDT').split(',').map((x) => x.trim()).filter(Boolean);
const SAMPLE_ROUNDS = Math.max(8, Number(process.env.GENESIS_MM_SAMPLE_ROUNDS || 24));
const SAMPLE_INTERVAL_MS = Math.max(500, Number(process.env.GENESIS_MM_SAMPLE_INTERVAL_MS || 1000));
const MAKER_FEE_BPS_PER_SIDE = Number(process.env.GENESIS_MM_MAKER_FEE_BPS || 10);
const INVENTORY_RESERVE_BPS = Number(process.env.GENESIS_MM_INVENTORY_RESERVE_BPS || 1);
const QUOTE_NOTIONAL_USD = Math.max(10, Number(process.env.GENESIS_MM_QUOTE_NOTIONAL_USD || 100));
const QUEUE_AHEAD_MULTIPLIER = Math.max(0, Number(process.env.GENESIS_MM_QUEUE_AHEAD_MULTIPLIER || 1));
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
  const capturedAtMs = Date.now();
  const [ticker, depth] = await Promise.all([
    fetchJson(`/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`),
    fetchJson(`/depth?symbol=${encodeURIComponent(symbol)}&limit=20`),
  ]);
  const bid = Number(ticker.bidPrice), ask = Number(ticker.askPrice);
  const bidQty = Number(ticker.bidQty), askQty = Number(ticker.askQty);
  if (!(bid > 0 && ask > bid && bidQty >= 0 && askQty >= 0)) throw new Error(`invalid_book:${symbol}`);
  const mid = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  const bidDepthUsd = topDepthUsd(depth.bids), askDepthUsd = topDepthUsd(depth.asks);
  const denom = bidDepthUsd + askDepthUsd;
  return {
    timestamp: new Date(capturedAtMs).toISOString(), capturedAtMs, symbol, bid, ask, bidQty, askQty, mid,
    spreadBps: round(spreadBps, 4), bidDepthUsd: round(bidDepthUsd, 2), askDepthUsd: round(askDepthUsd, 2),
    imbalance: denom > 0 ? round((bidDepthUsd - askDepthUsd) / denom, 4) : null,
  };
}

async function aggregateTrades(symbol, startTime, endTime) {
  if (!(endTime > startTime)) return [];
  const params = new URLSearchParams({ symbol, startTime: String(startTime), endTime: String(endTime), limit: '1000' });
  const rows = await fetchJson(`/aggTrades?${params}`);
  if (!Array.isArray(rows)) throw new Error(`invalid_agg_trades:${symbol}`);
  return rows.map((row) => ({
    price: Number(row.p), qty: Number(row.q), time: Number(row.T), buyerIsMaker: row.m === true,
  })).filter((row) => row.price > 0 && row.qty > 0 && Number.isFinite(row.time));
}

function passiveFillProxy(current, next, trades) {
  const quoteQty = QUOTE_NOTIONAL_USD / current.mid;
  const bidQueueAheadQty = Math.max(0, current.bidQty * QUEUE_AHEAD_MULTIPLIER);
  const askQueueAheadQty = Math.max(0, current.askQty * QUEUE_AHEAD_MULTIPLIER);
  let sellFlowAtBid = 0;
  let buyFlowAtAsk = 0;
  for (const trade of trades) {
    if (trade.buyerIsMaker && trade.price <= current.bid) sellFlowAtBid += trade.qty;
    if (!trade.buyerIsMaker && trade.price >= current.ask) buyFlowAtAsk += trade.qty;
  }
  const bidFilled = sellFlowAtBid >= bidQueueAheadQty + quoteQty;
  const askFilled = buyFlowAtAsk >= askQueueAheadQty + quoteQty;
  const spreadCaptureBps = current.spreadBps;
  let grossBps = 0;
  let feeBps = 0;
  let inventoryPenaltyBps = 0;
  let outcome = 'NO_FILL';
  if (bidFilled && askFilled) {
    grossBps = spreadCaptureBps;
    feeBps = 2 * MAKER_FEE_BPS_PER_SIDE;
    outcome = 'BOTH_FILLED';
  } else if (bidFilled) {
    grossBps = ((next.mid - current.bid) / current.mid) * 10_000;
    feeBps = MAKER_FEE_BPS_PER_SIDE;
    inventoryPenaltyBps = INVENTORY_RESERVE_BPS;
    outcome = 'BID_ONLY';
  } else if (askFilled) {
    grossBps = ((current.ask - next.mid) / current.mid) * 10_000;
    feeBps = MAKER_FEE_BPS_PER_SIDE;
    inventoryPenaltyBps = INVENTORY_RESERVE_BPS;
    outcome = 'ASK_ONLY';
  }
  const netCaptureBps = grossBps - feeBps - inventoryPenaltyBps;
  const adverseSelectionBps = Math.abs((next.mid - current.mid) / current.mid) * 10_000;
  return {
    ...current,
    nextMid: next.mid,
    tradeCount: trades.length,
    quoteNotionalUsd: QUOTE_NOTIONAL_USD,
    quoteQty: round(quoteQty, 8),
    bidQueueAheadQty: round(bidQueueAheadQty, 8),
    askQueueAheadQty: round(askQueueAheadQty, 8),
    sellFlowAtBid: round(sellFlowAtBid, 8),
    buyFlowAtAsk: round(buyFlowAtAsk, 8),
    bidFilled,
    askFilled,
    outcome,
    grossCaptureBps: round(grossBps, 4),
    feeBps: round(feeBps, 4),
    inventoryPenaltyBps: round(inventoryPenaltyBps, 4),
    adverseSelectionBps: round(adverseSelectionBps, 4),
    netCaptureBps: round(netCaptureBps, 4),
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
    totalNetBps: round(pnl.reduce((s, x) => s + x, 0), 4),
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
    let tradeWindowsObserved = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const current = rows[i], next = rows[i + 1];
      try {
        const trades = await aggregateTrades(symbol, current.capturedAtMs, next.capturedAtMs);
        tradeWindowsObserved++;
        evaluated.push(passiveFillProxy(current, next, trades));
      } catch (error) {
        errors.push(`${symbol}:aggTrades:${String(error?.message || error)}`);
      }
    }
    const m = metrics(evaluated);
    const windows = Math.max(1, rows.length - 1);
    const coverage = tradeWindowsObserved / windows;
    const anyFill = evaluated.filter((x) => x.bidFilled || x.askFilled).length;
    const bothFill = evaluated.filter((x) => x.bidFilled && x.askFilled).length;
    const oneSideFill = evaluated.filter((x) => x.bidFilled !== x.askFilled).length;
    const fillProbability = evaluated.length ? anyFill / evaluated.length : 0;
    const sufficientExecutionEvidence = m.samples >= 20 && coverage >= 0.95;
    const evidenceQuality = sufficientExecutionEvidence
      ? Math.min(0.80, 0.60 + Math.min(m.samples, 100) / 500)
      : Math.min(0.59, 0.35 + coverage * 0.20);
    candidates.push({
      symbol,
      ...m,
      averageSpreadBps: round(mean(evaluated.map((x) => x.spreadBps).filter(Number.isFinite)), 4),
      averageAdverseSelectionBps: round(mean(evaluated.map((x) => x.adverseSelectionBps).filter(Number.isFinite)), 4),
      averageBidDepthUsd: round(mean(rows.map((x) => x.bidDepthUsd).filter(Number.isFinite)), 2),
      averageAskDepthUsd: round(mean(rows.map((x) => x.askDepthUsd).filter(Number.isFinite)), 2),
      tradeWindowCoverage: round(coverage, 4),
      fillProbability: round(fillProbability, 4),
      bothFillProbability: evaluated.length ? round(bothFill / evaluated.length, 4) : 0,
      oneSideFillProbability: evaluated.length ? round(oneSideFill / evaluated.length, 4) : 0,
      evidenceQuality: round(evidenceQuality, 4),
      evidenceStatus: sufficientExecutionEvidence ? 'PASSIVE_FILL_PROXY_AVAILABLE' : 'PASSIVE_FILL_PROXY_INSUFFICIENT',
      eligibleForPaperAllocation: sufficientExecutionEvidence,
      recentIntervals: evaluated.slice(-5).map((x) => ({ timestamp: x.timestamp, outcome: x.outcome, spreadBps: x.spreadBps, tradeCount: x.tradeCount, netCaptureBps: x.netCaptureBps })),
    });
  }
  candidates.sort((a, b) => (b.expectancyBps ?? -Infinity) - (a.expectancyBps ?? -Infinity));
  const best = candidates[0] ?? null;
  const output = {
    ok: true, version: VERSION, generatedAt: new Date().toISOString(), mode: 'RESEARCH_ONLY', paperOnly: true,
    liveOrders: false, executionAuthority: false, liveLocked: true,
    methodology: {
      source: 'Binance public top-of-book + depth + aggregate trades', symbols: SYMBOLS, sampleRounds: SAMPLE_ROUNDS, sampleIntervalMs: SAMPLE_INTERVAL_MS,
      makerFeeBpsPerSide: MAKER_FEE_BPS_PER_SIDE, inventoryReserveBps: INVENTORY_RESERVE_BPS,
      quoteNotionalUsd: QUOTE_NOTIONAL_USD, queueAheadMultiplier: QUEUE_AHEAD_MULTIPLIER,
      fillProxy: 'A passive bid/ask is counted filled only when observed aggressor flow at/through the quoted price exceeds estimated queue-ahead plus our quote size.',
      oneSidedMarking: 'One-sided fills are marked to the next observed mid and pay one maker fee plus inventory reserve.',
      limitation: 'This is a conservative historical/passive-fill proxy, not an exchange queue-position guarantee and not a live order.',
    },
    candidates, best,
    sleeve: best ? { sleeveKey: 'MARKET_MAKING', engineVersion: VERSION, samples: best.samples, expectancyBps: best.expectancyBps, profitFactor: best.profitFactor, tStat: best.tStat, maxDrawdownPct: best.maxDrawdownPct, evidenceQuality: best.evidenceQuality, paperCapitalEligible: best.eligibleForPaperAllocation === true } : null,
    errors: errors.slice(0, 50),
    invariants: { signsTransactions: false, broadcastsTransactions: false, unlocksLive: false },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ version: VERSION, best: best ? { symbol: best.symbol, samples: best.samples, expectancyBps: best.expectancyBps, profitFactor: best.profitFactor, fillProbability: best.fillProbability, evidenceStatus: best.evidenceStatus } : null, errors: output.errors.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
