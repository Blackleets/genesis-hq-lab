// server/genesis/math/extraNoGos.mjs
// Extra NO-GOs stacked ON TOP of the 6 Genesis gates.
// They can only fail a GO. They never flip a fail into a pass.
// Applied only when n >= 50 (the sample gate already covers smaller n).
// Jarque-Bera is NOT a gate.

import { bootstrapMeanCI, cvar, mean, median, wilcoxonSignedRank } from './stats.mjs';

/**
 * @param {Array<{pnl?: number}|number>} trades
 * @returns {{gates: Array<{name:string,pass:boolean,value:string}>, kill: boolean}}
 */
export function extraNoGos(trades = []) {
  const pnls = (trades || []).map(t => (typeof t === 'number' ? t : +t?.pnl)).filter(Number.isFinite);
  const n = pnls.length;
  if (n < 50) {
    return { gates: [], kill: false, skipped: 'n<50' };
  }
  const boot = bootstrapMeanCI(pnls, { iters: 800, alpha: 0.05, seed: 42 });
  const med = median(pnls);
  const wx = wilcoxonSignedRank(pnls);
  const mu = mean(pnls);
  const tail = cvar(pnls, 0.05);
  const gates = [
    {
      name: 'Bootstrap mean 5% LB > 0',
      pass: boot.lo > 0,
      value: boot.lo.toFixed(6),
    },
    {
      name: 'Median trade PnL > 0',
      pass: med > 0,
      value: med.toFixed(6),
    },
    {
      name: 'CVaR95 <= 3×|mean|',
      pass: !(tail > 0 && Math.abs(mu) > 0 && tail > 3 * Math.abs(mu)),
      value: `cvar=${tail.toFixed(6)} mean=${mu.toFixed(6)}`,
    },
  ];
  return {
    gates,
    kill: gates.some(g => !g.pass),
    bootstrap: boot,
    wilcoxon: wx,
    cvar: tail,
  };
}

/** Merge extra NO-GOs into an evaluateGates() result. Never raises go if it was false. */
export function applyExtraNoGos(gateResult, trades) {
  const extra = extraNoGos(trades);
  if (!extra.gates.length) return gateResult;
  const gates = [...(gateResult.gates || []), ...extra.gates];
  const passed = gates.filter(g => g.pass).length;
  const go = gateResult.go === true && extra.kill !== true;
  return {
    ...gateResult,
    gates,
    passed,
    total: gates.length,
    go,
    reason: go ? gateResult.reason : (extra.kill ? (gateResult.reason || 'EXTRA_NOGO') : gateResult.reason),
  };
}
