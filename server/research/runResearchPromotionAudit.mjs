// RESEARCH_ONLY promotion auditor for Positioning + Cross-Market research lanes.
// Exactly one pre-holdout champion per active cohort may open holdout once.
// Passing audit creates FORWARD_PAPER_ELIGIBLE evidence only; never execution authority.

import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'research_promotion_audit_v1';
const LEDGER_VERSION = 'research_promotion_ledger_v1';
const POSITIONING_FACTORY_VERSION = 'positioning_edge_factory_v6_active_cohort';
const CROSS_MARKET_VERSION = 'cross_market_lead_lag_v2_active_cohort';
const SYMBOLS = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']);
const ALT_SYMBOLS = Object.freeze(['ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']);
const BASE_COST_BPS = 12;
const STRESS_COST_BPS = 18;
const MIN_AUDIT_SAMPLES = 80;
const HOLDOUT_FRACTION = 0.2;
const MIN_HOLDOUT_TRADES = 5;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function timeMs(row) { const n = Date.parse(row?.capturedAt); return Number.isFinite(n) ? n : null; }
function boundaryMs(value) { if (!value) return null; const n = Date.parse(value); return Number.isFinite(n) ? n : null; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function std(xs) { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function readJsonl(file) { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }

function metrics(returnsBps = []) {
  if (!returnsBps.length) return { trades: 0, expectancyBps: null, profitFactor: null, tStat: null, maxDrawdownPct: null };
  const wins = returnsBps.filter(x => x > 0), losses = returnsBps.filter(x => x < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0), grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const expectancy = mean(returnsBps), sd = std(returnsBps);
  let equity = 0, peak = 0, maxDd = 0;
  for (const r of returnsBps) { equity += r / 100; peak = Math.max(peak, equity); maxDd = Math.max(maxDd, peak - equity); }
  return {
    trades: returnsBps.length,
    expectancyBps: expectancy,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    tStat: sd && sd > 0 ? expectancy / (sd / Math.sqrt(returnsBps.length)) : null,
    maxDrawdownPct: maxDd,
  };
}

export function stressAdjustedExpectancy(expectancyBps, fromCostBps = BASE_COST_BPS, toCostBps = STRESS_COST_BPS) {
  const value = finite(expectancyBps);
  if (value === null) return null;
  return value - Math.max(0, Number(toCostBps) - Number(fromCostBps));
}

function researchCandidateScore(candidate, baseCostBps = BASE_COST_BPS, stressCostBps = STRESS_COST_BPS) {
  const train = stressAdjustedExpectancy(candidate?.train?.expectancyBps, baseCostBps, stressCostBps);
  const validation = stressAdjustedExpectancy(candidate?.validation?.expectancyBps, baseCostBps, stressCostBps);
  if (train === null || validation === null) return -Infinity;
  return Math.min(train, validation);
}

export function preAuditGate(candidate, { baseCostBps = BASE_COST_BPS, stressCostBps = STRESS_COST_BPS } = {}) {
  if (candidate?.status !== 'RESEARCH_CANDIDATE') return { pass: false, reason: 'NOT_RESEARCH_CANDIDATE' };
  const trainTrades = Number(candidate?.train?.trades ?? 0), validationTrades = Number(candidate?.validation?.trades ?? 0);
  if (trainTrades < 8 || validationTrades < 4) return { pass: false, reason: 'RESEARCH_SAMPLE_THIN' };
  if ((finite(candidate?.train?.profitFactor) ?? 0) < 1.1 || (finite(candidate?.validation?.profitFactor) ?? 0) < 1.1) return { pass: false, reason: 'RESEARCH_PF_WEAK' };
  const trainStress = stressAdjustedExpectancy(candidate?.train?.expectancyBps, baseCostBps, stressCostBps);
  const validationStress = stressAdjustedExpectancy(candidate?.validation?.expectancyBps, baseCostBps, stressCostBps);
  if ((trainStress ?? -Infinity) <= 0 || (validationStress ?? -Infinity) <= 0) return { pass: false, reason: 'FAILS_18BPS_EXPECTANCY_STRESS', trainStress, validationStress };
  return { pass: true, reason: null, trainStress, validationStress };
}

export function selectLaneChampion(candidates = [], options = {}) {
  const eligible = candidates
    .map(candidate => ({ candidate, gate: preAuditGate(candidate, options), score: researchCandidateScore(candidate, options.baseCostBps, options.stressCostBps) }))
    .filter(item => item.gate.pass)
    .sort((a, b) => b.score - a.score || String(a.candidate.family).localeCompare(String(b.candidate.family)));
  return eligible[0] ?? null;
}

export function auditGate(base, stressed) {
  if ((base?.trades ?? 0) < MIN_HOLDOUT_TRADES) return { pass: false, reason: 'HOLDOUT_SAMPLE_THIN' };
  if ((base?.expectancyBps ?? -Infinity) <= 0) return { pass: false, reason: 'HOLDOUT_EXPECTANCY_NONPOSITIVE' };
  if ((base?.profitFactor ?? 0) < 1.1) return { pass: false, reason: 'HOLDOUT_PF_WEAK' };
  if ((base?.tStat ?? -Infinity) < 0.5) return { pass: false, reason: 'HOLDOUT_TSTAT_WEAK' };
  if ((base?.maxDrawdownPct ?? Infinity) > 5) return { pass: false, reason: 'HOLDOUT_DRAWDOWN_HIGH' };
  if ((stressed?.expectancyBps ?? -Infinity) <= 0 || (stressed?.profitFactor ?? 0) < 1.0) return { pass: false, reason: 'HOLDOUT_18BPS_STRESS_FAIL' };
  return { pass: true, reason: null };
}

function validPositioningRow(row, symbol, { minCapturedAt = null, maxCapturedAt = null, requireCrossCapture = true } = {}) {
  const min = boundaryMs(minCapturedAt), max = boundaryMs(maxCapturedAt), t = timeMs(row);
  return row?.mode === 'RESEARCH_ONLY'
    && row?.provider === 'okx_public_market_data'
    && row?.schemaVersion === 4
    && row?.symbol === symbol
    && Number.isFinite(t)
    && (min === null || t >= min)
    && (max === null || t <= max)
    && (!requireCrossCapture || row?.crossCapture?.available === true)
    && finite(row?.price?.close) > 0;
}

function takerWindowMs(row) { return finite(row?.positioning?.takerWindowMs) ?? finite(row?.provenance?.takerWindowMs); }

function independentRows(rows, maxGapMinutes = 60) {
  const selected = [];
  for (const row of rows) {
    const prior = selected.at(-1);
    if (!prior) { selected.push(row); continue; }
    const elapsed = timeMs(row) - timeMs(prior);
    const required = Math.max(takerWindowMs(prior) ?? 0, takerWindowMs(row) ?? 0);
    if (elapsed >= required && elapsed <= maxGapMinutes * 60_000) selected.push(row);
  }
  return selected;
}

function temporalPositioningSamples(rows, { maxForwardLabelGapMinutes = 30 } = {}) {
  const xs = independentRows(rows);
  const samples = [];
  for (let i = 0; i < xs.length - 1; i += 1) {
    const current = xs[i], next = xs[i + 1], elapsed = timeMs(next) - timeMs(current);
    if (!(elapsed > 0 && elapsed <= maxForwardLabelGapMinutes * 60_000)) continue;
    const p0 = finite(current?.price?.close), p1 = finite(next?.price?.close);
    if (!(p0 > 0 && p1 > 0)) continue;
    samples.push({ row: current, nextReturnBps: Math.log(p1 / p0) * 10_000 });
  }
  return samples;
}

function eligibleDivergenceRows(rows, symbol) {
  return rows.filter(row => row?.mode === 'RESEARCH_ONLY'
    && row?.provider === 'okx_public_market_data'
    && row?.symbol === symbol
    && row?.schemaVersion === 1
    && row?.provenance?.fixedWindow === true
    && row?.provenance?.rawSpotVsPerpSizeComparisonForbidden === true
    && (finite(row?.spot?.coverageMs) ?? 0) >= 54_000
    && (finite(row?.perpetual?.coverageMs) ?? 0) >= 54_000
    && Number.isFinite(timeMs(row))
    && finite(row?.divergence?.perpMinusSpotNotionalBuyFraction) !== null)
    .sort((a, b) => timeMs(a) - timeMs(b));
}

function joinPositioningDivergence(rows, divergenceRows, symbol, maxAgeMs = 30_000) {
  const ds = eligibleDivergenceRows(divergenceRows, symbol);
  let j = 0, latest = null;
  return rows.map(row => {
    const t = timeMs(row);
    while (j < ds.length && timeMs(ds[j]) <= t) { latest = ds[j]; j += 1; }
    const age = latest ? t - timeMs(latest) : null;
    const usable = latest && age >= 0 && age <= maxAgeMs;
    return {
      ...row,
      researchFeatures: {
        ...(row.researchFeatures ?? {}),
        spotPerpTakerDivergence: usable ? finite(latest.divergence.perpMinusSpotNotionalBuyFraction) : null,
        spotPerpTakerDivergenceCausal: Boolean(usable),
      },
    };
  });
}

const POSITIONING_FAMILIES = Object.freeze({
  funding_oi_taker_reversal: {
    signal: r => Math.abs(finite(r.positioning?.fundingRateNow) ?? 0) >= 0.0001 && (finite(r.crossCapture?.oiChangePct) ?? 0) > 0 && Math.abs(finite(r.crossCapture?.takerBuySellRatioDelta) ?? 0) >= 0.1,
    direction: r => (finite(r.crossCapture?.takerBuySellRatioDelta) ?? 0) < 0 ? -1 : 1,
  },
  funding_price_disagreement: {
    signal: r => { const f = finite(r.positioning?.fundingRateNow), ret = finite(r.crossCapture?.perpReturnBps); return f !== null && ret !== null && Math.abs(f) >= 0.00005 && Math.abs(ret) >= 5 && Math.sign(f) === Math.sign(ret); },
    direction: r => -Math.sign(finite(r.crossCapture?.perpReturnBps) ?? 0),
  },
  oi_shock_failed_continuation: {
    signal: r => (finite(r.crossCapture?.oiChangePct) ?? 0) > 0.15 && Math.abs(finite(r.crossCapture?.perpReturnBps) ?? 0) >= 5 && Math.sign(finite(r.crossCapture?.perpReturnBps) ?? 0) !== Math.sign(finite(r.crossCapture?.takerBuySellRatioDelta) ?? 0),
    direction: r => Math.sign(finite(r.crossCapture?.takerBuySellRatioDelta) ?? 0),
  },
  taker_reversal_after_vol_expansion: {
    signal: r => (finite(r.positioning?.volatilityExpansionRatio) ?? 0) >= 1.2 && Math.abs(finite(r.crossCapture?.takerBuySellRatioDelta) ?? 0) >= 0.12,
    direction: r => Math.sign(finite(r.crossCapture?.takerBuySellRatioDelta) ?? 0),
  },
  spot_perp_taker_divergence_continuation: {
    signal: r => r.researchFeatures?.spotPerpTakerDivergenceCausal === true && Math.abs(finite(r.researchFeatures?.spotPerpTakerDivergence) ?? 0) >= 0.15,
    direction: r => Math.sign(finite(r.researchFeatures?.spotPerpTakerDivergence) ?? 0),
  },
});

const CROSS_FAMILIES = Object.freeze({
  btc_momentum_leads_alt: {
    signal: s => Math.abs(finite(s.btc?.crossCapture?.perpReturnBps) ?? 0) >= 8,
    direction: s => Math.sign(finite(s.btc?.crossCapture?.perpReturnBps) ?? 0),
  },
  btc_taker_impulse_leads_alt: {
    signal: s => Math.abs(finite(s.btc?.crossCapture?.takerBuySellRatioDelta) ?? 0) >= 0.1,
    direction: s => Math.sign(finite(s.btc?.crossCapture?.takerBuySellRatioDelta) ?? 0),
  },
  btc_oi_expansion_momentum: {
    signal: s => (finite(s.btc?.crossCapture?.oiChangePct) ?? 0) > 0.1 && Math.abs(finite(s.btc?.crossCapture?.perpReturnBps) ?? 0) >= 8,
    direction: s => Math.sign(finite(s.btc?.crossCapture?.perpReturnBps) ?? 0),
  },
  btc_price_taker_disagreement_reversal: {
    signal: s => { const ret = finite(s.btc?.crossCapture?.perpReturnBps), taker = finite(s.btc?.crossCapture?.takerBuySellRatioDelta); return ret !== null && taker !== null && Math.abs(ret) >= 8 && Math.abs(taker) >= 0.1 && Math.sign(ret) !== Math.sign(taker); },
    direction: s => -Math.sign(finite(s.btc?.crossCapture?.perpReturnBps) ?? 0),
  },
});

function partitionHoldout(samples) {
  const count = Math.max(1, Math.floor(samples.length * HOLDOUT_FRACTION));
  return samples.slice(samples.length - count);
}

function evaluatePositioningHoldout({ rows, divergenceRows = [], quality, symbol, familyId }, costBps) {
  const family = POSITIONING_FAMILIES[familyId];
  if (!family) throw new Error(`UNKNOWN_POSITIONING_FAMILY:${familyId}`);
  const active = rows.filter(row => validPositioningRow(row, symbol, {
    minCapturedAt: quality.firstEligibleCapturedAt,
    maxCapturedAt: quality.lastEligibleCapturedAt,
  })).sort((a, b) => timeMs(a) - timeMs(b));
  const joined = symbol === 'BTCUSDT' ? joinPositioningDivergence(active, divergenceRows, symbol) : active;
  const samples = temporalPositioningSamples(joined);
  const holdout = partitionHoldout(samples);
  return { usableSamples: samples.length, sealedHoldoutSamples: holdout.length, metrics: metrics(holdout.filter(s => family.signal(s.row)).map(s => family.direction(s.row) * s.nextReturnBps - costBps)) };
}

function alignBtcToAlt(btcRows, altRows, btcQuality, altQuality, altSymbol, { maxLeaderAgeMinutes = 8, maxAltForwardMinutes = 30 } = {}) {
  const btc = btcRows.filter(row => validPositioningRow(row, 'BTCUSDT', { minCapturedAt: btcQuality.firstEligibleCapturedAt, maxCapturedAt: btcQuality.lastEligibleCapturedAt, requireCrossCapture: false })).sort((a, b) => timeMs(a) - timeMs(b));
  const alt = altRows.filter(row => validPositioningRow(row, altSymbol, { minCapturedAt: altQuality.firstEligibleCapturedAt, maxCapturedAt: altQuality.lastEligibleCapturedAt, requireCrossCapture: false })).sort((a, b) => timeMs(a) - timeMs(b));
  const samples = [];
  let j = 0, latestBtc = null;
  for (let i = 0; i < alt.length - 1; i += 1) {
    const current = alt[i], next = alt[i + 1], currentTime = timeMs(current);
    while (j < btc.length && timeMs(btc[j]) <= currentTime) { latestBtc = btc[j]; j += 1; }
    if (!latestBtc) continue;
    const leaderAge = (currentTime - timeMs(latestBtc)) / 60_000, forwardMinutes = (timeMs(next) - currentTime) / 60_000;
    if (!(leaderAge >= 0 && leaderAge <= maxLeaderAgeMinutes && forwardMinutes > 0 && forwardMinutes <= maxAltForwardMinutes)) continue;
    const p0 = finite(current.price?.close), p1 = finite(next.price?.close);
    if (!(p0 > 0 && p1 > 0)) continue;
    samples.push({ btc: latestBtc, alt: current, nextAltReturnBps: Math.log(p1 / p0) * 10_000 });
  }
  return samples;
}

function evaluateCrossHoldout({ btcRows, altRows, btcQuality, altQuality, altSymbol, familyId }, costBps) {
  const family = CROSS_FAMILIES[familyId];
  if (!family) throw new Error(`UNKNOWN_CROSS_FAMILY:${familyId}`);
  const samples = alignBtcToAlt(btcRows, altRows, btcQuality, altQuality, altSymbol);
  const holdout = partitionHoldout(samples);
  return { usableSamples: samples.length, sealedHoldoutSamples: holdout.length, metrics: metrics(holdout.filter(family.signal).map(s => family.direction(s) * s.nextAltReturnBps - costBps)) };
}

function positioningPaths(root, symbol) {
  if (symbol === 'BTCUSDT') return {
    edge: path.join(root, 'quant-evidence/positioning-edge-factory-latest.json'),
    rows: path.join(root, 'paper-tape/positioning-dynamics.jsonl'),
    quality: path.join(root, 'paper-tape/positioning-data-quality-latest.json'),
    divergence: path.join(root, 'paper-tape/spot-perp-taker-divergence.jsonl'),
  };
  const key = symbol.toLowerCase();
  return {
    edge: path.join(root, `quant-evidence/positioning-edge-${key}-latest.json`),
    rows: path.join(root, `paper-tape/positioning-${key}.jsonl`),
    quality: path.join(root, `paper-tape/positioning-data-quality-${key}-latest.json`),
    divergence: null,
  };
}

function laneKeyPositioning(symbol, quality) { return `POSITIONING:${symbol}:${quality?.firstEligibleCapturedAt ?? 'NO_COHORT'}`; }
function laneKeyCross(altSymbol, btcQuality, altQuality) { return `CROSS_MARKET:BTCUSDT:${altSymbol}:${btcQuality?.firstEligibleCapturedAt ?? 'NO_BTC_COHORT'}:${altQuality?.firstEligibleCapturedAt ?? 'NO_ALT_COHORT'}`; }

function buildPositioningIntake(root, symbol) {
  const p = positioningPaths(root, symbol), edge = readJson(p.edge), quality = readJson(p.quality), rows = readJsonl(p.rows), divergenceRows = p.divergence ? readJsonl(p.divergence) : [];
  if (!edge || !quality) return { laneType: 'POSITIONING', symbol, state: 'SOURCE_UNAVAILABLE' };
  if (edge.version !== POSITIONING_FACTORY_VERSION) return { laneType: 'POSITIONING', symbol, state: 'SOURCE_VERSION_UNSUPPORTED', sourceVersion: edge.version };
  if (edge.mode !== 'RESEARCH_ONLY' || edge.paperOnly !== true || edge.liveOrders !== false || edge.executionAuthority !== false || edge.capitalEligible !== false || edge.methodology?.selectionUsesHoldout !== false || edge.methodology?.holdoutSealed !== true || edge.methodology?.activeQualityCohortOnly !== true) return { laneType: 'POSITIONING', symbol, state: 'SOURCE_BOUNDARY_UNVERIFIED' };
  const usableSamples = Number(edge?.dataQuality?.usableForwardSamples ?? 0), survivors = edge.survivors ?? [];
  if (usableSamples < MIN_AUDIT_SAMPLES) return { laneType: 'POSITIONING', symbol, state: 'AUDIT_SAMPLE_BUILDING', usableSamples, required: MIN_AUDIT_SAMPLES, laneKey: laneKeyPositioning(symbol, quality) };
  const champion = selectLaneChampion(survivors, { baseCostBps: edge.methodology.stressedCostBps ?? BASE_COST_BPS, stressCostBps: STRESS_COST_BPS });
  if (!champion) return { laneType: 'POSITIONING', symbol, state: survivors.length ? 'NO_STRESS_SURVIVOR' : 'NO_RESEARCH_SURVIVOR', usableSamples, laneKey: laneKeyPositioning(symbol, quality) };
  return { laneType: 'POSITIONING', symbol, state: 'READY_FOR_ONE_SHOT_AUDIT', usableSamples, laneKey: laneKeyPositioning(symbol, quality), champion, edge, quality, rows, divergenceRows };
}

function buildCrossIntakes(root) {
  const cross = readJson(path.join(root, 'quant-evidence/cross-market-lead-lag-latest.json'));
  if (!cross) return ALT_SYMBOLS.map(altSymbol => ({ laneType: 'CROSS_MARKET', altSymbol, state: 'SOURCE_UNAVAILABLE' }));
  if (cross.version !== CROSS_MARKET_VERSION) return ALT_SYMBOLS.map(altSymbol => ({ laneType: 'CROSS_MARKET', altSymbol, state: 'SOURCE_VERSION_UNSUPPORTED', sourceVersion: cross.version }));
  if (cross.mode !== 'RESEARCH_ONLY' || cross.paperOnly !== true || cross.liveOrders !== false || cross.executionAuthority !== false || cross.capitalEligible !== false || cross.methodology?.selectionUsesHoldout !== false || cross.methodology?.holdoutSealed !== true || cross.methodology?.activeQualityCohortsOnly !== true) return ALT_SYMBOLS.map(altSymbol => ({ laneType: 'CROSS_MARKET', altSymbol, state: 'SOURCE_BOUNDARY_UNVERIFIED' }));
  const btcP = positioningPaths(root, 'BTCUSDT'), btcRows = readJsonl(btcP.rows), btcQuality = readJson(btcP.quality);
  return ALT_SYMBOLS.map(altSymbol => {
    const altP = positioningPaths(root, altSymbol), altRows = readJsonl(altP.rows), altQuality = readJson(altP.quality), lane = cross.lanes?.[altSymbol];
    if (!lane || !btcQuality || !altQuality) return { laneType: 'CROSS_MARKET', altSymbol, state: 'LANE_SOURCE_UNAVAILABLE' };
    const alignedSamples = Number(lane?.dataQuality?.alignedSamples ?? 0), survivors = lane.survivors ?? [];
    const key = laneKeyCross(altSymbol, btcQuality, altQuality);
    if (alignedSamples < MIN_AUDIT_SAMPLES) return { laneType: 'CROSS_MARKET', altSymbol, state: 'AUDIT_SAMPLE_BUILDING', usableSamples: alignedSamples, required: MIN_AUDIT_SAMPLES, laneKey: key };
    const champion = selectLaneChampion(survivors, { baseCostBps: lane.methodology?.stressedCostBps ?? BASE_COST_BPS, stressCostBps: STRESS_COST_BPS });
    if (!champion) return { laneType: 'CROSS_MARKET', altSymbol, state: survivors.length ? 'NO_STRESS_SURVIVOR' : 'NO_RESEARCH_SURVIVOR', usableSamples: alignedSamples, laneKey: key };
    return { laneType: 'CROSS_MARKET', altSymbol, state: 'READY_FOR_ONE_SHOT_AUDIT', usableSamples: alignedSamples, laneKey: key, champion, lane, btcRows, altRows, btcQuality, altQuality };
  });
}

function candidateId(intake) {
  const family = intake.champion.candidate.family;
  return `${intake.laneKey}:${family}`;
}

function auditIntake(intake) {
  const familyId = intake.champion.candidate.family;
  let base, stressed;
  if (intake.laneType === 'POSITIONING') {
    const args = { rows: intake.rows, divergenceRows: intake.divergenceRows, quality: intake.quality, symbol: intake.symbol, familyId };
    base = evaluatePositioningHoldout(args, BASE_COST_BPS);
    stressed = evaluatePositioningHoldout(args, STRESS_COST_BPS);
  } else {
    const args = { btcRows: intake.btcRows, altRows: intake.altRows, btcQuality: intake.btcQuality, altQuality: intake.altQuality, altSymbol: intake.altSymbol, familyId };
    base = evaluateCrossHoldout(args, BASE_COST_BPS);
    stressed = evaluateCrossHoldout(args, STRESS_COST_BPS);
  }
  const gate = auditGate(base.metrics, stressed.metrics);
  return {
    id: candidateId(intake), laneKey: intake.laneKey, laneType: intake.laneType,
    symbol: intake.symbol ?? intake.altSymbol, leaderSymbol: intake.laneType === 'CROSS_MARKET' ? 'BTCUSDT' : null,
    family: familyId,
    championSelection: {
      basis: 'PRE_HOLDOUT_WORST_SPLIT_EXPECTANCY_AT_18BPS',
      score: intake.champion.score,
      trainStressExpectancyBps: intake.champion.gate.trainStress,
      validationStressExpectancyBps: intake.champion.gate.validationStress,
    },
    usableSamplesAtAudit: base.usableSamples,
    sealedHoldoutSamples: base.sealedHoldoutSamples,
    holdoutBase12Bps: base.metrics,
    holdoutStress18Bps: stressed.metrics,
    status: gate.pass ? 'FORWARD_PAPER_ELIGIBLE' : 'ONE_SHOT_AUDIT_REJECTED',
    rejectReason: gate.reason,
    auditedAt: new Date().toISOString(),
    liveEligible: false,
    executionAuthority: false,
    capitalEligible: false,
  };
}

export function runPromotionAudit({ root = '.', ledgerPath, outPath, historyPath } = {}) {
  const ledgerFile = ledgerPath ?? path.join(root, 'quant-evidence/research-promotion-ledger.json');
  const outputFile = outPath ?? path.join(root, 'quant-evidence/research-promotion-latest.json');
  const historyFile = historyPath ?? path.join(root, 'quant-evidence/research-promotion-history.jsonl');
  const ledger = readJson(ledgerFile, { version: LEDGER_VERSION, laneCohorts: {}, forwardEligibleCandidates: {}, rejectedCandidates: {} });
  ledger.version = LEDGER_VERSION; ledger.laneCohorts ??= {}; ledger.forwardEligibleCandidates ??= {}; ledger.rejectedCandidates ??= {};

  const intakes = [...SYMBOLS.map(symbol => buildPositioningIntake(root, symbol)), ...buildCrossIntakes(root)];
  const results = [];
  for (const intake of intakes) {
    if (intake.state !== 'READY_FOR_ONE_SHOT_AUDIT') continue;
    if (ledger.laneCohorts[intake.laneKey]) continue;
    const result = auditIntake(intake);
    results.push(result);
    ledger.laneCohorts[intake.laneKey] = { candidateId: result.id, family: result.family, status: result.status, auditedAt: result.auditedAt };
    if (result.status === 'FORWARD_PAPER_ELIGIBLE') ledger.forwardEligibleCandidates[result.id] = result;
    else ledger.rejectedCandidates[result.id] = result;
  }

  const passed = results.filter(result => result.status === 'FORWARD_PAPER_ELIGIBLE');
  const waiting = intakes.filter(intake => ['AUDIT_SAMPLE_BUILDING', 'NO_RESEARCH_SURVIVOR', 'NO_STRESS_SURVIVOR'].includes(intake.state)).length;
  const snapshot = {
    ok: true,
    version: VERSION,
    mode: 'RESEARCH_ONLY',
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    completedAt: new Date().toISOString(),
    methodology: {
      oneChampionPerLaneCohort: true,
      championSelectedBeforeHoldout: true,
      championSelection: 'WORST_TRAIN_VALIDATION_EXPECTANCY_AT_18BPS',
      holdoutOneShot: true,
      sameActiveCohortCannotReopenHoldout: true,
      minimumUsableSamplesBeforeAudit: MIN_AUDIT_SAMPLES,
      holdoutFraction: HOLDOUT_FRACTION,
      baseCostBps: BASE_COST_BPS,
      stressCostBps: STRESS_COST_BPS,
      holdoutGate: { minTrades: MIN_HOLDOUT_TRADES, minExpectancyBps: 0, minProfitFactor: 1.1, minTStat: 0.5, maxDrawdownPct: 5, stressExpectancyBps: 0, stressProfitFactor: 1.0 },
      auditPassDoesNotAutoEnrollForward: true,
      promotionNeverAutomaticToLive: true,
    },
    intake: intakes.map(intake => ({ laneType: intake.laneType, symbol: intake.symbol ?? intake.altSymbol, state: intake.state, usableSamples: intake.usableSamples ?? null, required: intake.required ?? null, laneKey: intake.laneKey ?? null })),
    newAudits: results.length,
    newForwardPaperEligible: passed.length,
    totalForwardPaperEligible: Object.keys(ledger.forwardEligibleCandidates).length,
    totalAuditedLaneCohorts: Object.keys(ledger.laneCohorts).length,
    waitingLanes: waiting,
    verdict: passed.length ? 'FORWARD_PAPER_ELIGIBLE_FOUND' : results.length ? 'ONE_SHOT_AUDIT_REJECTED' : 'NO_NEW_AUDIT_CANDIDATES',
    results,
    boundaries: { realOrdersPlaced: false, liveTradingEnabled: false, riskGatesChanged: false, forwardAutoEnrollment: false },
  };
  ledger.updatedAt = snapshot.completedAt;
  writeJson(ledgerFile, ledger); writeJson(outputFile, snapshot);
  fs.mkdirSync(path.dirname(historyFile), { recursive: true }); fs.appendFileSync(historyFile, `${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

if (process.argv[1]?.endsWith('runResearchPromotionAudit.mjs')) {
  const args = process.argv.slice(2); const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const snapshot = runPromotionAudit({ root: valueAfter('--root') ?? '.', ledgerPath: valueAfter('--ledger'), outPath: valueAfter('--out'), historyPath: valueAfter('--history') });
    console.log(JSON.stringify({ ok: snapshot.ok, verdict: snapshot.verdict, newAudits: snapshot.newAudits, forwardPaperEligible: snapshot.newForwardPaperEligible }));
  } catch (error) {
    console.error('ERROR:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
