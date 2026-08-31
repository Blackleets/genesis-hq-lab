// server/genesis/shadowCritic.mjs
// P5 — Shadow Critic pre-persistencia (FinRobot improvement, lightweight).
// Second, non-blocking critical pass over a council/backtest verdict BEFORE it
// is persisted. Deterministic heuristics only — NO LLM calls (YAGNI): a local
// Hermes model endpoint was considered and deliberately not wired in.
//
// Usage (module):
//   import { critiqueVerdict } from './shadowCritic.mjs';
//   const c = await critiqueVerdict({ pair, kind, params, metrics, gates });
//
// Usage (CLI):
//   node shadowCritic.mjs '<json del report>'
//   node shadowCritic.mjs report.json        (file path also accepted)
//
// Verdict semantics:
//   AGREE    — no suspicious signals found
//   ABSTAIN  — one concern: flag for human review, do not block
//   DISAGREE — two or more concerns: recommend NOT persisting as validated
//   ABSTAIN is also returned when metrics are missing/unusable.

const MODEL = 'deterministic-heuristic-v1';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {{pair?:string, kind?:string, params?:object,
 *          metrics?:object, gates?:any}} report
 * @returns {Promise<{verdict:'AGREE'|'DISAGREE'|'ABSTAIN',
 *                     concerns:string[], model:string}>}
 */
export async function critiqueVerdict({ pair, kind, params, metrics, gates } = {}) {
  const concerns = [];
  const label = `${pair ?? '?'}${kind ? '/' + kind : ''}`;

  if (!metrics || typeof metrics !== 'object') {
    return { verdict: 'ABSTAIN', concerns: ['metrics missing or malformed — nothing to audit'], model: MODEL };
  }

  const trades = num(metrics.trades);
  const pf = num(metrics.profitFactor);
  const winRate = num(metrics.winRate);
  const maxDD = num(metrics.maxDrawdown);
  const ev = num(metrics.expectancyPctPerTrade);

  // H1: tiny sample with an outsized profit factor.
  if (trades !== null && pf !== null && trades < 50 && pf > 2) {
    concerns.push(`H1 small-sample outlier: ${trades} trades with PF=${pf.toFixed(2)} (>2) — PF unstable below ~50 trades`);
  }
  // H2: suspiciously high win rate on a small sample.
  if (winRate !== null && trades !== null && winRate > 0.8 && trades < 100) {
    concerns.push(`H2 win rate ${winRate > 1 ? winRate.toFixed(1) : (winRate * 100).toFixed(1)}% (>80%) over only ${trades} trades (<100) — likely regime luck or cold-start artifacts`);
  }
  // H3: too perfect — near-zero drawdown combined with high per-trade EV.
  if (maxDD !== null && ev !== null && maxDD < 0.002 && ev > 0.3) {
    concerns.push(`H3 too-good-to-be-true: maxDrawdown ${(maxDD * 100).toFixed(3)}% (<0.2%) with EV ${ev.toFixed(3)}%/trade (>0.3%) — real fills/slippage never look like this`);
  }

  let verdict;
  if (concerns.length === 0) verdict = 'AGREE';
  else if (concerns.length >= 2) verdict = 'DISAGREE';
  else verdict = 'ABSTAIN';

  return { verdict, concerns, model: MODEL };
}

// --- CLI -------------------------------------------------------------------
async function resolveReportArg(arg) {
  try {
    if (arg && (arg.trim().startsWith('{') || arg.trim().startsWith('['))) return JSON.parse(arg);
  } catch { /* fall through to file attempt */ }
  const fs = await import('node:fs');
  if (arg && fs.existsSync(arg)) return JSON.parse(fs.readFileSync(arg, 'utf8'));
  throw new Error('argument is neither valid JSON nor a readable JSON file');
}

if (process.argv[1] && process.argv[1].endsWith('shadowCritic.mjs')) {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node shadowCritic.mjs \'<json del report>\'');
    process.exit(1);
  }
  resolveReportArg(arg)
    .then(r => critiqueVerdict(r))
    .then(v => { console.log(JSON.stringify(v, null, 2)); })
    .catch(e => { console.error(JSON.stringify({ error: e.message })); process.exit(1); });
}
