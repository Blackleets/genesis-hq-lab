// RESEARCH_ONLY fixed-window adapter for synchronized H1 evidence.
// Wraps the existing OKX fallback but replaces variable-count taker flow with
// the validated causal 60s history-trades collector. Never places orders.

import { getOkxResearchContexts as getLegacyOkxResearchContexts } from './okxResearchContext.mjs';
import { fetchFixedWindowTaker } from './okxFixedWindowTaker.mjs';
import { derivePositioningDynamics } from './derivativesContext.mjs';

export const H1_TAKER_WINDOW_MS = 60_000;
export const H1_TAKER_MIN_COVERAGE_RATIO = 0.9;

export function fixedWindowTakerRows(snapshot) {
  if (!snapshot?.available) throw new Error(`fixed-window taker unavailable: ${snapshot?.reason ?? 'UNKNOWN'}`);
  const ratio = Number(snapshot.buySellRatio);
  const time = Number(snapshot.time);
  const coverageMs = Number(snapshot.coverageMs);
  const tradeCount = Number(snapshot.tradeCount);
  if (!Number.isFinite(ratio) || ratio < 0 || !Number.isFinite(time) || !Number.isFinite(coverageMs) || coverageMs < H1_TAKER_WINDOW_MS * H1_TAKER_MIN_COVERAGE_RATIO || !Number.isFinite(tradeCount) || tradeCount <= 0) {
    throw new Error('fixed-window taker provenance incomplete');
  }
  return [{
    time,
    buySellRatio: ratio,
    windowStartTime: Number(snapshot.windowStartTime),
    windowEndTime: Number(snapshot.windowEndTime),
    targetWindowMs: Number(snapshot.targetWindowMs),
    coverageMs,
    tradeCount,
    source: snapshot.source,
  }];
}

export async function getOkxResearchContexts(symbol = 'BTCUSDT', { points = 120, fetchImpl = fetch } = {}) {
  const [base, fixedTaker] = await Promise.all([
    getLegacyOkxResearchContexts(symbol, { points, fetchImpl }),
    fetchFixedWindowTaker('BTC-USDT-SWAP', {
      windowMs: H1_TAKER_WINDOW_MS,
      minimumCoverageRatio: H1_TAKER_MIN_COVERAGE_RATIO,
      fetchImpl,
    }),
  ]);

  const takerRows = fixedWindowTakerRows(fixedTaker);
  const positioning = derivePositioningDynamics(base.derivatives?.raw?.oi ?? [], takerRows);
  return {
    ...base,
    derivatives: {
      ...base.derivatives,
      ...positioning,
      takerWindowMs: H1_TAKER_WINDOW_MS,
      takerWindowCoverageMs: Number(fixedTaker.coverageMs),
      takerTradeCount: Number(fixedTaker.tradeCount),
      takerSource: fixedTaker.source,
      takerPagesFetched: Number(fixedTaker.pagesFetched),
      raw: { ...base.derivatives.raw, taker: takerRows },
    },
  };
}
