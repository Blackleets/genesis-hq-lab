import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { passiveQuoteWindow, pearson } from '../../src/core/passiveQueueExecution.mjs';

const VERSION = 'market_making_lab_v4_fill_conditioned_adverse_markout';
const BASE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const SYMBOLS = (process.env.GENESIS_MM_SYMBOLS || 'SOLUSDT,BTCUSDT,ETHUSDT').split(',').map((x) => x.trim()).filter(Boolean);
const SAMPLE_ROUNDS = Math.max(8, Number(process.env.GENESIS_MM_SAMPLE_ROUNDS || 24));
const SAMPLE_INTERVAL_MS = Math.max(500, Number(process.env.GENESIS_MM_SAMPLE_INTERVAL_MS || 1000));
const MAKER_FEE_BPS_PER_SIDE = Number(process.env.GENESIS_MM_MAKER_FEE_BPS || 10);
const INVENTORY_RESERVE_BPS = Number(process.env.GENESIS_MM_INVENTORY_RESERVE_BPS || 1);
const QUOTE_NOTIONAL_USD = Math.max(10, Number(process.env.GENESIS_MM_QUOTE_NOTIONAL_USD || 100));
const QUEUE_AHEAD_MULTIPLIER = Math.max(0, Number(process.env.GENESIS_MM_QUEUE_AHEAD_MULTIPLIER || 1));
const ORDER_LATENCY_OVERRIDE_MS = process.env.GENESIS_MM_ORDER_LATENCY_MS == null ? null : Math.max(0, Number(process.env.GENESIS_MM_ORDER_LATENCY_MS));
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
  const requestStartedAtMs = Date.now();
  const [ticker, depth] = await Promise.all([
    fetchJson(`/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`),
    fetchJson(`/depth?symbol=${encodeURIComponent(symbol)}&limit=20`),
  ]);
  const capturedAtMs = Date.now();
  const bid = Number(ticker.bidPrice), ask = Number(ticker.askPrice);
  const bidQty = Number(ticker.bidQty), askQty = Number(ticker.askQty);
  if (!(bid > 0 && ask > bid && bidQty >= 0 && askQty >= 0)) throw new Error(`invalid_book:${symbol}`);
  const mid = (bid + ask) / 2;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  const bidDepthUsd = topDepthUsd(depth.bids), askDepthUsd = topDepthUsd(depth.asks);
  const denom = bidDepthUsd + askDepthUsd;
  return {
    timestamp: new Date(capturedAtMs).toISOString(), capturedAtMs, requestRttMs: capturedAtMs - requestStartedAtMs, symbol, bid, ask, bidQty, askQty, mid,
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
  const latencyMs = ORDER_LATENCY_OVERRIDE_MS ?? Math.max(0, Number(current.requestRttMs || 0) / 2);
  const q = passiveQuoteWindow({
    current,
    next,
    trades,
    quoteNotionalUsd: QUOTE_NOTIONAL_USD,
    queueAheadMultiplier: QUEUE_AHEAD_MULTIPLIER,
    makerFeeBpsPerSide: MAKER_FEE_BPS_PER_SIDE,
    inventoryReserveBps: INVENTORY_RESERVE_BPS,
    orderLatencyMs: latencyMs,
  });
  return {
    ...current,
    nextMid: next.mid,
    tradeCount: trades.length,
    activeTradeCount: q.activeTradeCount,
    quoteNotionalUsd: QUOTE_NOTIONAL_USD,
    quoteQty: round(q.quoteQty, 8),
    orderLatencyMs: round(q.orderLatencyMs, 3),
    bidQueueAheadQty: round(q.bidQueueAheadQty, 8),
    askQueueAheadQty: round(q.askQueueAheadQty, 8),
    sellFlowAtBid: round(q.sellFlowAtBid, 8),
    buyFlowAtAsk: round(q.buyFlowAtAsk, 8),
    bidFillRatio: round(q.bidFillRatio, 6),
    askFillRatio: round(q.askFillRatio, 6),
    matchedFillRatio: round(q.matchedFillRatio, 6),
    bidFilled: q.bidFillRatio > 0,
    askFilled: q.askFillRatio > 0,
    outcome: q.outcome,
    grossCaptureBps: round(q.grossCaptureBps, 4),
    feeBps: round(q.feeBps, 4),
    inventoryPenaltyBps: round(q.inventoryPenaltyBps, 4),
    adverseSelectionBps: round(q.adverseSelectionBps, 4),
    bidAdverseSelectionBps: round(q.bidAdverseSelectionBps, 4),
    askAdverseSelectionBps: round(q.askAdverseSelectionBps, 4),
    microprice: round(q.microprice, 8),
    micropriceEdgeBps: round(q.micropriceEdgeBps, 6),
    nextMidMoveBps: round(q.nextMidMoveBps, 6),
    netCaptureBps: round(q.netCaptureBps, 4),
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
    const fullBothFill = evaluated.filter((x) => x.bidFillRatio === 1 && x.askFillRatio === 1).length;
    const avgFillRatio = mean(evaluated.map((x) => ((x.bidFillRatio || 0) + (x.askFillRatio || 0)) / 2));
    const alphaRows = evaluated.filter((x) => Number.isFinite(x.micropriceEdgeBps) && Number.isFinite(x.nextMidMoveBps) && Math.abs(x.micropriceEdgeBps) > 1e-9);
    const alphaHitRate = alphaRows.length ? alphaRows.filter((x) => Math.sign(x.micropriceEdgeBps) === Math.sign(x.nextMidMoveBps)).length / alphaRows.length : null;
    const micropriceCorr = pearson(alphaRows.map((x) => x.micropriceEdgeBps), alphaRows.map((x) => x.nextMidMoveBps));
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
      fullBothFillProbability: evaluated.length ? round(fullBothFill / evaluated.length, 4) : 0,
      oneSideFillProbability: evaluated.length ? round(oneSideFill / evaluated.length, 4) : 0,
      averageSideFillRatio: round(avgFillRatio, 4),
      averageLatencyProxyMs: round(mean(evaluated.map((x) => x.orderLatencyMs).filter(Number.isFinite)), 3),
      micropriceAlphaSamples: alphaRows.length,
      micropriceDirectionHitRate: round(alphaHitRate, 4),
      micropriceNextMoveCorrelation: round(micropriceCorr, 4),
      evidenceQuality: round(evidenceQuality, 4),
      evidenceStatus: sufficientExecutionEvidence ? 'QUEUE_AWARE_RISK_ADVERSE_PROXY_AVAILABLE' : 'QUEUE_AWARE_PROXY_INSUFFICIENT',
      eligibleForPaperAllocation: sufficientExecutionEvidence,
      recentIntervals: evaluated.slice(-5).map((x) => ({ timestamp: x.timestamp, outcome: x.outcome, spreadBps: x.spreadBps, tradeCount: x.tradeCount, activeTradeCount: x.activeTradeCount, bidFillRatio: x.bidFillRatio, askFillRatio: x.askFillRatio, orderLatencyMs: x.orderLatencyMs, micropriceEdgeBps: x.micropriceEdgeBps, nextMidMoveBps: x.nextMidMoveBps, adverseSelectionBps: x.adverseSelectionBps, netCaptureBps: x.netCaptureBps })),
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
      queueModel: 'risk-adverse FIFO proxy: only observed aggressive trades consume queue-ahead; cancellations never improve estimated position',
      partialFills: 'fills are fractional after queue-ahead is consumed; economics scale by actual estimated fill ratio rather than assuming all-or-nothing fills',
      latencyModel: ORDER_LATENCY_OVERRIDE_MS == null ? 'half observed public REST snapshot RTT used as an order-latency proxy' : `fixed override ${ORDER_LATENCY_OVERRIDE_MS} ms`,
      micropriceAlpha: 'top-of-book microprice is evaluated only as predictive evidence against the next observed mid; it does not create orders',
      adverseSelection: 'fill-conditioned harmful markout only: bid fills pay downside below bid, ask fills pay upside above ask, weighted by fill ratio; no fill = zero realized adverse-selection cost',
      priorEvidenceCompatibility: 'market_making_lab_v1-v3 adverseSelectionBps used unsigned absolute next-mid movement and must not be interpreted as fill-conditioned toxicity cost',
      oneSidedMarking: 'One-sided residual inventory is marked to the next observed mid and pays maker fee plus inventory reserve.',
      inspiration: 'queue-position methodology adapted from nkaz001/hftbacktest (MIT) and Erik Rigtorp queue estimation; Genesis implementation is independent',
      limitation: 'Public REST snapshots are not event-level L2/L3. Queue position and latency remain proxies; no live fill is claimed.',
    },
    candidates, best,
    sleeve: best ? { sleeveKey: 'MARKET_MAKING', engineVersion: VERSION, samples: best.samples, expectancyBps: best.expectancyBps, profitFactor: best.profitFactor, tStat: best.tStat, maxDrawdownPct: best.maxDrawdownPct, evidenceQuality: best.evidenceQuality, paperCapitalEligible: best.eligibleForPaperAllocation === true } : null,
    errors: errors.slice(0, 50),
    invariants: { signsTransactions: false, broadcastsTransactions: false, unlocksLive: false },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ version: VERSION, best: best ? { symbol: best.symbol, samples: best.samples, expectancyBps: best.expectancyBps, profitFactor: best.profitFactor, fillProbability: best.fillProbability, averageSideFillRatio: best.averageSideFillRatio, micropriceDirectionHitRate: best.micropriceDirectionHitRate, micropriceNextMoveCorrelation: best.micropriceNextMoveCorrelation, evidenceStatus: best.evidenceStatus } : null, errors: output.errors.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
