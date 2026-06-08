// autoVeto.mjs — Phase 3 (6B.1A): adaptive "stop trading what loses" layer.
//
// Evidence-based, read-only over the trades table. Segments closed crypto trades into
// setups (side × regime), and vetoes a setup that has proven negative over a trailing
// window. The veto only LOWERS confidence below the gate — it never touches the risk
// engine, safe mode, caps, execution, Kelly, or TP/SL. Fully adaptive: it re-evaluates
// from data every cycle, so a setup un-vetoes itself as losers age out or winners arrive.

import db from '../db/database.mjs';

// Training-phase default: 12 gives statistical signal early (override with VETO_MIN_SAMPLES=20+ for production hardening)
const MIN_SAMPLES  = parseInt(process.env.VETO_MIN_SAMPLES ?? '12', 10);
const PF_THRESHOLD = parseFloat(process.env.VETO_PF ?? '0.9');
const WINDOW_DAYS  = parseInt(process.env.VETO_WINDOW_DAYS ?? '7', 10);

export function vetoConfig() {
  return { minSamples: MIN_SAMPLES, pfThreshold: PF_THRESHOLD, windowDays: WINDOW_DAYS };
}

export function setupKey(side, regime) { return `${side}_${regime}`; }

function regimeFromEvidence(evJson) {
  try {
    const ev = JSON.parse(evJson ?? '[]');
    const tag = (Array.isArray(ev) ? ev : []).find(s => typeof s === 'string' && s.startsWith('REGIME:'));
    return tag ? tag.slice('REGIME:'.length) : 'UNTAGGED';
  } catch { return 'UNTAGGED'; }
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
      WHERE trade_type IN ('scalp_v2','swing_v1') AND status='closed' AND pnl IS NOT NULL
        AND closed_at > datetime('now', ?)
    `).all(`-${WINDOW_DAYS} days`);
  } catch { return []; }
  return computeSetupStats(rows);
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
  return refresh().vetoes.has(setupKey(side, regime));
}

/** Confidence ceiling for this setup (1 = no cap). */
export function confidenceCap(side, regime) {
  return refresh().caps[setupKey(side, regime)] ?? 1;
}

/** Full autopsy for the operator panel + diagnostics. */
export function getAutopsy() {
  const setups = getSetupPerformance();
  const sorted = [...setups].sort((a, b) => a.expectancy - b.expectancy);
  return {
    config: vetoConfig(),
    setups,
    topLosers: sorted.filter(s => s.samples >= 3).slice(0, 5),
    topWinners: [...sorted].reverse().filter(s => s.samples >= 3).slice(0, 5),
    vetoes: getActiveVetoes(),
  };
}
