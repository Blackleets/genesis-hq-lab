// autoVeto.mjs — Phase 3 (6B.1A): adaptive "stop trading what loses" layer.
//
// Evidence-based, read-only over the trades table. Segments closed crypto trades into
// setups (side × regime), and vetoes a setup that has proven negative over a trailing
// window. The veto only LOWERS confidence below the gate — it never touches the risk
// engine, safe mode, caps, execution, Kelly, or TP/SL. Fully adaptive: it re-evaluates
// from data every cycle, so a setup un-vetoes itself as losers age out or winners arrive.

import db from '../db/database.mjs';
import { CRYPTO_TRADE_TYPES_SQL, computeEdgeVerdict, getClosedCryptoMetrics } from './cryptoTradeUniverse.mjs';

// Training-phase default: 12 gives statistical signal early (override with VETO_MIN_SAMPLES=20+ for production hardening)
const MIN_SAMPLES  = parseInt(process.env.VETO_MIN_SAMPLES ?? '12', 10);
const PF_THRESHOLD = parseFloat(process.env.VETO_PF ?? '0.9');
const WINDOW_DAYS  = parseInt(process.env.VETO_WINDOW_DAYS ?? '7', 10);
const KILL_RECOMMENDATION_MIN_TRADES = parseInt(process.env.KILL_RECOMMENDATION_MIN_TRADES ?? '40', 10);

function parseList(value, normalize = (item) => item) {
  return (value ?? '')
    .split(',')
    .map((item) => normalize(item.trim()))
    .filter(Boolean);
}

function normalizeHourValue(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value).padStart(2, '0');
  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{1,2}$/.test(text)) return text.padStart(2, '0');
  const ms = Date.parse(text);
  if (Number.isFinite(ms)) return hourBucket(text);
  return null;
}

const MANUAL_BLOCKED_SETUPS = parseList(process.env.CRYPTO_BLOCK_SETUPS ?? 'SHORT_BEAR');
const MANUAL_BLOCKED_HOURS = parseList(process.env.CRYPTO_BLOCK_HOURS ?? '16', normalizeHourValue);
const MANUAL_BLOCKED_CONFIDENCE_BANDS = parseList(process.env.CRYPTO_BLOCK_CONFIDENCE_BANDS ?? '');
const MANUAL_BLOCKED_PAIRS = parseList(process.env.CRYPTO_BLOCK_PAIRS ?? '', (item) => item.toUpperCase());

export function vetoConfig() {
  return {
    minSamples: MIN_SAMPLES,
    pfThreshold: PF_THRESHOLD,
    windowDays: WINDOW_DAYS,
    manualBlockedSetups: MANUAL_BLOCKED_SETUPS,
    manualBlockedHours: MANUAL_BLOCKED_HOURS,
    manualBlockedConfidenceBands: MANUAL_BLOCKED_CONFIDENCE_BANDS,
    manualBlockedPairs: MANUAL_BLOCKED_PAIRS,
  };
}

export function setupKey(side, regime) { return `${side}_${regime}`; }

function round2(n) {
  return Math.round(n * 100) / 100;
}

function regimeFromEvidence(evJson) {
  try {
    const ev = JSON.parse(evJson ?? '[]');
    const tag = (Array.isArray(ev) ? ev : []).find(s => typeof s === 'string' && s.startsWith('REGIME:'));
    return tag ? tag.slice('REGIME:'.length) : 'UNTAGGED';
  } catch { return 'UNTAGGED'; }
}

export function hourBucket(openedAt) {
  const ms = Date.parse(openedAt ?? '');
  if (!Number.isFinite(ms)) return 'unknown';
  return String(new Date(ms).getUTCHours()).padStart(2, '0');
}

export function confidenceBand(confidence) {
  const pct = Math.round((confidence ?? 0) * 100);
  if (pct >= 90) return '90-100';
  if (pct >= 80) return '80-89';
  if (pct >= 70) return '70-79';
  if (pct >= 60) return '60-69';
  return '<60';
}

function summarizeRowsBy(rows, makeKey, makeMeta) {
  const groups = {};
  for (const row of rows) {
    const key = makeKey(row);
    const g = groups[key] ?? (groups[key] = {
      key,
      ...makeMeta(row),
      samples: 0,
      wins: 0,
      grossWin: 0,
      grossLoss: 0,
      totalPnl: 0,
    });
    const pnl = row.pnl ?? 0;
    g.samples++;
    if (pnl > 0) {
      g.wins++;
      g.grossWin += pnl;
    } else if (pnl < 0) {
      g.grossLoss += Math.abs(pnl);
    }
    g.totalPnl += pnl;
  }
  return Object.values(groups).map((g) => ({
    ...g,
    winRate: g.samples > 0 ? round2(g.wins / g.samples) : null,
    expectancy: g.samples > 0 ? round2(g.totalPnl / g.samples) : 0,
    profitFactor: g.grossLoss > 0 ? round2(g.grossWin / g.grossLoss) : (g.grossWin > 0 ? Infinity : 0),
    totalPnl: round2(g.totalPnl),
  }));
}

function buildCandidateActions(breakdown) {
  const actions = [];

  const worstRegime = breakdown.byRegime?.[0];
  if (worstRegime?.regime && (worstRegime.expectancy ?? 0) < 0) {
    actions.push({
      type: 'gate_side_regime',
      priority: 1,
      target: `${worstRegime.side ?? 'UNKNOWN'}_${worstRegime.regime}`,
      reason: `${worstRegime.samples} trades, EV ${worstRegime.expectancy}, PF ${worstRegime.profitFactor}`,
    });
  }

  const worstHour = breakdown.byHour?.[0];
  if (worstHour?.hour && worstHour.hour !== 'unknown' && (worstHour.expectancy ?? 0) < 0) {
    actions.push({
      type: 'gate_hour_bucket',
      priority: 2,
      target: `${worstHour.hour}:00-${worstHour.hour}:59 UTC`,
      reason: `${worstHour.samples} trades, EV ${worstHour.expectancy}, PF ${worstHour.profitFactor}`,
    });
  }

  const worstBand = breakdown.byConfidenceBand?.[0];
  if (worstBand?.confidenceBand && (worstBand.expectancy ?? 0) < 0) {
    actions.push({
      type: 'raise_confidence_floor',
      priority: 3,
      target: worstBand.confidenceBand,
      reason: `${worstBand.samples} trades, EV ${worstBand.expectancy}, PF ${worstBand.profitFactor}`,
    });
  }

  const worstPair = breakdown.byPair?.[0];
  if (worstPair?.pair && (worstPair.expectancy ?? 0) < 0) {
    actions.push({
      type: 'gate_pair',
      priority: 4,
      target: worstPair.pair,
      reason: `${worstPair.samples} trades, EV ${worstPair.expectancy}, PF ${worstPair.profitFactor}`,
    });
  }

  return actions;
}

// ── Pure setup-stats computation (unit-tested without a DB) ────────────────────
export function computeSetupStats(rows) {
  const groups = {};
  for (const r of rows) {
    const regime = r.regime ?? regimeFromEvidence(r.evidence);
    const key = setupKey(r.side, regime);
    const g = groups[key] ?? (groups[key] = { key, side: r.side, regime, trades: 0, wins: 0, grossWin: 0, grossLoss: 0, pnl: 0, confSum: 0 });
    const pnl = r.pnl ?? 0;
    g.trades++;
    if (pnl > 0) { g.wins++; g.grossWin += pnl; } else { g.grossLoss += Math.abs(pnl); }
    g.pnl += pnl;
    g.confSum += r.confidence ?? 0;
  }
  return Object.values(groups).map(g => ({
    key: g.key, side: g.side, regime: g.regime, samples: g.trades,
    winRate: g.trades ? Math.round(g.wins / g.trades * 100) / 100 : null,
    expectancy: g.trades ? Math.round(g.pnl / g.trades * 100) / 100 : 0,
    profitFactor: g.grossLoss > 0 ? Math.round(g.grossWin / g.grossLoss * 100) / 100 : (g.grossWin > 0 ? Infinity : 0),
    pnl: Math.round(g.pnl * 100) / 100,
    avgConfidence: g.trades ? Math.round(g.confSum / g.trades * 100) / 100 : null,
  }));
}

/** A setup qualifies for veto: enough samples AND negative expectancy AND poor PF. */
export function isVetoSetup(s) {
  return s.samples >= MIN_SAMPLES && s.expectancy < 0 && (s.profitFactor !== Infinity && s.profitFactor < PF_THRESHOLD);
}

/** Confidence cap from historical win rate: a 38%-WR setup can't claim 70% confidence. */
export function capFromWinRate(winRate) {
  if (winRate == null) return 1;            // no cap until we know
  return Math.max(0.50, Math.min(0.92, winRate + 0.18));
}

// ── DB-backed accessors ────────────────────────────────────────────────────────

export function getSetupPerformance() {
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT outcome AS side, pnl, confidence, evidence
      FROM trades
      WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status='closed' AND pnl IS NOT NULL
        AND closed_at > datetime('now', ?)
    `).all(`-${WINDOW_DAYS} days`);
  } catch { return []; }
  return computeSetupStats(rows);
}

function getWindowedClosedRows() {
  try {
    return db.prepare(`
      SELECT asset_pair AS pair, outcome AS side, pnl, confidence, evidence, opened_at
      FROM trades
      WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status='closed' AND pnl IS NOT NULL
        AND closed_at > datetime('now', ?)
    `).all(`-${WINDOW_DAYS} days`);
  } catch {
    return [];
  }
}

export function getAutopsyBreakdown() {
  const rows = getWindowedClosedRows().map((row) => ({
    ...row,
    regime: regimeFromEvidence(row.evidence),
    hour: hourBucket(row.opened_at),
    confidenceBand: confidenceBand(row.confidence),
  }));

  const rank = (items) => items
    .filter((item) => item.samples >= 3)
    .sort((a, b) => {
      if (a.expectancy !== b.expectancy) return a.expectancy - b.expectancy;
      return a.totalPnl - b.totalPnl;
    })
    .slice(0, 5);

  return {
    byPair: rank(summarizeRowsBy(rows, (r) => r.pair ?? 'UNKNOWN', (r) => ({ pair: r.pair ?? 'UNKNOWN' }))),
    bySide: rank(summarizeRowsBy(rows, (r) => r.side ?? 'UNKNOWN', (r) => ({ side: r.side ?? 'UNKNOWN' }))),
    byRegime: rank(summarizeRowsBy(rows, (r) => `${r.side ?? 'UNKNOWN'}|${r.regime}`, (r) => ({
      side: r.side ?? 'UNKNOWN',
      regime: r.regime,
    }))),
    byHour: rank(summarizeRowsBy(rows, (r) => r.hour, (r) => ({ hour: r.hour }))),
    byConfidenceBand: rank(summarizeRowsBy(rows, (r) => r.confidenceBand, (r) => ({ confidenceBand: r.confidenceBand }))),
  };
}

export function getActiveVetoes() {
  return getSetupPerformance()
    .filter(isVetoSetup)
    .map(s => ({ ...s, reason: `${s.samples} trades · EV $${s.expectancy} · PF ${s.profitFactor} · WR ${s.winRate != null ? Math.round(s.winRate * 100) + '%' : '—'}` }));
}

// 30s cache so the hot scalp loop doesn't re-query every 5s.
let _cache = { at: 0, vetoes: new Set(), caps: {} };
function refresh() {
  const now = Date.now();
  if (now - _cache.at < 30_000 && _cache.at) return _cache;
  const perf = getSetupPerformance();
  const vetoes = new Set(perf.filter(isVetoSetup).map(s => s.key));
  const caps = {};
  for (const s of perf) if (s.samples >= MIN_SAMPLES) caps[s.key] = capFromWinRate(s.winRate);
  _cache = { at: now, vetoes, caps };
  return _cache;
}

/** Is this candidate setup currently vetoed? (used as a confidence gate only) */
export function isSetupVetoed(side, regime) {
  const key = setupKey(side, regime);
  return MANUAL_BLOCKED_SETUPS.includes(key) || refresh().vetoes.has(key);
}

export function isHourBlocked(value) {
  const hour = normalizeHourValue(value);
  return hour != null && MANUAL_BLOCKED_HOURS.includes(hour);
}

export function isConfidenceBandBlocked(value) {
  const band = typeof value === 'string' && value.includes('-') ? value : confidenceBand(value);
  return MANUAL_BLOCKED_CONFIDENCE_BANDS.includes(band);
}

export function isPairBlocked(pair) {
  const normalized = String(pair ?? '').trim().toUpperCase();
  return normalized !== '' && MANUAL_BLOCKED_PAIRS.includes(normalized);
}

/** Confidence ceiling for this setup (1 = no cap). */
export function confidenceCap(side, regime) {
  return refresh().caps[setupKey(side, regime)] ?? 1;
}

/** Full autopsy for the operator panel + diagnostics. */
export function getAutopsy() {
  const setups = getSetupPerformance();
  const sorted = [...setups].sort((a, b) => a.expectancy - b.expectancy);
  const edge = getClosedCryptoMetrics();
  const nonMatureSetups = setups.filter(s => s.samples < MIN_SAMPLES);
  const totalSamples = edge.trades;
  const windowedSamples = setups.reduce((sum, s) => sum + (s.samples ?? 0), 0);
  const breakdown = getAutopsyBreakdown();
  const candidateActions = buildCandidateActions(breakdown);
  const shouldChangeOrPause = totalSamples >= KILL_RECOMMENDATION_MIN_TRADES
    && (edge.expectancy ?? 0) < 0
    && (edge.profitFactor ?? 0) < 1;
  const recommendation = shouldChangeOrPause
    ? {
        action: 'change_or_pause_strategy',
        severity: 'high',
        thresholdTrades: KILL_RECOMMENDATION_MIN_TRADES,
        triggered: true,
        reason: `${totalSamples} closed trades with EV ${edge.expectancy} and PF ${edge.profitFactor}`,
      }
    : {
        action: 'continue_training',
        severity: totalSamples < KILL_RECOMMENDATION_MIN_TRADES ? 'low' : 'medium',
        thresholdTrades: KILL_RECOMMENDATION_MIN_TRADES,
        triggered: false,
        reason: totalSamples < KILL_RECOMMENDATION_MIN_TRADES
          ? `Need ${Math.max(0, KILL_RECOMMENDATION_MIN_TRADES - totalSamples)} more closed trades before a hard recommendation`
          : `Edge not yet good, but kill threshold not met`,
      };
  return {
    config: vetoConfig(),
    totalSamples,
    windowedSamples,
    vetoesActive: getActiveVetoes().length,
    nonMatureSetups,
    edgeSummary: {
      trades: edge.trades,
      winRate: edge.winRate,
      expectancy: edge.expectancy,
      profitFactor: edge.profitFactor,
      totalPnl: edge.totalPnl,
      verdict: computeEdgeVerdict(edge),
    },
    recommendation,
    breakdown,
    candidateActions,
    setups,
    topLosers: sorted.filter(s => s.samples >= 3).slice(0, 5),
    topWinners: [...sorted].reverse().filter(s => s.samples >= 3).slice(0, 5),
    vetoes: getActiveVetoes(),
  };
}
