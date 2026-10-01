import { createHash } from 'node:crypto';
import { createSolanaEvent } from './solanaEventModel.mjs';

// Architecture inspired by the MIT-licensed jarrodwatts/jev-trader project:
// passive post-only quoting, cancel/replace discipline, inventory caps, timing and accounting.
// No Monad/Kuru execution code or profitability assumptions are imported.
export const SOLANA_MAKER_MODE = 'SHADOW';
export const SOLANA_MAKER_EXECUTION_AUTHORITY = false;
export const SOLANA_MAKER_LIVE_LOCKED = true;

export const SOLANA_MAKER_POLICY = Object.freeze({
  version: 'solana-maker-shadow-v1',
  notionalUsd: 25,
  maxInventoryUsd: 50,
  quoteInsideTicks: 1,
  minSpreadBps: 4,
  minNetEdgeBps: 2,
  minFillSamples: 50,
  minFillProbability: 0.02,
  maxFillProbability: 0.98,
  maxAdverseSelectionBps: 20,
  maxBookAgeMs: 1_500,
  maxQuoteAgeMs: 1_200,
  repriceThresholdBps: 1,
  inventoryPenaltyMaxBps: 8,
});

function isPresent(value) {
  return value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');
}

function finite(value) {
  return isPresent(value) && Number.isFinite(Number(value));
}

function numberOrNull(value) {
  return finite(value) ? Number(value) : null;
}

function envNumber(value, fallback, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY) {
  const parsed = numberOrNull(value);
  if (parsed == null) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function getSolanaMakerPolicy(env = process.env) {
  return Object.freeze({
    ...SOLANA_MAKER_POLICY,
    version: env.GENESIS_SOLANA_MAKER_POLICY_VERSION || SOLANA_MAKER_POLICY.version,
    notionalUsd: envNumber(env.GENESIS_SOLANA_MAKER_NOTIONAL_USD, SOLANA_MAKER_POLICY.notionalUsd, 1),
    maxInventoryUsd: envNumber(env.GENESIS_SOLANA_MAKER_MAX_INVENTORY_USD, SOLANA_MAKER_POLICY.maxInventoryUsd, 1),
    quoteInsideTicks: Math.round(envNumber(env.GENESIS_SOLANA_MAKER_INSIDE_TICKS, SOLANA_MAKER_POLICY.quoteInsideTicks, 0, 50)),
    minSpreadBps: envNumber(env.GENESIS_SOLANA_MAKER_MIN_SPREAD_BPS, SOLANA_MAKER_POLICY.minSpreadBps, 0),
    minNetEdgeBps: envNumber(env.GENESIS_SOLANA_MAKER_MIN_NET_EDGE_BPS, SOLANA_MAKER_POLICY.minNetEdgeBps, 0),
    minFillSamples: Math.round(envNumber(env.GENESIS_SOLANA_MAKER_MIN_FILL_SAMPLES, SOLANA_MAKER_POLICY.minFillSamples, 1)),
    minFillProbability: envNumber(env.GENESIS_SOLANA_MAKER_MIN_FILL_PROBABILITY, SOLANA_MAKER_POLICY.minFillProbability, 0, 1),
    maxFillProbability: envNumber(env.GENESIS_SOLANA_MAKER_MAX_FILL_PROBABILITY, SOLANA_MAKER_POLICY.maxFillProbability, 0, 1),
    maxAdverseSelectionBps: envNumber(env.GENESIS_SOLANA_MAKER_MAX_ADVERSE_SELECTION_BPS, SOLANA_MAKER_POLICY.maxAdverseSelectionBps, 0),
    maxBookAgeMs: Math.round(envNumber(env.GENESIS_SOLANA_MAKER_MAX_BOOK_AGE_MS, SOLANA_MAKER_POLICY.maxBookAgeMs, 50)),
    maxQuoteAgeMs: Math.round(envNumber(env.GENESIS_SOLANA_MAKER_MAX_QUOTE_AGE_MS, SOLANA_MAKER_POLICY.maxQuoteAgeMs, 50)),
    repriceThresholdBps: envNumber(env.GENESIS_SOLANA_MAKER_REPRICE_THRESHOLD_BPS, SOLANA_MAKER_POLICY.repriceThresholdBps, 0),
    inventoryPenaltyMaxBps: envNumber(env.GENESIS_SOLANA_MAKER_INVENTORY_PENALTY_MAX_BPS, SOLANA_MAKER_POLICY.inventoryPenaltyMaxBps, 0),
  });
}

function isoMs(value) {
  if (!isPresent(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function round(value, digits = 12) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function alignDown(price, tick) {
  return round(Math.floor((price + tick * 1e-9) / tick) * tick);
}

function alignUp(price, tick) {
  return round(Math.ceil((price - tick * 1e-9) / tick) * tick);
}

export function normalizeMakerBook(snapshot, { nowMs = Date.now() } = {}) {
  const bestBid = numberOrNull(snapshot?.bestBid ?? snapshot?.bid);
  const bestAsk = numberOrNull(snapshot?.bestAsk ?? snapshot?.ask);
  const tickSize = numberOrNull(snapshot?.tickSize);
  const observedMs = isoMs(snapshot?.observedAt ?? snapshot?.timestamp);
  if ([bestBid, bestAsk, tickSize].some((value) => value == null)) throw new Error('maker_book_numeric_fields_required');
  if (bestBid <= 0 || bestAsk <= 0 || bestAsk <= bestBid) throw new Error('maker_book_invalid_touch');
  if (tickSize <= 0) throw new Error('maker_book_invalid_tick');
  if (observedMs == null) throw new Error('maker_book_observed_at_required');

  const mid = (bestBid + bestAsk) / 2;
  const bidDepthUsd = numberOrNull(snapshot?.bidDepthUsd);
  const askDepthUsd = numberOrNull(snapshot?.askDepthUsd);
  const depthTotal = bidDepthUsd != null && askDepthUsd != null ? bidDepthUsd + askDepthUsd : null;
  const imbalance = numberOrNull(snapshot?.imbalance) ?? (
    depthTotal != null && depthTotal > 0 ? (bidDepthUsd - askDepthUsd) / depthTotal : null
  );

  return Object.freeze({
    venue: String(snapshot?.venue || 'unknown'),
    market: String(snapshot?.market || 'SOL/USDC'),
    bestBid,
    bestAsk,
    tickSize,
    mid,
    spreadBps: ((bestAsk - bestBid) / mid) * 10_000,
    slot: numberOrNull(snapshot?.slot),
    observedAt: new Date(observedMs).toISOString(),
    bookAgeMs: Math.max(0, Number(nowMs) - observedMs),
    bidDepthUsd,
    askDepthUsd,
    imbalance,
  });
}

export function buildPassiveMakerQuote({ book, side, policy = SOLANA_MAKER_POLICY }) {
  if (!['buy', 'sell'].includes(side)) throw new Error('invalid_maker_side');
  const step = Math.max(0, policy.quoteInsideTicks) * book.tickSize;
  let price;
  if (side === 'buy') {
    const maxPostOnly = book.bestAsk - book.tickSize;
    price = maxPostOnly > book.bestBid ? alignDown(Math.min(book.bestBid + step, maxPostOnly), book.tickSize) : book.bestBid;
    if (price >= book.bestAsk) price = book.bestBid;
  } else {
    const minPostOnly = book.bestBid + book.tickSize;
    price = minPostOnly < book.bestAsk ? alignUp(Math.max(book.bestAsk - step, minPostOnly), book.tickSize) : book.bestAsk;
    if (price <= book.bestBid) price = book.bestAsk;
  }
  const grossCaptureBps = side === 'buy'
    ? ((book.mid - price) / book.mid) * 10_000
    : ((price - book.mid) / book.mid) * 10_000;
  return Object.freeze({
    side,
    price: round(price),
    sizeUsd: policy.notionalUsd,
    grossCaptureBps,
    postOnly: true,
    crossesTouch: side === 'buy' ? price >= book.bestAsk : price <= book.bestBid,
  });
}

function sideEvidence(evidence, key, side) {
  const value = evidence?.[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) return value[side];
  return value;
}

function lifecycleCosts(evidence) {
  const baseFeeUsd = numberOrNull(evidence?.baseFeeUsd);
  const priorityFeeUsd = numberOrNull(evidence?.priorityFeeUsd);
  const cancelReplaceFeeUsd = numberOrNull(evidence?.cancelReplaceFeeUsd);
  const otherLifecycleCostUsd = numberOrNull(evidence?.otherLifecycleCostUsd) ?? 0;
  const known = [baseFeeUsd, priorityFeeUsd, cancelReplaceFeeUsd].every((value) => value != null && value >= 0)
    && otherLifecycleCostUsd >= 0;
  return { known, baseFeeUsd, priorityFeeUsd, cancelReplaceFeeUsd, otherLifecycleCostUsd };
}

export function evaluateMakerCandidate({ book, quote, evidence = {}, inventoryUsd = 0, policy = SOLANA_MAKER_POLICY }) {
  const blockers = [];
  const inventory = numberOrNull(inventoryUsd);
  const direction = quote.side === 'buy' ? 1 : -1;
  const projectedInventoryUsd = (inventory ?? 0) + direction * policy.notionalUsd;
  const fillProbability = numberOrNull(sideEvidence(evidence, 'fillProbability', quote.side));
  const fillSamples = numberOrNull(sideEvidence(evidence, 'fillSamples', quote.side));
  const adverseSelectionBps = numberOrNull(sideEvidence(evidence, 'adverseSelectionBps', quote.side));
  const makerFeeBps = numberOrNull(evidence?.makerFeeBps); // negative is a verified maker rebate
  const costs = lifecycleCosts(evidence);

  if (inventory == null) blockers.push('inventory_unknown');
  if (book.bookAgeMs > policy.maxBookAgeMs) blockers.push('book_stale');
  if (book.spreadBps < policy.minSpreadBps) blockers.push('spread_too_tight');
  if (quote.crossesTouch) blockers.push('post_only_would_cross');
  if (Math.abs(projectedInventoryUsd) > policy.maxInventoryUsd) blockers.push('inventory_cap');
  if (fillProbability == null) blockers.push('fill_probability_unknown');
  else if (fillProbability < policy.minFillProbability || fillProbability > policy.maxFillProbability) blockers.push('fill_probability_out_of_bounds');
  if (fillSamples == null || fillSamples < policy.minFillSamples) blockers.push('fill_model_uncalibrated');
  if (makerFeeBps == null) blockers.push('maker_fee_unknown');
  if (adverseSelectionBps == null || adverseSelectionBps < 0) blockers.push('adverse_selection_unknown');
  else if (adverseSelectionBps > policy.maxAdverseSelectionBps) blockers.push('adverse_selection_too_high');
  if (!costs.known) blockers.push('lifecycle_cost_unknown');

  const economicsKnown = inventory != null && fillProbability != null && makerFeeBps != null
    && adverseSelectionBps != null && adverseSelectionBps >= 0 && costs.known;
  let economics = {
    known: false,
    grossCaptureBps: quote.grossCaptureBps,
    expectedGrossCaptureUsd: null,
    makerFeeBps,
    adverseSelectionBps,
    inventoryPenaltyBps: null,
    lifecycleCostUsd: null,
    totalCostBps: null,
    expectedNetPnlUsd: null,
    netEdgeBps: null,
    fillProbability,
    fillSamples,
  };

  if (economicsKnown) {
    const inventoryUtilization = Math.min(1, Math.abs(projectedInventoryUsd) / policy.maxInventoryUsd);
    const inventoryPenaltyBps = inventoryUtilization * policy.inventoryPenaltyMaxBps;
    const grossIfFilledUsd = policy.notionalUsd * (quote.grossCaptureBps / 10_000);
    const makerFeeIfFilledUsd = policy.notionalUsd * (makerFeeBps / 10_000);
    const adverseIfFilledUsd = policy.notionalUsd * (adverseSelectionBps / 10_000);
    const inventoryPenaltyIfFilledUsd = policy.notionalUsd * (inventoryPenaltyBps / 10_000);
    const lifecycleCostUsd = costs.baseFeeUsd + costs.priorityFeeUsd + costs.cancelReplaceFeeUsd + costs.otherLifecycleCostUsd;
    const expectedGrossCaptureUsd = fillProbability * grossIfFilledUsd;
    const expectedVariableCostsUsd = fillProbability * (makerFeeIfFilledUsd + adverseIfFilledUsd + inventoryPenaltyIfFilledUsd);
    const expectedNetPnlUsd = expectedGrossCaptureUsd - expectedVariableCostsUsd - lifecycleCostUsd;
    const netEdgeBps = (expectedNetPnlUsd / policy.notionalUsd) * 10_000;
    const totalCostBps = ((expectedVariableCostsUsd + lifecycleCostUsd) / policy.notionalUsd) * 10_000;
    economics = {
      known: true,
      grossCaptureBps: quote.grossCaptureBps,
      expectedGrossCaptureUsd,
      makerFeeBps,
      adverseSelectionBps,
      inventoryPenaltyBps,
      lifecycleCostUsd,
      totalCostBps,
      expectedNetPnlUsd,
      netEdgeBps,
      fillProbability,
      fillSamples,
    };
    if (expectedNetPnlUsd <= 0) blockers.push('net_not_positive');
    if (netEdgeBps < policy.minNetEdgeBps) blockers.push('min_net_edge_bps');
  }

  return Object.freeze({
    side: quote.side,
    quote,
    projectedInventoryUsd,
    economics: Object.freeze(economics),
    blockers: [...new Set(blockers)],
    eligible: blockers.length === 0,
  });
}

export function chooseBestMakerCandidate(candidates) {
  const eligible = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.eligible && Number.isFinite(candidate?.economics?.expectedNetPnlUsd));
  return eligible.sort((a, b) => b.economics.expectedNetPnlUsd - a.economics.expectedNetPnlUsd)[0] ?? null;
}

function makerRunId(book) {
  const material = `${book.venue}|${book.market}|${book.slot ?? 'noslot'}|${book.observedAt}`;
  return `maker-${createHash('sha256').update(material).digest('hex').slice(0, 20)}`;
}

export function evaluateSolanaMakerShadow({ snapshot, evidence = {}, inventoryUsd = 0, policy = SOLANA_MAKER_POLICY, nowMs = Date.now() }) {
  const book = normalizeMakerBook(snapshot, { nowMs });
  const candidates = ['buy', 'sell'].map((side) => evaluateMakerCandidate({
    book,
    quote: buildPassiveMakerQuote({ book, side, policy }),
    evidence,
    inventoryUsd,
    policy,
  }));
  const selected = chooseBestMakerCandidate(candidates);
  const bestEconomicCandidate = [...candidates]
    .filter((candidate) => candidate.economics.known)
    .sort((a, b) => b.economics.expectedNetPnlUsd - a.economics.expectedNetPnlUsd)[0] ?? null;
  const runId = makerRunId(book);
  const events = [];
  let sequence = 0;
  const push = (type, payload = {}) => events.push(createSolanaEvent({
    runId,
    type,
    sequence: sequence++,
    timestamp: book.observedAt,
    mode: SOLANA_MAKER_MODE,
    route: `maker:${book.venue}:${book.market}`,
    venues: [book.venue],
    inputAmountUsd: policy.notionalUsd,
    slot: book.slot,
    latencyMs: book.bookAgeMs,
    ...payload,
  }));

  push('SCAN_STARTED', { decision: 'OBSERVE' });
  push('QUOTE_RECEIVED', { grossEdgeBps: book.spreadBps, decision: 'PASSIVE_QUOTE_EVALUATION' });
  if (bestEconomicCandidate) push('COSTS_CALCULATED', {
    grossEdgeBps: bestEconomicCandidate.economics.grossCaptureBps,
    totalCostBps: bestEconomicCandidate.economics.totalCostBps,
    netEdgeBps: bestEconomicCandidate.economics.netEdgeBps,
    expectedNetPnlUsd: bestEconomicCandidate.economics.expectedNetPnlUsd,
    estimatedCosts: {
      makerFeeBps: bestEconomicCandidate.economics.makerFeeBps,
      adverseSelectionBps: bestEconomicCandidate.economics.adverseSelectionBps,
      inventoryPenaltyBps: bestEconomicCandidate.economics.inventoryPenaltyBps,
      lifecycleCostUsd: bestEconomicCandidate.economics.lifecycleCostUsd,
    },
    decision: 'ECONOMICS_MEASURED',
  });

  if (selected) push('OPPORTUNITY_DETECTED', {
    grossEdgeBps: selected.economics.grossCaptureBps,
    totalCostBps: selected.economics.totalCostBps,
    netEdgeBps: selected.economics.netEdgeBps,
    expectedNetPnlUsd: selected.economics.expectedNetPnlUsd,
    decision: 'SHADOW_ACCEPTED',
    reason: `${selected.side}_maker_candidate`,
  });
  else {
    const blockers = [...new Set(candidates.flatMap((candidate) => candidate.blockers))];
    push('REJECTED', {
      blockers,
      decision: 'REJECTED',
      reason: blockers[0] || 'no_eligible_maker_candidate',
      netEdgeBps: bestEconomicCandidate?.economics?.netEdgeBps,
      expectedNetPnlUsd: bestEconomicCandidate?.economics?.expectedNetPnlUsd,
    });
  }

  return Object.freeze({
    ok: true,
    mode: SOLANA_MAKER_MODE,
    executionAuthority: SOLANA_MAKER_EXECUTION_AUTHORITY,
    liveLocked: SOLANA_MAKER_LIVE_LOCKED,
    policyVersion: policy.version,
    runId,
    book,
    candidates,
    selected,
    status: selected ? 'ELIGIBLE_SHADOW' : 'BLOCKED',
    events,
  });
}

export function decideMakerQuoteLifecycle({ previousIntent, nextIntent, policy = SOLANA_MAKER_POLICY, nowMs = Date.now() }) {
  if (!previousIntent && !nextIntent) return Object.freeze({ action: 'NONE', reason: 'no_quote' });
  if (!previousIntent && nextIntent) return Object.freeze({ action: 'PLACE_SHADOW', reason: 'new_quote' });
  if (previousIntent && !nextIntent) return Object.freeze({ action: 'CANCEL_SHADOW', reason: 'candidate_blocked' });
  if (previousIntent.side !== nextIntent.side) return Object.freeze({ action: 'REPLACE_SHADOW', reason: 'side_changed' });
  const previousAt = isoMs(previousIntent.observedAt ?? previousIntent.createdAt);
  const ageMs = previousAt == null ? Number.POSITIVE_INFINITY : Math.max(0, Number(nowMs) - previousAt);
  if (ageMs > policy.maxQuoteAgeMs) return Object.freeze({ action: 'REPLACE_SHADOW', reason: 'quote_stale' });
  const previousPrice = numberOrNull(previousIntent.price);
  const nextPrice = numberOrNull(nextIntent.price);
  if (previousPrice == null || nextPrice == null || previousPrice <= 0) return Object.freeze({ action: 'REPLACE_SHADOW', reason: 'invalid_previous_quote' });
  const distanceBps = (Math.abs(nextPrice - previousPrice) / previousPrice) * 10_000;
  if (distanceBps >= policy.repriceThresholdBps) return Object.freeze({ action: 'REPLACE_SHADOW', reason: 'price_moved', distanceBps });
  return Object.freeze({ action: 'KEEP_SHADOW', reason: 'quote_still_competitive', distanceBps });
}

export class SolanaMakerShadowLoop {
  constructor({ policy = SOLANA_MAKER_POLICY } = {}) {
    this.policy = policy;
    this.busy = false;
    this.currentIntent = null;
    this.stats = { cycles: 0, lateCycles: 0, eligibleCycles: 0, blockedCycles: 0 };
  }

  async cycle({ readBook, readEvidence, inventoryUsd = 0, now = () => new Date() }) {
    if (typeof readBook !== 'function') throw new Error('maker_read_book_required');
    if (this.busy) {
      this.stats.lateCycles++;
      return Object.freeze({ ok: false, status: 'LATE_SKIPPED', liveLocked: true, executionAuthority: false });
    }
    this.busy = true;
    this.stats.cycles++;
    const started = performance.now();
    try {
      const snapshot = await readBook();
      const readMs = performance.now() - started;
      const evidence = typeof readEvidence === 'function' ? await readEvidence(snapshot) : {};
      const clock = now();
      const result = evaluateSolanaMakerShadow({ snapshot, evidence, inventoryUsd, policy: this.policy, nowMs: clock.getTime() });
      const nextIntent = result.selected ? {
        side: result.selected.side,
        price: result.selected.quote.price,
        sizeUsd: result.selected.quote.sizeUsd,
        observedAt: result.book.observedAt,
        slot: result.book.slot,
        venue: result.book.venue,
      } : null;
      const lifecycle = decideMakerQuoteLifecycle({ previousIntent: this.currentIntent, nextIntent, policy: this.policy, nowMs: clock.getTime() });
      this.currentIntent = nextIntent;
      if (result.selected) this.stats.eligibleCycles++;
      else this.stats.blockedCycles++;
      return Object.freeze({
        ...result,
        lifecycle,
        timing: Object.freeze({ readMs: Math.round(readMs), loopMs: Math.round(performance.now() - started) }),
        stats: Object.freeze({ ...this.stats }),
      });
    } finally {
      this.busy = false;
    }
  }
}
