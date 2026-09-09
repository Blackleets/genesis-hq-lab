// server/genesis/researchStateCapture.mjs
// RESEARCH_ONLY synchronized market-state capture for durable evidence.
//
// Purpose: persist funding, OI, taker flow, premium/basis and reference↔perp
// microstructure in one capture envelope with explicit source timestamps/ages.
// This module never places orders, promotes candidates, modifies REAL_TRADING,
// or changes fixed audit gates. Captures are evidence for later
// train/validation/walk-forward/untouched-holdout research only.

import fs from 'node:fs';
import path from 'node:path';
import { getContext } from './derivativesContext.mjs';
import { getSpotPerpLeadLagContext } from './spotPerpLeadLag.mjs';

function latestTime(rows = []) {
  const times = rows.map(row => Number(row?.time)).filter(Number.isFinite);
  return times.length ? Math.max(...times) : null;
}

function ageMs(capturedAtMs, sourceTime) {
  if (!Number.isFinite(sourceTime)) return null;
  return Math.max(0, capturedAtMs - sourceTime);
}

export function buildSynchronizedResearchState({
  symbol,
  capturedAt = new Date().toISOString(),
  derivatives,
  leadLag,
}) {
  const capturedAtMs = Date.parse(capturedAt);
  if (!Number.isFinite(capturedAtMs)) throw new Error('invalid capturedAt');

  const raw = derivatives?.raw ?? {};
  const sourceAsOf = {
    oi: latestTime(raw.oi),
    taker: latestTime(raw.taker),
    funding: latestTime(raw.funding),
    premium: latestTime(raw.premium),
    reference: latestTime(leadLag?.raw?.spot),
    perp: latestTime(leadLag?.raw?.perp),
  };

  const sourceAgeMs = Object.fromEntries(
    Object.entries(sourceAsOf).map(([key, value]) => [key, ageMs(capturedAtMs, value)]),
  );
  const futureSources = Object.entries(sourceAsOf)
    .filter(([, value]) => Number.isFinite(value) && value > capturedAtMs)
    .map(([key]) => key);
  const missingSources = Object.entries(sourceAsOf)
    .filter(([, value]) => !Number.isFinite(value))
    .map(([key]) => key);

  return {
    schemaVersion: 1,
    mode: 'RESEARCH_ONLY',
    symbol: String(symbol || derivatives?.symbol || leadLag?.symbol || '').toUpperCase(),
    capturedAt,
    safeForResearch: futureSources.length === 0 && missingSources.length === 0,
    referenceSource: leadLag?.referenceSource ?? 'unknown',
    sourceAsOf,
    sourceAgeMs,
    integrity: {
      missingSources,
      futureSources,
      noFutureData: futureSources.length === 0,
    },
    features: {
      oiUsdNow: derivatives?.oiUsdNow ?? null,
      oiChangePct: derivatives?.oiChangePct ?? null,
      oiRecentChangePct: derivatives?.oiRecentChangePct ?? null,
      oiAccelerationPct: derivatives?.oiAccelerationPct ?? null,
      takerBias: derivatives?.takerBias ?? null,
      takerRecentBias: derivatives?.takerRecentBias ?? null,
      takerImpulse: derivatives?.takerImpulse ?? null,
      takerPressure: derivatives?.takerPressure ?? 'unknown',
      takerReversal: derivatives?.takerReversal ?? false,
      crowdSide: derivatives?.crowdSide ?? 'unknown',
      crowdRatio: derivatives?.crowdRatio ?? null,
      fundingRateNow: derivatives?.fundingRateNow ?? null,
      fundingAvg: derivatives?.fundingAvg ?? null,
      fundingCrowd: derivatives?.fundingCrowd ?? 'unknown',
      premiumNowBps: derivatives?.premiumNowBps ?? null,
      premiumRecentAvgBps: derivatives?.premiumRecentAvgBps ?? null,
      premiumImpulseBps: derivatives?.premiumImpulseBps ?? null,
      spreadNowBps: leadLag?.spreadNowBps ?? null,
      spreadAvgBps: leadLag?.spreadAvgBps ?? null,
      spreadVolBps: leadLag?.spreadVolBps ?? null,
      returnCorr0: leadLag?.returnCorr0 ?? null,
      bestLagBars: leadLag?.bestLagBars ?? null,
      bestLagCorr: leadLag?.bestLagCorr ?? null,
      leader: leadLag?.leader ?? 'unknown',
      latestReturnDivergenceBps: leadLag?.latestReturnDivergenceBps ?? null,
    },
  };
}

export async function captureResearchState(symbol = 'BTCUSDT', {
  out,
  jsonl,
  interval = '1m',
  leadLagPoints = 120,
} = {}) {
  const normalizedSymbol = String(symbol).toUpperCase();
  const capturedAt = new Date().toISOString();
  const [derivatives, leadLag] = await Promise.all([
    getContext(normalizedSymbol),
    getSpotPerpLeadLagContext(normalizedSymbol, { interval, points: leadLagPoints }),
  ]);
  const state = buildSynchronizedResearchState({ symbol: normalizedSymbol, capturedAt, derivatives, leadLag });

  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(state, null, 2)}\n`);
  }
  if (jsonl) {
    fs.mkdirSync(path.dirname(jsonl), { recursive: true });
    fs.appendFileSync(jsonl, `${JSON.stringify(state)}\n`);
  }
  return state;
}

if (process.argv[1] && process.argv[1].endsWith('researchStateCapture.mjs')) {
  const args = process.argv.slice(2);
  const symbol = (args.find(arg => !arg.startsWith('--')) || 'BTCUSDT').toUpperCase();
  const valueAfter = flag => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  captureResearchState(symbol, {
    out: valueAfter('--out'),
    jsonl: valueAfter('--jsonl'),
  }).then(state => console.log(JSON.stringify(state, null, 2)))
    .catch(error => { console.error('ERROR:', error.message); process.exitCode = 1; });
}
