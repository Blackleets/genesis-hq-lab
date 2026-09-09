// RESEARCH_ONLY predeclared causal microstructure study.
// Reads durable synchronized snapshots only. No network, no orders, no promotion.

import fs from 'node:fs';

export const STUDY_VERSION = 1;
export const ROUND_TRIP_COST_BPS = 10; // 8 bps futures taker fees + 2 bps base slippage
export const MIN_FORWARD_MS = 10 * 60 * 1000;
export const MAX_FORWARD_MS = 25 * 60 * 1000;
export const MIN_OBSERVATIONS = 30;

function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

export function classifyHypothesis(state) {
  if (!state?.safeForResearch || !state?.crossCapture?.available) return null;
  const f = state.features ?? {};
  const c = state.crossCapture ?? {};
  const oi = finite(c.oiCrossCaptureChangePct);
  const taker = finite(f.takerBias);
  const takerDelta = finite(c.takerBiasCrossCaptureChange);
  const funding = finite(f.fundingRateNow);
  const premium = finite(f.premiumNowBps);
  const px = finite(f.perpCloseNow);
  if ([oi, taker, takerDelta, funding, premium, px].some(v => v === null)) return null;
  if (f.volatilityState === 'shock' || f.volatilityState === 'insufficient' || f.volatilityState === 'unknown') return null;

  // H1 LONG: fresh OI expansion + strengthening aggressive buys + non-positive basis,
  // without expensive positive funding. Thresholds are fixed before outcome observation.
  if (oi >= 0.02 && taker >= 1.20 && takerDelta >= 0.15 && premium <= 0 && funding <= 0.0002) return 'LONG';

  // Symmetric H1 SHORT.
  if (oi >= 0.02 && taker <= 0.83 && takerDelta <= -0.15 && premium >= 0 && funding >= -0.0002) return 'SHORT';
  return null;
}

export function pairForwardOutcome(states, index) {
  const entry = states[index];
  const entryMs = Date.parse(entry?.capturedAt ?? '');
  const entryPx = finite(entry?.features?.perpCloseNow);
  if (!Number.isFinite(entryMs) || entryPx === null || entryPx <= 0) return null;
  for (let j = index + 1; j < states.length; j += 1) {
    const candidate = states[j];
    if (candidate?.provider !== entry?.provider || candidate?.symbol !== entry?.symbol || !candidate?.safeForResearch) continue;
    const t = Date.parse(candidate?.capturedAt ?? '');
    const gap = t - entryMs;
    if (!Number.isFinite(gap) || gap < MIN_FORWARD_MS) continue;
    if (gap > MAX_FORWARD_MS) return null;
    const exitPx = finite(candidate?.features?.perpCloseNow);
    if (exitPx === null || exitPx <= 0) continue;
    return { exit: candidate, gapMs: gap, exitPx };
  }
  return null;
}

export function evaluateStudy(states = []) {
  const ordered = [...states].filter(Boolean).sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  const observations = [];
  for (let i = 0; i < ordered.length; i += 1) {
    const side = classifyHypothesis(ordered[i]);
    if (!side) continue;
    const paired = pairForwardOutcome(ordered, i);
    if (!paired) continue;
    const entryPx = finite(ordered[i].features.perpCloseNow);
    const grossMarketBps = ((paired.exitPx / entryPx) - 1) * 10000;
    const signedGrossBps = side === 'LONG' ? grossMarketBps : -grossMarketBps;
    const netBps = signedGrossBps - ROUND_TRIP_COST_BPS;
    observations.push({
      entryAt: ordered[i].capturedAt, exitAt: paired.exit.capturedAt, provider: ordered[i].provider,
      symbol: ordered[i].symbol, side, entryPx, exitPx: paired.exitPx, horizonMs: paired.gapMs,
      grossBps: signedGrossBps, costBps: ROUND_TRIP_COST_BPS, netBps,
    });
  }

  const n = observations.length;
  const wins = observations.filter(x => x.netBps > 0);
  const losses = observations.filter(x => x.netBps < 0);
  const avg = xs => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  const netValues = observations.map(x => x.netBps);
  const grossWin = wins.reduce((s, x) => s + x.netBps, 0);
  const grossLoss = losses.reduce((s, x) => s + Math.abs(x.netBps), 0);
  const result = {
    studyVersion: STUDY_VERSION,
    mode: 'RESEARCH_ONLY',
    predeclaredHypothesis: 'H1: OI expansion + directional taker acceleration + basis alignment, excluding volatility shock, predicts same-direction 10-25m perp return net of fixed costs.',
    thresholds: { oiCrossCaptureChangePctMin: 0.02, longTakerBiasMin: 1.20, shortTakerBiasMax: 0.83, takerDeltaAbsMin: 0.15, maxFundingAbs: 0.0002, roundTripCostBps: ROUND_TRIP_COST_BPS, forwardWindowMs: [MIN_FORWARD_MS, MAX_FORWARD_MS] },
    observationCount: n,
    sufficient: n >= MIN_OBSERVATIONS,
    minRequired: MIN_OBSERVATIONS,
    meanNetBps: avg(netValues),
    medianNetBps: n ? [...netValues].sort((a,b)=>a-b)[Math.floor(n/2)] : null,
    winRate: n ? wins.length / n : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : null),
    observations,
  };
  result.decision = !result.sufficient ? 'INSUFFICIENT_DATA' : (result.meanNetBps > 0 && result.profitFactor > 1 ? 'SURVIVES_INITIAL_SCREEN' : 'REJECT_H1');
  return result;
}

export function readJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
}

if (process.argv[1]?.endsWith('causalMicrostructureStudy.mjs')) {
  const args = process.argv.slice(2);
  const input = args[0];
  const outIndex = args.indexOf('--out');
  const out = outIndex >= 0 ? args[outIndex + 1] : null;
  const report = evaluateStudy(readJsonl(input));
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (out) fs.writeFileSync(out, text);
  console.log(text);
}
