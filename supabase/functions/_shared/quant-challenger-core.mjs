export const ATR_PERIOD = 14;
export const EXIT_MODEL = 'atr14_adaptive_v1';
export const ECONOMICS_GATE = 'target_gross_move_gte_2x_conservative_friction';
export const TARGET_COST_MULTIPLE = 2;
export const TAKER_FEE_PER_SIDE = 0.0004;
export const CONSERVATIVE_FUNDING_8H = 0.0001;

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function candidateGrid(basePeriod, baseTimeoutHours) {
  const periods = [...new Set([0.6, 0.8, 1, 1.2].map((factor) => Math.max(6, Math.round(basePeriod * factor))))];
  const exits = [
    { targetAtr: 1, stopAtr: 0.75 },
    { targetAtr: 1.5, stopAtr: 0.75 },
    { targetAtr: 1.5, stopAtr: 1 },
    { targetAtr: 2, stopAtr: 0.75 },
    { targetAtr: 2, stopAtr: 1 },
  ];
  const timeouts = [...new Set([0.5, 1].map((factor) => Math.max(0.5, Math.round(baseTimeoutHours * factor * 100) / 100)))];
  const out = [];
  for (const period of periods) {
    for (const exit of exits) {
      for (const timeoutHours of timeouts) out.push({ period, ...exit, timeoutHours });
    }
  }
  return out;
}

export function candidateId(profileId, candidate) {
  const target = String(Math.round(candidate.targetAtr * 100)).padStart(3, '0');
  const stop = String(Math.round(candidate.stopAtr * 100)).padStart(3, '0');
  return `${profileId}:p${candidate.period}:ta${target}:sa${stop}:h${String(candidate.timeoutHours).replace('.', '_')}`;
}

export function atrPctAt(rows, index, period = ATR_PERIOD) {
  if (!Array.isArray(rows) || index < period || index >= rows.length) return null;
  const close = Number(rows[index]?.[4]);
  if (!Number.isFinite(close) || close <= 0) return null;
  const start = index - period + 1;
  if (start < 1) return null;
  let total = 0;
  for (let i = start; i <= index; i++) {
    const high = Number(rows[i]?.[2]);
    const low = Number(rows[i]?.[3]);
    const prevClose = Number(rows[i - 1]?.[4]);
    if (![high, low, prevClose].every(Number.isFinite) || high <= 0 || low <= 0 || prevClose <= 0) return null;
    total += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }
  const atr = total / period;
  return atr / close;
}

export function conservativeCostPct(entrySlippagePct, timeoutHours, options = {}) {
  const feePerSide = Number.isFinite(options.feePerSide) ? options.feePerSide : TAKER_FEE_PER_SIDE;
  const funding8h = Number.isFinite(options.funding8h) ? options.funding8h : CONSERVATIVE_FUNDING_8H;
  const slippage = Math.max(0, Number(entrySlippagePct) || 0);
  const hours = Math.max(0, Number(timeoutHours) || 0);
  return (feePerSide * 2) + (slippage * 2) + (funding8h * hours / 8);
}

export function adaptiveExitGeometry(rows, signalIndex, candidate, entrySlippagePct) {
  const atrPct = atrPctAt(rows, signalIndex, ATR_PERIOD);
  if (!Number.isFinite(atrPct) || atrPct <= 0) {
    return { valid: false, economicsPass: false, atrPct: null, targetPct: null, stopPct: null, conservativeCostPct: null, targetCostRatio: null };
  }
  const targetPct = clamp(candidate.targetAtr * atrPct, 0.0005, 0.08);
  const stopPct = clamp(candidate.stopAtr * atrPct, 0.0005, 0.05);
  const costPct = conservativeCostPct(entrySlippagePct, candidate.timeoutHours);
  const targetCostRatio = costPct > 0 ? targetPct / costPct : Infinity;
  return {
    valid: true,
    economicsPass: targetCostRatio >= TARGET_COST_MULTIPLE,
    atrPct,
    targetPct,
    stopPct,
    conservativeCostPct: costPct,
    targetCostRatio,
  };
}
