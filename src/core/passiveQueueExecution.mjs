// passiveQueueExecution.mjs — queue-aware passive execution research primitives.
//
// Design source: the queue-position concepts used by nkaz001/hftbacktest (MIT)
// and Erik Rigtorp's FIFO queue-position estimation. This implementation is
// purpose-built for Genesis and deliberately uses the conservative
// "risk-adverse" rule: cancellations never improve our fill estimate.
//
// IMPORTANT: this is a RESEARCH/PAPER execution model, not a live venue emulator.

const finite = (x) => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function micropriceFromTop({ bid, ask, bidQty, askQty } = {}) {
  const b = finite(bid), a = finite(ask), bq = finite(bidQty), aq = finite(askQty);
  if (!(b > 0 && a > b && bq >= 0 && aq >= 0) || bq + aq <= 0) return null;
  // More bid size shifts fair value toward the ask; more ask size shifts it toward the bid.
  return (a * bq + b * aq) / (bq + aq);
}

export function riskAdversePartialFill({ queueAheadQty, quoteQty, aggressorQty } = {}) {
  const front = Math.max(0, finite(queueAheadQty) ?? 0);
  const size = Math.max(0, finite(quoteQty) ?? 0);
  const flow = Math.max(0, finite(aggressorQty) ?? 0);
  if (!(size > 0)) return { filledQty: 0, fillRatio: 0, queueAheadQty: front, aggressorQty: flow };
  const filledQty = clamp(flow - front, 0, size);
  return {
    filledQty,
    fillRatio: filledQty / size,
    queueAheadQty: front,
    aggressorQty: flow,
  };
}

export function filterTradesAfterActivation(trades = [], activationTimeMs) {
  const t = finite(activationTimeMs);
  if (t == null) return trades.slice();
  return trades.filter((row) => finite(row?.time) != null && Number(row.time) >= t);
}

export function passiveQuoteWindow({
  current,
  next,
  trades = [],
  quoteNotionalUsd,
  queueAheadMultiplier = 1,
  makerFeeBpsPerSide = 0,
  inventoryReserveBps = 0,
  orderLatencyMs = 0,
} = {}) {
  const mid = finite(current?.mid), bid = finite(current?.bid), ask = finite(current?.ask);
  const bidQty = finite(current?.bidQty), askQty = finite(current?.askQty);
  const nextMid = finite(next?.mid);
  if (!(mid > 0 && bid > 0 && ask > bid && bidQty >= 0 && askQty >= 0 && nextMid > 0)) throw new Error('invalid_quote_window');

  const quoteQty = Math.max(0, Number(quoteNotionalUsd) / mid);
  const activationTimeMs = Number(current.capturedAtMs) + Math.max(0, Number(orderLatencyMs) || 0);
  const activeTrades = filterTradesAfterActivation(trades, activationTimeMs);

  let sellFlowAtBid = 0;
  let buyFlowAtAsk = 0;
  for (const trade of activeTrades) {
    const px = finite(trade?.price), qty = finite(trade?.qty);
    if (!(px > 0 && qty > 0)) continue;
    if (trade.buyerIsMaker === true && px <= bid) sellFlowAtBid += qty;
    if (trade.buyerIsMaker === false && px >= ask) buyFlowAtAsk += qty;
  }

  const queueMultiplier = Math.max(0, Number(queueAheadMultiplier) || 0);
  const bidQueueAheadQty = bidQty * queueMultiplier;
  const askQueueAheadQty = askQty * queueMultiplier;
  const bidFill = riskAdversePartialFill({ queueAheadQty: bidQueueAheadQty, quoteQty, aggressorQty: sellFlowAtBid });
  const askFill = riskAdversePartialFill({ queueAheadQty: askQueueAheadQty, quoteQty, aggressorQty: buyFlowAtAsk });

  const bidRatio = bidFill.fillRatio;
  const askRatio = askFill.fillRatio;
  const matchedRatio = Math.min(bidRatio, askRatio);
  const residualBid = Math.max(0, bidRatio - matchedRatio);
  const residualAsk = Math.max(0, askRatio - matchedRatio);
  const spreadBps = ((ask - bid) / mid) * 10_000;
  const bidMarkBps = ((nextMid - bid) / mid) * 10_000;
  const askMarkBps = ((ask - nextMid) / mid) * 10_000;

  const grossCaptureBps =
    matchedRatio * spreadBps +
    residualBid * bidMarkBps +
    residualAsk * askMarkBps;
  const feeBps = (bidRatio + askRatio) * Math.max(0, Number(makerFeeBpsPerSide) || 0);
  const inventoryPenaltyBps = Math.abs(bidRatio - askRatio) * Math.max(0, Number(inventoryReserveBps) || 0);
  const netCaptureBps = grossCaptureBps - feeBps - inventoryPenaltyBps;

  const microprice = micropriceFromTop(current);
  const micropriceEdgeBps = microprice == null ? null : ((microprice - mid) / mid) * 10_000;
  const nextMidMoveBps = ((nextMid - mid) / mid) * 10_000;

  // Fill-conditioned harmful markout, not absolute market movement.
  // A bid fill is adverse only when the next mid is below our bid.
  // An ask fill is adverse only when the next mid is above our ask.
  // No fill => zero realized adverse-selection cost for this quote window.
  const bidAdverseSelectionBps = Math.max(0, ((bid - nextMid) / mid) * 10_000);
  const askAdverseSelectionBps = Math.max(0, ((nextMid - ask) / mid) * 10_000);
  const adverseSelectionBps =
    bidRatio * bidAdverseSelectionBps +
    askRatio * askAdverseSelectionBps;

  let outcome = 'NO_FILL';
  if (bidRatio > 0 || askRatio > 0) {
    if (bidRatio === 1 && askRatio === 1) outcome = 'FULL_BOTH';
    else if (bidRatio > 0 && askRatio > 0) outcome = 'PARTIAL_BOTH';
    else if (bidRatio === 1 || askRatio === 1) outcome = 'FULL_ONE_SIDE';
    else outcome = 'PARTIAL_ONE_SIDE';
  }

  return {
    quoteQty,
    activationTimeMs,
    orderLatencyMs: Math.max(0, Number(orderLatencyMs) || 0),
    activeTradeCount: activeTrades.length,
    totalTradeCount: trades.length,
    bidQueueAheadQty,
    askQueueAheadQty,
    sellFlowAtBid,
    buyFlowAtAsk,
    bidFilledQty: bidFill.filledQty,
    askFilledQty: askFill.filledQty,
    bidFillRatio: bidRatio,
    askFillRatio: askRatio,
    matchedFillRatio: matchedRatio,
    outcome,
    grossCaptureBps,
    feeBps,
    inventoryPenaltyBps,
    netCaptureBps,
    adverseSelectionBps,
    bidAdverseSelectionBps,
    askAdverseSelectionBps,
    microprice,
    micropriceEdgeBps,
    nextMidMoveBps,
  };
}

export function pearson(xs = [], ys = []) {
  const rows = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = finite(xs[i]), y = finite(ys[i]);
    if (x != null && y != null) rows.push([x, y]);
  }
  if (rows.length < 3) return null;
  const mx = rows.reduce((s, r) => s + r[0], 0) / rows.length;
  const my = rows.reduce((s, r) => s + r[1], 0) / rows.length;
  let num = 0, dx = 0, dy = 0;
  for (const [x, y] of rows) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : null;
}
