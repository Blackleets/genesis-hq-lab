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
  oi: 15 * 60 * 1000, taker: 2 * 60 * 60 * 1000, funding: 12 * 60 * 60 * 1000,
  premium: 2 * 60 * 60 * 1000, reference: 5 * 60 * 1000, perp: 5 * 60 * 1000,
  volatility: 5 * 60 * 1000,
});
export const MAX_CROSS_CAPTURE_GAP_MS = 60 * 60 * 1000;
function latestTime(rows = []) { const times = rows.map(row => Number(row?.time)).filter(Number.isFinite); return times.length ? Math.max(...times) : null; }
function latestClose(rows = []) { const valid = rows.map(row => ({ time: Number(row?.time), close: Number(row?.close) })).filter(row => Number.isFinite(row.time) && Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.time - b.time); return valid.at(-1)?.close ?? null; }
function ageMs(capturedAtMs, sourceTime) { if (!Number.isFinite(sourceTime)) return null; return Math.max(0, capturedAtMs - sourceTime); }
function finite(value) { const n = Number(value); return Number.isFinite(n) ? n : null; }
function pctChange(now, prev) { const a = finite(now); const b = finite(prev); return a !== null && b !== null && b !== 0 ? ((a / b) - 1) * 100 : null; }
function difference(now, prev) { const a = finite(now); const b = finite(prev); return a !== null && b !== null ? a - b : null; }

export function buildSynchronizedResearchState({ symbol, capturedAt = new Date().toISOString(), derivatives, leadLag, sourceErrors = {}, provider = 'binance' }) {
  const capturedAtMs = Date.parse(capturedAt); if (!Number.isFinite(capturedAtMs)) throw new Error('invalid capturedAt');
  const raw = derivatives?.raw ?? {};
  const sourceAsOf = { oi: latestTime(raw.oi), taker: latestTime(raw.taker), funding: latestTime(raw.funding), premium: latestTime(raw.premium), reference: latestTime(leadLag?.raw?.spot), perp: latestTime(leadLag?.raw?.perp) };
  if (Array.isArray(raw.volatility)) sourceAsOf.volatility = latestTime(raw.volatility);
  const sourceAgeMs = Object.fromEntries(Object.entries(sourceAsOf).map(([key, value]) => [key, ageMs(capturedAtMs, value)]));
  const futureSources = Object.entries(sourceAsOf).filter(([, value]) => Number.isFinite(value) && value > capturedAtMs).map(([key]) => key);
  const missingSources = Object.entries(sourceAsOf).filter(([, value]) => !Number.isFinite(value)).map(([key]) => key);
  const staleSources = Object.entries(sourceAgeMs).filter(([key, value]) => Number.isFinite(value) && Number.isFinite(SOURCE_FRESHNESS_BUDGET_MS[key]) && value > SOURCE_FRESHNESS_BUDGET_MS[key]).map(([key]) => key);
  const errorSources = Object.keys(sourceErrors);
  return {
    schemaVersion: 5, mode: 'RESEARCH_ONLY', provider, symbol: String(symbol || derivatives?.symbol || leadLag?.symbol || '').toUpperCase(), capturedAt,
    safeForResearch: futureSources.length === 0 && missingSources.length === 0 && staleSources.length === 0 && errorSources.length === 0,
    referenceSource: leadLag?.referenceSource ?? 'unknown', sourceAsOf, sourceAgeMs, sourceFreshnessBudgetMs: SOURCE_FRESHNESS_BUDGET_MS,
    integrity: { missingSources, futureSources, staleSources, errorSources, sourceErrors, noFutureData: futureSources.length === 0, allSourcesFresh: staleSources.length === 0 },
    features: {
      perpCloseNow: latestClose(leadLag?.raw?.perp),
      oiUsdNow: derivatives?.oiUsdNow ?? null, oiChangePct: derivatives?.oiChangePct ?? null, oiRecentChangePct: derivatives?.oiRecentChangePct ?? null, oiAccelerationPct: derivatives?.oiAccelerationPct ?? null,
      takerBias: derivatives?.takerBias ?? null, takerRecentBias: derivatives?.takerRecentBias ?? null, takerImpulse: derivatives?.takerImpulse ?? null, takerPressure: derivatives?.takerPressure ?? 'unknown', takerReversal: derivatives?.takerReversal ?? false,
      crowdSide: derivatives?.crowdSide ?? 'unknown', crowdRatio: derivatives?.crowdRatio ?? null, fundingRateNow: derivatives?.fundingRateNow ?? null, fundingAvg: derivatives?.fundingAvg ?? null, fundingCrowd: derivatives?.fundingCrowd ?? 'unknown',
      premiumNowBps: derivatives?.premiumNowBps ?? null, premiumRecentAvgBps: derivatives?.premiumRecentAvgBps ?? null, premiumImpulseBps: derivatives?.premiumImpulseBps ?? null,
      volatilityBarCount: derivatives?.volatilityBarCount ?? null, realizedVolShortBps: derivatives?.realizedVolShortBps ?? null, realizedVolLongBps: derivatives?.realizedVolLongBps ?? null,
      volatilityExpansionRatio: derivatives?.volatilityExpansionRatio ?? null, latestRangeBps: derivatives?.latestRangeBps ?? null, rangeShockRatio: derivatives?.rangeShockRatio ?? null,
      volumeShockRatio: derivatives?.volumeShockRatio ?? null, maxAbsReturnBpsShort: derivatives?.maxAbsReturnBpsShort ?? null, volatilityState: derivatives?.volatilityState ?? 'unknown',
      spreadNowBps: leadLag?.spreadNowBps ?? null, spreadAvgBps: leadLag?.spreadAvgBps ?? null, spreadVolBps: leadLag?.spreadVolBps ?? null, returnCorr0: leadLag?.returnCorr0 ?? null,
      bestLagBars: leadLag?.bestLagBars ?? null, bestLagCorr: leadLag?.bestLagCorr ?? null, leader: leadLag?.leader ?? 'unknown', latestReturnDivergenceBps: leadLag?.latestReturnDivergenceBps ?? null,
    },
  };
}

export function deriveCrossCaptureFeatures(current, previous) {
  const currentMs = Date.parse(current?.capturedAt ?? '');
  const previousMs = Date.parse(previous?.capturedAt ?? '');
  const gapMs = currentMs - previousMs;
  const compatible = Boolean(
    current?.safeForResearch && previous?.safeForResearch &&
    current?.provider && current.provider === previous?.provider &&
    current?.symbol && current.symbol === previous?.symbol &&
    Number.isFinite(gapMs) && gapMs > 0 && gapMs <= MAX_CROSS_CAPTURE_GAP_MS
  );
  if (!compatible) return {
    available: false, previousCapturedAt: previous?.capturedAt ?? null, gapMs: Number.isFinite(gapMs) ? gapMs : null,
    oiCrossCaptureChangePct: null, takerBiasCrossCaptureChange: null, fundingCrossCaptureDeltaBps: null,
    premiumCrossCaptureDeltaBps: null, spreadCrossCaptureDeltaBps: null,
  };
  return {
    available: true, previousCapturedAt: previous.capturedAt, gapMs,
    oiCrossCaptureChangePct: pctChange(current?.features?.oiUsdNow, previous?.features?.oiUsdNow),
    takerBiasCrossCaptureChange: difference(current?.features?.takerBias, previous?.features?.takerBias),
    fundingCrossCaptureDeltaBps: difference(finite(current?.features?.fundingRateNow) * 10000, finite(previous?.features?.fundingRateNow) * 10000),
    premiumCrossCaptureDeltaBps: difference(current?.features?.premiumNowBps, previous?.features?.premiumNowBps),
    spreadCrossCaptureDeltaBps: difference(current?.features?.spreadNowBps, previous?.features?.spreadNowBps),
  };
}

function readPreviousCompatibleState(jsonl, current) {
  if (!jsonl || !fs.existsSync(jsonl)) return null;
  const lines = fs.readFileSync(jsonl, 'utf8').split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const candidate = JSON.parse(lines[i]);
      if (candidate?.provider === current?.provider && candidate?.symbol === current?.symbol && candidate?.safeForResearch) return candidate;
    } catch { /* append-only tape may contain an incomplete final line after interruption; ignore it */ }
  }
  return null;
}
function messageOf(reason) { return reason instanceof Error ? reason.message : String(reason ?? 'unknown error'); }

export async function captureResearchState(symbol = 'BTCUSDT', { out, jsonl, interval = '1m', leadLagPoints = 120 } = {}) {
  const normalizedSymbol = String(symbol).toUpperCase();
  const [derivativesResult, leadLagResult] = await Promise.allSettled([getContext(normalizedSymbol), getSpotPerpLeadLagContext(normalizedSymbol, { interval, points: leadLagPoints })]);
  let derivatives = derivativesResult.status === 'fulfilled' ? derivativesResult.value : null;
  let leadLag = leadLagResult.status === 'fulfilled' ? leadLagResult.value : null;
  let provider = 'binance'; const sourceErrors = {};
  if (derivativesResult.status === 'rejected') sourceErrors.derivatives = messageOf(derivativesResult.reason);
  if (leadLagResult.status === 'rejected') sourceErrors.leadLag = messageOf(leadLagResult.reason);
  if (!derivatives || !leadLag) {
    try {
      const fallback = await getOkxResearchContexts(normalizedSymbol, { points: leadLagPoints });
      derivatives = fallback.derivatives; leadLag = fallback.leadLag; provider = fallback.provider;
      for (const key of Object.keys(sourceErrors)) delete sourceErrors[key];
    } catch (error) { sourceErrors.okxFallback = messageOf(error); }
  }
  // Capture time is the envelope close, not acquisition start. This preserves strict
  // no-future-data semantics without misclassifying observations received during network I/O.
  const capturedAt = new Date().toISOString();
  const state = buildSynchronizedResearchState({ symbol: normalizedSymbol, capturedAt, derivatives, leadLag, sourceErrors, provider });
  const previous = readPreviousCompatibleState(jsonl, state);
  state.crossCapture = deriveCrossCaptureFeatures(state, previous);
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, `${JSON.stringify(state, null, 2)}\n`); }
  if (jsonl) { fs.mkdirSync(path.dirname(jsonl), { recursive: true }); fs.appendFileSync(jsonl, `${JSON.stringify(state)}\n`); }
  return state;
}

if (process.argv[1] && process.argv[1].endsWith('researchStateCapture.mjs')) {
  const args = process.argv.slice(2); const symbol = (args.find(arg => !arg.startsWith('--')) || 'BTCUSDT').toUpperCase();
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  captureResearchState(symbol, { out: valueAfter('--out'), jsonl: valueAfter('--jsonl') }).then(state => console.log(JSON.stringify(state, null, 2))).catch(error => { console.error('ERROR:', error.message); process.exitCode = 1; });
}
