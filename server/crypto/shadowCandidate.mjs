import { applyManualContextBlocks } from '../strategies/scalpingEngine.mjs';
import { getAssetContexts } from './priceFeeder.mjs';
import { trendContinuationSignal, meanReversionSignal } from './backtest/strategyLab.mjs';

const CANDIDATES = Object.freeze({
  btc_trend_1h_v1: {
    candidateId: 'btc_trend_1h_v1',
    pairSet: ['BTCUSDT'],
    signalFn: trendContinuationSignal,
    signalParams: { trendFrameMinutes: 60, trendMomentumPct: 0.5 },
  },
  btc_trend_4h_v1: {
    candidateId: 'btc_trend_4h_v1',
    pairSet: ['BTCUSDT'],
    signalFn: trendContinuationSignal,
    signalParams: { trendFrameMinutes: 240, trendMomentumPct: 1.2 },
  },
  btc_reversion_1h_v1: {
    candidateId: 'btc_reversion_1h_v1',
    pairSet: ['BTCUSDT'],
    signalFn: meanReversionSignal,
    signalParams: { reversionFrameMinutes: 60, reversionDeviationPct: 0.015, reversionRsiOversold: 32, reversionRsiOverbought: 68 },
  },
});

const EMPTY = Object.freeze({
  candidateId: null,
  running: false,
  pairSet: [],
  signalsSeen: 0,
  wouldTradeCount: 0,
  blockedCount: 0,
  byPair: [],
  byHour: [],
  recent: [],
});

const state = {
  candidateId: null,
  running: false,
  pairSet: [],
  signalsSeen: 0,
  wouldTradeCount: 0,
  blockedCount: 0,
  byPair: new Map(),
  byHour: new Map(),
  recent: [],
  lastEvaluatedAt: 0,
};

function hourBucket(iso) {
  return String(new Date(iso).getUTCHours()).padStart(2, '0');
}

function toArray(map, keyName) {
  return [...map.values()].map((entry) => ({ [keyName]: entry[keyName], signalsSeen: entry.signalsSeen, wouldTradeCount: entry.wouldTradeCount, blockedCount: entry.blockedCount }));
}

function createPoint(label, keyName) {
  return { [keyName]: label, signalsSeen: 0, wouldTradeCount: 0, blockedCount: 0 };
}

function buildCandidateSignal(candidate, asset, openedAt) {
  const signal = candidate.signalFn(asset, candidate.signalParams);
  if (signal.action !== 'TRADE') return signal;
  const normalized = {
    ...signal,
    confidence: signal.confidence ?? 0.75,
    rawConfidence: signal.rawConfidence ?? signal.confidence ?? 0.75,
    vetoed: signal.vetoed ?? false,
  };
  return applyManualContextBlocks(normalized, asset, openedAt);
}

export function buildShadowCandidatePayload(snapshot = state) {
  if (!snapshot.running) return { ...EMPTY, candidateId: snapshot.candidateId, pairSet: snapshot.pairSet ?? [] };
  return {
    candidateId: snapshot.candidateId,
    running: snapshot.running,
    pairSet: [...snapshot.pairSet],
    signalsSeen: snapshot.signalsSeen,
    wouldTradeCount: snapshot.wouldTradeCount,
    blockedCount: snapshot.blockedCount,
    byPair: toArray(snapshot.byPair, 'pair'),
    byHour: toArray(snapshot.byHour, 'hour'),
    recent: [...snapshot.recent],
  };
}

export function evaluateShadowCandidateSnapshot({ candidate, contexts, openedAt = new Date().toISOString(), snapshot = state } = {}) {
  if (!candidate) return buildShadowCandidatePayload({ ...snapshot, running: false, candidateId: null, pairSet: [] });
  snapshot.candidateId = candidate.candidateId;
  snapshot.running = true;
  snapshot.pairSet = [...candidate.pairSet];

  for (const asset of contexts.filter((item) => candidate.pairSet.includes(item.pair))) {
    const signal = buildCandidateSignal(candidate, asset, openedAt);
    if (signal.action !== 'TRADE') continue;

    snapshot.signalsSeen += 1;
    const hour = hourBucket(openedAt);
    const pairEntry = snapshot.byPair.get(asset.pair) ?? createPoint(asset.pair, 'pair');
    const hourEntry = snapshot.byHour.get(hour) ?? createPoint(hour, 'hour');
    pairEntry.signalsSeen += 1;
    hourEntry.signalsSeen += 1;

    const blocked = signal.vetoed || signal.blockedByHour || signal.blockedByPair || signal.blockedByConfidenceBand;
    if (blocked) {
      snapshot.blockedCount += 1;
      pairEntry.blockedCount += 1;
      hourEntry.blockedCount += 1;
    } else {
      snapshot.wouldTradeCount += 1;
      pairEntry.wouldTradeCount += 1;
      hourEntry.wouldTradeCount += 1;
    }

    snapshot.byPair.set(asset.pair, pairEntry);
    snapshot.byHour.set(hour, hourEntry);
    snapshot.recent.unshift({
      ts: openedAt,
      pair: asset.pair,
      side: signal.side,
      blocked,
      confidence: signal.confidence ?? null,
      reasons: signal.reasons ?? [],
    });
    snapshot.recent = snapshot.recent.slice(0, 30);
  }

  return buildShadowCandidatePayload(snapshot);
}

function candidateFromEnv() {
  const enabled = ['1', 'true', 'yes'].includes((process.env.SHADOW_CANDIDATE_ENABLED ?? '').toLowerCase());
  if (!enabled) return null;
  const candidateId = (process.env.SHADOW_CANDIDATE_ID ?? 'btc_trend_1h_v1').trim();
  return CANDIDATES[candidateId] ?? null;
}

export async function getShadowCandidateDiagnostics({ now = Date.now(), contexts } = {}) {
  const candidate = candidateFromEnv();
  if (!candidate) {
    state.candidateId = process.env.SHADOW_CANDIDATE_ID ?? null;
    state.running = false;
    state.pairSet = [];
    return buildShadowCandidatePayload(state);
  }

  if (now - state.lastEvaluatedAt < 15_000) return buildShadowCandidatePayload(state);

  const liveContexts = contexts ?? await getAssetContexts();
  state.lastEvaluatedAt = now;
  return evaluateShadowCandidateSnapshot({
    candidate,
    contexts: liveContexts,
    openedAt: new Date(now).toISOString(),
  });
}

export function listShadowCandidates() {
  return Object.values(CANDIDATES).map(({ candidateId, pairSet }) => ({ candidateId, pairSet }));
}
