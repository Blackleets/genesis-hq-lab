// server/genesis/researchStateCapture.mjs
// RESEARCH_ONLY synchronized market-state capture for durable evidence.
// Binance remains primary; OKX is a validated public-data fallback when primary access fails.
// Never places orders, promotes candidates, modifies REAL_TRADING, or changes audit gates.

import fs from 'node:fs';
import path from 'node:path';
import { getContext } from './derivativesContext.mjs';
import { getSpotPerpLeadLagContext } from './spotPerpLeadLag.mjs';
import { getOkxResearchContexts } from './okxResearchContext.mjs';

export const SOURCE_FRESHNESS_BUDGET_MS = Object.freeze({
  oi: 15 * 60 * 1000,
  taker: 2 * 60 * 60 * 1000,
  funding: 12 * 60 * 60 * 1000,
  premium: 2 * 60 * 60 * 1000,
  reference: 5 * 60 * 1000,
  perp: 5 * 60 * 1000,
});

function latestTime(rows = []) {
  const times = rows.map(row => Number(row?.time)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}
function ageMs(capturedAtMs, sourceTime) {
  if (!Number.isFinite(sourceTime)) return null;
  return Math.max(0, capturedAtMs - sourceTime);
}

export function buildSynchronizedResearchState({ symbol, capturedAt = new Date().toISOString(), derivatives, leadLag, sourceErrors = {}, provider = 'binance' }) {
  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) throw new Error('invalid capturedAt');
  const raw = derivatives?.raw ?? {};
  const sourceAsOf = {
    oi: latestTime(raw.oi), taker: latestTime(raw.taker), funding: latestTime(raw.funding), premium: latestTime(raw.premium),
    reference: latestTime(leadLag?.raw?.spot), perp: latestTime(leadLag?.raw?.perp),
  };
  const sourceAgeMs = Object.fromEntries(Object.entries(sourceAsOf).map(([key, value]) => [key, ageMs(capturedAtMs, value)]));
  const futureSources = Object.entries(sourceAsOf).filter(([, value]) => Number.isFinite(value) && value > capturedAtMs).map(([key]) => key);
  const missingSources = Object.entries(sourceAsOf).filter(([, value]) => !Number.isFinite(value)).map(([key]) => key);
  const staleSources = Object.entries(sourceAgeMs).filter(([key, value]) => Number.isFinite(value) && Number.isFinite(SOURCE_FRESHNESS_BUDGET_MS[key]) && value > SOURCE_FRESHNESS_BUDGET_MS[key]).map(([key]) => key);
  const errorSources = Object.keys(sourceErrors);
  return {
    schemaVersion: 2, mode: 'RESEARCH_ONLY', provider,
    symbol: String(symbol || derivatives?.symbol || leadLag?.symbol || '').toUpperCase(), capturedAt,
    safeForResearch: futureSources.length === 0 && missingSources.length === 0 && staleSources.length === 0 && errorSources.length === 0,
    referenceSource: leadLag?.referenceSource ?? 'unknown', sourceAsOf, sourceAgeMs, sourceFreshnessBudgetMs: SOURCE_FRESHNESS_BUDGET_MS,
    integrity: { missingSources, futureSources, staleSources, errorSources, sourceErrors, noFutureData: futureSources.length === 0, allSourcesFresh: staleSources.length === 0 },
    features: {
      oiUsdNow: derivatives?.oiUsdNow ?? null, oiChangePct: derivatives?.oiChangePct ?? null, oiRecentChangePct: derivatives?.oiRecentChangePct ?? null,
      oiAccelerationPct: derivatives?.oiAccelerationPct ?? null, takerBias: derivatives?.takerBias ?? null, takerRecentBias: derivatives?.takerRecentBias ?? null,
      takerImpulse: derivatives?.takerImpulse ?? null, takerPressure: derivatives?.takerPressure ?? 'unknown', takerReversal: derivatives?.takerReversal ?? false,
      crowdSide: derivatives?.crowdSide ?? 'unknown', crowdRatio: derivatives?.crowdRatio ?? null, fundingRateNow: derivatives?.fundingRateNow ?? null,
      fundingAvg: derivatives?.fundingAvg ?? null, fundingCrowd: derivatives?.fundingCrowd ?? 'unknown', premiumNowBps: derivatives?.premiumNowBps ?? null,
      premiumRecentAvgBps: derivatives?.premiumRecentAvgBps ?? null, premiumImpulseBps: derivatives?.premiumImpulseBps ?? null, spreadNowBps: leadLag?.spreadNowBps ?? null,
      spreadAvgBps: leadLag?.spreadAvgBps ?? null, spreadVolBps: leadLag?.spreadVolBps ?? null, returnCorr0: leadLag?.returnCorr0 ?? null,
      bestLagBars: leadLag?.bestLagBars ?? null, bestLagCorr: leadLag?.bestLagCorr ?? null, leader: leadLag?.leader ?? 'unknown', latestReturnDivergenceBps: leadLag?.latestReturnDivergenceBps ?? null,
    },
  };
}

function messageOf(reason) { return reason instanceof Error ? reason.message : String(reason ?? 'unknown error'); }

export async function captureResearchState(symbol = 'BTCUSDT', { out, jsonl, interval = '1m', leadLagPoints = 120 } = {}) {
  const normalizedSymbol = String(symbol).toUpperCase();
  const capturedAt = new Date().toISOString();
  const [derivativesResult, leadLagResult] = await Promise.allSettled([
    getContext(normalizedSymbol), getSpotPerpLeadLagContext(normalizedSymbol, { interval, points: leadLagPoints }),
  ]);

  let derivatives = derivativesResult.status === 'fulfilled' ? derivativesResult.value : null;
  let leadLag = leadLagResult.status === 'fulfilled' ? leadLagResult.value : null;
  let provider = 'binance';
  const sourceErrors = {};
  if (derivativesResult.status === 'rejected') sourceErrors.derivatives = messageOf(derivativesResult.reason);
  if (leadLagResult.status === 'rejected') sourceErrors.leadLag = messageOf(leadLagResult.reason);

  // Fail over only when the primary synchronized inputs are unavailable. Never mix venues
  // inside one state: a fallback snapshot is wholly OKX and explicitly labeled.
  if (!derivatives || !leadLag) {
    try {
      const fallback = await getOkxResearchContexts(normalizedSymbol, { points: leadLagPoints });
      derivatives = fallback.derivatives;
      leadLag = fallback.leadLag;
      provider = fallback.provider;
      for (const key of Object.keys(sourceErrors)) delete sourceErrors[key];
    } catch (error) {
      sourceErrors.okxFallback = messageOf(error);
    }
  }

  const state = buildSynchronizedResearchState({ symbol: normalizedSymbol, capturedAt, derivatives, leadLag, sourceErrors, provider });
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(state, null, 2)}\n`); }
  if (jsonl) { fs.mkdirSync(path.dirname(jsonl), { recursive: true }); fs.appendFileSync(jsonl, `${JSON.stringify(state)}\n`); }
  return state;
}

if (process.argv[1] && process.argv[1].endsWith('researchStateCapture.mjs')) {
  const args = process.argv.slice(2); const symbol = (args.find(arg => !arg.startsWith('--')) || 'BTCUSDT').toUpperCase();
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  captureResearchState(symbol, { out: valueAfter('--out'), jsonl: valueAfter('--jsonl') })
    .then(state => console.log(JSON.stringify(state, null, 2))).catch(error => { console.error('ERROR:', error.message); process.exitCode = 1; });
}
