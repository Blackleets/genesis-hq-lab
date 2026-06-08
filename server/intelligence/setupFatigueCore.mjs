// setupFatigueCore.mjs — Pure computation layer for Phase 6B.1B.
// NO database dependency — safe to import in tests and from any context.

// ── Health score sub-components ───────────────────────────────────────────────

export function wrScore(wr) {
  if (wr == null) return 10;
  if (wr >= 0.60) return 30;
  if (wr >= 0.50) return 25;
  if (wr >= 0.45) return 20;
  if (wr >= 0.35) return 10;
  return 0;
}

export function pfScore(pf) {
  if (pf == null) return 5;
  if (pf === Infinity) return 30;
  if (pf >= 1.5) return 30;
  if (pf >= 1.2) return 25;
  if (pf >= 1.0) return 20;
  if (pf >= 0.8) return 10;
  return 0;
}

export function evScore(ev) {
  if (ev == null) return 8;
  if (ev >=  0.50) return 25;
  if (ev >=  0.20) return 20;
  if (ev >=  0.00) return 12;
  if (ev >= -0.30) return 5;
  return 0;
}

export function calibrationScore(cal) {
  // cal = 1 - avg(|confidence - won|), range [0,1]
  if (cal == null) return 8;
  if (cal >= 0.85) return 15;
  if (cal >= 0.70) return 10;
  if (cal >= 0.55) return 5;
  return 0;
}

/** Composite health 0–100 from setup statistics. Pure, no side effects. */
export function getHealthScore({ winRate, profitFactor, expectancy, calibration }) {
  return Math.min(100, Math.max(0,
    wrScore(winRate) +
    pfScore(profitFactor) +
    evScore(expectancy) +
    calibrationScore(calibration)
  ));
}

export function getHealthBand(score) {
  if (score <= 25) return 'TOXIC';
  if (score <= 45) return 'WEAK';
  if (score <= 65) return 'NEUTRAL';
  if (score <= 85) return 'GOOD';
  return 'STRONG';
}

/**
 * Behavioral modifiers by health band.
 * kellyMultiplier is advisory/diagnostic — NOT wired into the Kelly sizing
 * engine (off-limits). confidenceMultiplier is the live lever.
 */
export function getBandModifiers(band) {
  switch (band) {
    case 'TOXIC':   return { confidenceMultiplier: 0.50, kellyMultiplier: 0.25 };
    case 'WEAK':    return { confidenceMultiplier: 0.75, kellyMultiplier: 0.50 };
    case 'NEUTRAL': return { confidenceMultiplier: 1.00, kellyMultiplier: 1.00 };
    case 'GOOD':    return { confidenceMultiplier: 1.05, kellyMultiplier: 1.00 };
    case 'STRONG':  return { confidenceMultiplier: 1.10, kellyMultiplier: 1.15 };
    default:        return { confidenceMultiplier: 1.00, kellyMultiplier: 1.00 };
  }
}

/**
 * Confidence humility: consecutive losses in the same setup clamp the multiplier.
 * Never clamps upward — wins are reflected in band health score.
 */
export function applyHumilityPenalty(confidenceMultiplier, consecutiveLosses) {
  if (consecutiveLosses >= 5) return Math.min(confidenceMultiplier, 0.60);
  if (consecutiveLosses >= 3) return Math.min(confidenceMultiplier, 0.80);
  return confidenceMultiplier;
}

export function regimeFromEvidence(evJson) {
  try {
    const ev = JSON.parse(evJson ?? '[]');
    const tag = (Array.isArray(ev) ? ev : []).find(
      s => typeof s === 'string' && s.startsWith('REGIME:')
    );
    return tag ? tag.slice('REGIME:'.length) : 'UNTAGGED';
  } catch { return 'UNTAGGED'; }
}

/**
 * Compute per-setup fatigue stats from raw trade rows.
 * Rows must be ordered newest-first (closed_at DESC) for correct
 * consecutive-loss counting.
 *
 * @param {Array} rows — each row: { side, pair?, asset_pair?, pnl, confidence, evidence }
 * @returns {Array<SetupFatigueState>}
 */
export function computeSetupFatigue(rows) {
  const groups = {};

  for (const r of rows) {
    const regime = regimeFromEvidence(r.evidence);
    const pair   = r.pair ?? r.asset_pair ?? 'UNKNOWN';
    const key    = `${pair}_${r.side}_${regime}`;

    const g = groups[key] ?? (groups[key] = {
      key, pair, side: r.side, regime,
      n: 0, wins: 0, grossWin: 0, grossLoss: 0, totalPnl: 0,
      calSum: 0,
      recentOutcomes: [], // newest-first: true=win
    });

    const pnl = r.pnl ?? 0;
    const won = pnl > 0;
    g.n++;
    if (won) { g.wins++; g.grossWin += pnl; } else { g.grossLoss += Math.abs(pnl); }
    g.totalPnl += pnl;
    g.calSum   += Math.abs((r.confidence ?? 0) - (won ? 1 : 0));
    g.recentOutcomes.push(won);
  }

  return Object.values(groups).map(g => {
    const { n, wins, grossWin, grossLoss, totalPnl, calSum } = g;

    const winRate      = n > 0 ? wins / n : null;
    const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0);
    const expectancy   = n > 0 ? totalPnl / n : 0;
    const calibration  = n > 0 ? 1 - calSum / n : null;

    let consecutiveLosses = 0;
    for (const won of g.recentOutcomes) {
      if (!won) consecutiveLosses++;
      else break;
    }

    const healthScore = getHealthScore({ winRate, profitFactor, expectancy, calibration });
    const band        = getHealthBand(healthScore);
    const { confidenceMultiplier: baseMultiplier, kellyMultiplier } = getBandModifiers(band);
    const confidenceMultiplier = applyHumilityPenalty(baseMultiplier, consecutiveLosses);

    return {
      key: g.key,
      pair: g.pair,
      side: g.side,
      regime: g.regime,
      samples: n,
      winRate:      n > 0 ? Math.round(winRate * 1000) / 1000 : null,
      profitFactor: grossLoss > 0 ? Math.round(profitFactor * 100) / 100 : (grossWin > 0 ? Infinity : 0),
      expectancy:   Math.round(expectancy  * 100) / 100,
      pnl:          Math.round(totalPnl    * 100) / 100,
      calibration:  calibration != null ? Math.round(calibration * 100) / 100 : null,
      consecutiveLosses,
      healthScore,
      band,
      confidenceMultiplier,
      kellyMultiplier,
    };
  });
}

/**
 * Apply fatigue confidence multiplier, clamped to safe bounds.
 * Floor 0.30 prevents the multiplier from zeroing; ceiling 0.92 matches
 * the engine's rawConfidence cap.
 */
export function applyFatigueToConfidence(confidence, fatigueState) {
  const adjusted = confidence * fatigueState.confidenceMultiplier;
  return Math.min(0.92, Math.max(0.30, adjusted));
}
