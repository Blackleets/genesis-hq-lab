// Prospective PAPER shadow for promotion-audited Positioning + Cross-Market candidates.
// No historical backfill: enrollment baselines at the latest durable observation.
// Uses only future observations after enrollment. Never places orders or grants capital authority.

import fs from 'node:fs';
import path from 'node:path';

const VERSION = 'research_forward_shadow_v1';
const LEDGER_VERSION = 'research_forward_shadow_ledger_v1';
const PROMOTION_LEDGER_VERSION = 'research_promotion_ledger_v1';
const BASE_COST_BPS = 12;
const STRESS_COST_BPS = 18;
const MAX_LEADER_AGE_MINUTES = 8;
const MAX_DIVERGENCE_AGE_MS = 30_000;
const FORWARD_GATE = Object.freeze({ minTrades: 20, minExpectancyBps: 0, minProfitFactor: 1.2, minTStat: 1, maxDrawdownPct: 5, stressMinExpectancyBps: 0, stressMinProfitFactor: 1 });

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function timeMs(row) { const n = Date.parse(row?.capturedAt); return Number.isFinite(n) ? n : null; }
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function readJsonl(file) { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`); }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function std(xs) { if (xs.length < 2) return null; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); }

export function forwardMetrics(trades = [], field = 'netBaseBps') {
  const returns = trades.map(t => finite(t?.[field])).filter(Number.isFinite);
  if (!returns.length) return { trades: 0, expectancyBps: null, profitFactor: null, tStat: null, maxDrawdownPct: 0 };
  const wins = returns.filter(x => x > 0), losses = returns.filter(x => x < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0), grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const expectancy = mean(returns), sd = std(returns);
  let equity = 0, peak = 0, maxDd = 0;
  for (const r of returns) { equity += r / 100; peak = Math.max(peak, equity); maxDd = Math.max(maxDd, peak - equity); }
  return {
    trades: returns.length,
    expectancyBps: expectancy,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : null,
    tStat: sd && sd > 0 ? expectancy / (sd / Math.sqrt(returns.length)) : null,
    maxDrawdownPct: maxDd,
  };
}

export function forwardGate(base, stressed) {
  if ((base?.trades ?? 0) < FORWARD_GATE.minTrades) return { pass: false, state: 'FORWARD_SAMPLE_BUILDING' };
  if ((base?.expectancyBps ?? -Infinity) <= FORWARD_GATE.minExpectancyBps) return { pass: false, state: 'FORWARD_EXPECTANCY_FAIL' };
  if ((base?.profitFactor ?? 0) < FORWARD_GATE.minProfitFactor) return { pass: false, state: 'FORWARD_PF_FAIL' };
  if ((base?.tStat ?? -Infinity) < FORWARD_GATE.minTStat) return { pass: false, state: 'FORWARD_TSTAT_FAIL' };
  if ((base?.maxDrawdownPct ?? Infinity) > FORWARD_GATE.maxDrawdownPct) return { pass: false, state: 'FORWARD_DRAWDOWN_FAIL' };
  if ((stressed?.expectancyBps ?? -Infinity) <= FORWARD_GATE.stressMinExpectancyBps || (stressed?.profitFactor ?? 0) < FORWARD_GATE.stressMinProfitFactor) return { pass: false, state: 'FORWARD_18BPS_STRESS_FAIL' };
  return { pass: true, state: 'FORWARD_GATE_PASS' };
}

function positioningPath(root, symbol) {
  return symbol === 'BTCUSDT'
    ? path.join(root, 'paper-tape/positioning-dynamics.jsonl')
    : path.join(root, `paper-tape/positioning-${symbol.toLowerCase()}.jsonl`);
}

function validRow(row, symbol) {
  return row?.mode === 'RESEARCH_ONLY'
    && row?.provider === 'okx_public_market_data'
    && row?.schemaVersion === 4
    && row?.symbol === symbol
    && Number.isFinite(timeMs(row))
    && finite(row?.price?.close) > 0;
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

function divergenceRows(root) {
  return readJsonl(path.join(root, 'paper-tape/spot-perp-taker-divergence.jsonl'))
    .filter(row => row?.mode === 'RESEARCH_ONLY' && row?.symbol === 'BTCUSDT' && row?.schemaVersion === 1 && row?.provenance?.fixedWindow === true && Number.isFinite(timeMs(row)))
    .sort((a, b) => timeMs(a) - timeMs(b));
}

function attachPriorDivergence(row, divergences) {
  const t = timeMs(row);
  let selected = null;
  for (const item of divergences) {
    const dt = timeMs(item);
    if (dt > t) break;
    selected = item;
  }
  const age = selected ? t - timeMs(selected) : null;
  const value = selected ? finite(selected?.divergence?.perpMinusSpotNotionalBuyFraction) : null;
  const usable = selected && age >= 0 && age <= MAX_DIVERGENCE_AGE_MS && value !== null;
  return {
    ...row,
    researchFeatures: {
      ...(row.researchFeatures ?? {}),
      spotPerpTakerDivergence: usable ? value : null,
      spotPerpTakerDivergenceCausal: Boolean(usable),
    },
  };
}

function latestPriorBtc(btcRows, currentTime) {
  let selected = null;
  for (const row of btcRows) {
    const t = timeMs(row);
    if (t > currentTime) break;
    selected = row;
  }
  if (!selected) return null;
  const ageMinutes = (currentTime - timeMs(selected)) / 60_000;
  return ageMinutes >= 0 && ageMinutes <= MAX_LEADER_AGE_MINUTES ? selected : null;
}

export function enrollmentBaseline(rows = []) {
  const valid = rows.filter(row => Number.isFinite(timeMs(row))).sort((a, b) => timeMs(a) - timeMs(b));
  return valid.at(-1)?.capturedAt ?? null;
}

function closePending(state, row) {
  if (!state.pendingSignal) return;
  const exitPrice = finite(row?.price?.close), entryPrice = finite(state.pendingSignal.entryPrice);
  if (!(exitPrice > 0 && entryPrice > 0)) return;
  const grossBps = state.pendingSignal.direction * Math.log(exitPrice / entryPrice) * 10_000;
  state.closedTrades.push({
    openedAt: state.pendingSignal.openedAt,
    closedAt: row.capturedAt,
    direction: state.pendingSignal.direction,
    entryPrice,
    exitPrice,
    grossBps,
    netBaseBps: grossBps - BASE_COST_BPS,
    netStressBps: grossBps - STRESS_COST_BPS,
  });
  state.pendingSignal = null;
}

function maybeOpenPositioningSignal(state, row, divergences) {
  const family = POSITIONING_FAMILIES[state.family];
  if (!family) { state.blockedReason = 'UNKNOWN_POSITIONING_FAMILY'; return; }
  const prepared = state.symbol === 'BTCUSDT' ? attachPriorDivergence(row, divergences) : row;
  if (!family.signal(prepared)) return;
  const direction = family.direction(prepared), price = finite(prepared?.price?.close);
  if (![-1, 1].includes(direction) || !(price > 0)) return;
  state.pendingSignal = { openedAt: prepared.capturedAt, entryPrice: price, direction, evidenceSource: 'POST_ENROLLMENT_POSITIONING_CAPTURE' };
}

function maybeOpenCrossSignal(state, altRow, btcRows) {
  const family = CROSS_FAMILIES[state.family];
  if (!family) { state.blockedReason = 'UNKNOWN_CROSS_FAMILY'; return; }
  const btc = latestPriorBtc(btcRows, timeMs(altRow));
  if (!btc) return;
  const sample = { btc, alt: altRow };
  if (!family.signal(sample)) return;
  const direction = family.direction(sample), price = finite(altRow?.price?.close);
  if (![-1, 1].includes(direction) || !(price > 0)) return;
  state.pendingSignal = { openedAt: altRow.capturedAt, entryPrice: price, direction, leaderCapturedAt: btc.capturedAt, evidenceSource: 'POST_ENROLLMENT_CAUSAL_BTC_TO_ALT_CAPTURE' };
}

function processCandidate(state, root) {
  const rows = readJsonl(positioningPath(root, state.symbol)).filter(row => validRow(row, state.symbol)).sort((a, b) => timeMs(a) - timeMs(b));
  const baselineMs = Date.parse(state.lastProcessedCapturedAt ?? state.enrollmentBaselineCapturedAt ?? '');
  const newRows = rows.filter(row => timeMs(row) > baselineMs);
  if (!newRows.length) return 0;
  const btcRows = state.laneType === 'CROSS_MARKET'
    ? readJsonl(positioningPath(root, 'BTCUSDT')).filter(row => validRow(row, 'BTCUSDT')).sort((a, b) => timeMs(a) - timeMs(b))
    : [];
  const divergences = state.laneType === 'POSITIONING' && state.symbol === 'BTCUSDT' ? divergenceRows(root) : [];
  for (const row of newRows) {
    closePending(state, row);
    if (state.laneType === 'POSITIONING') maybeOpenPositioningSignal(state, row, divergences);
    else maybeOpenCrossSignal(state, row, btcRows);
    state.lastProcessedCapturedAt = row.capturedAt;
  }
  return newRows.length;
}

function enrollCandidate(candidate, root) {
  const rows = readJsonl(positioningPath(root, candidate.symbol)).filter(row => validRow(row, candidate.symbol)).sort((a, b) => timeMs(a) - timeMs(b));
  const baseline = enrollmentBaseline(rows);
  return {
    id: candidate.id,
    sourceLaneKey: candidate.laneKey,
    laneType: candidate.laneType,
    symbol: candidate.symbol,
    leaderSymbol: candidate.leaderSymbol ?? null,
    family: candidate.family,
    sourceAuditAt: candidate.auditedAt,
    enrolledAt: new Date().toISOString(),
    enrollmentBaselineCapturedAt: baseline,
    lastProcessedCapturedAt: baseline,
    pendingSignal: null,
    closedTrades: [],
    blockedReason: null,
    paperOnly: true,
    liveEligible: false,
    executionAuthority: false,
    capitalEligible: false,
  };
}

export function runResearchForwardShadow({ root = '.', ledgerPath, outPath, historyPath } = {}) {
  const promotion = readJson(path.join(root, 'quant-evidence/research-promotion-ledger.json'));
  if (!promotion || promotion.version !== PROMOTION_LEDGER_VERSION) throw new Error('promotion_ledger_unavailable_or_unsupported');
  const ledgerFile = ledgerPath ?? path.join(root, 'quant-evidence/research-forward-shadow-ledger.json');
  const outputFile = outPath ?? path.join(root, 'quant-evidence/research-forward-shadow-latest.json');
  const historyFile = historyPath ?? path.join(root, 'quant-evidence/research-forward-shadow-history.jsonl');
  const ledger = readJson(ledgerFile, { version: LEDGER_VERSION, candidates: {} });
  ledger.version = LEDGER_VERSION; ledger.candidates ??= {};

  let newlyEnrolled = 0;
  for (const candidate of Object.values(promotion.forwardEligibleCandidates ?? {})) {
    if (candidate?.status !== 'FORWARD_PAPER_ELIGIBLE' || candidate?.liveEligible !== false || candidate?.executionAuthority !== false || candidate?.capitalEligible !== false) continue;
    if (!ledger.candidates[candidate.id]) { ledger.candidates[candidate.id] = enrollCandidate(candidate, root); newlyEnrolled += 1; }
  }

  let processedRows = 0;
  for (const state of Object.values(ledger.candidates)) processedRows += processCandidate(state, root);

  const candidates = Object.values(ledger.candidates).map(state => {
    const base = forwardMetrics(state.closedTrades, 'netBaseBps'), stressed = forwardMetrics(state.closedTrades, 'netStressBps'), gate = forwardGate(base, stressed);
    return {
      id: state.id, laneType: state.laneType, symbol: state.symbol, leaderSymbol: state.leaderSymbol, family: state.family,
      enrolledAt: state.enrolledAt, enrollmentBaselineCapturedAt: state.enrollmentBaselineCapturedAt, lastProcessedCapturedAt: state.lastProcessedCapturedAt,
      pendingSignal: state.pendingSignal, forwardBase12Bps: base, forwardStress18Bps: stressed,
      evidenceStatus: gate.state, nextStageEligible: gate.pass, liveEligible: false, executionAuthority: false, capitalEligible: false,
    };
  });
  const snapshot = {
    ok: true,
    version: VERSION,
    mode: 'FORWARD_PAPER_RESEARCH',
    paperOnly: true,
    liveOrders: false,
    executionAuthority: false,
    capitalEligible: false,
    completedAt: new Date().toISOString(),
    methodology: {
      source: 'DURABLE_FORWARD_ELIGIBLE_REGISTRY',
      auditProcessAutoEnrollment: false,
      forwardMonitorPaperEnrollment: true,
      noHistoricalBackfill: true,
      enrollmentBaselineIsLatestDurableObservation: true,
      postEnrollmentObservationsOnly: true,
      oneObservationHorizonMatchesResearchLabel: true,
      causalPriorBtcLeaderOnly: true,
      baseCostBps: BASE_COST_BPS,
      stressCostBps: STRESS_COST_BPS,
      forwardGate: FORWARD_GATE,
      promotionNeverAutomaticToLive: true,
    },
    registeredEligible: Object.keys(promotion.forwardEligibleCandidates ?? {}).length,
    enrolled: candidates.length,
    newlyEnrolled,
    processedRows,
    openSignals: candidates.filter(candidate => candidate.pendingSignal).length,
    nextStageEligible: candidates.filter(candidate => candidate.nextStageEligible).length,
    candidates,
    boundaries: { realOrdersPlaced: false, liveTradingEnabled: false, changesRiskGates: false },
  };
  ledger.updatedAt = snapshot.completedAt;
  writeJson(ledgerFile, ledger); writeJson(outputFile, snapshot);
  fs.mkdirSync(path.dirname(historyFile), { recursive: true }); fs.appendFileSync(historyFile, `${JSON.stringify(snapshot)}\n`);
  return snapshot;
}

if (process.argv[1]?.endsWith('runResearchForwardShadow.mjs')) {
  const args = process.argv.slice(2); const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  try {
    const snapshot = runResearchForwardShadow({ root: valueAfter('--root') ?? '.', ledgerPath: valueAfter('--ledger'), outPath: valueAfter('--out'), historyPath: valueAfter('--history') });
    console.log(JSON.stringify({ ok: snapshot.ok, enrolled: snapshot.enrolled, newlyEnrolled: snapshot.newlyEnrolled, processedRows: snapshot.processedRows, nextStageEligible: snapshot.nextStageEligible }));
  } catch (error) {
    console.error('ERROR:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
