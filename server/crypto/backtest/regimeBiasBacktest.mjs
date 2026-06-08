// regimeBiasBacktest.mjs — Phase 6B.1 validation.
//
// Replays every CLOSED crypto trade: reconstructs the real regime at entry from
// historical 1m klines, applies the regime bias to the stored entry confidence, and
// checks whether the trade would still clear the gate (0.65). Reports BEFORE (all
// trades) vs AFTER (survivors) on win rate, expectancy, profit factor, false
// positives and calibration. Read-only — never writes trades or capital.
//
// Run: node server/crypto/backtest/regimeBiasBacktest.mjs

import db from '../../db/database.mjs';
import { computeEma, computeRsi } from '../priceFeeder.mjs';
import { classifyRegime, applyRegimeBias } from '../regime.mjs';
import { scalpConfig } from '../../strategies/scalpingEngine.mjs';

const BINANCE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const GATE = scalpConfig().minConfidence; // 0.65

// ── Build a regime-classification ctx from historical 1m klines ending at ts ────
async function regimeAtEntry(pair, openedAtIso) {
  const endMs = Date.parse(openedAtIso);
  if (!Number.isFinite(endMs)) return null;
  try {
    const r = await fetch(`${BINANCE}/klines?symbol=${pair}&interval=1m&endTime=${endMs}&limit=360`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const klines = await r.json();
    if (!Array.isArray(klines) || klines.length < 70) return null;
    const closes = klines.map(k => parseFloat(k[4]));
    const ema9 = computeEma(closes, 9);
    const ema21 = computeEma(closes, 21);
    const change1h = ((closes[closes.length - 1] - closes[closes.length - 60]) / closes[closes.length - 60]) * 100;
    return classifyRegime({ ema9, ema21, change1h, closes });
  } catch { return null; }
}

// ── Metrics over a set of trades ────────────────────────────────────────────────
function metrics(trades) {
  const n = trades.length;
  if (n === 0) return { trades: 0, winRate: 0, expectancy: 0, profitFactor: 0, falsePositives: 0, calibration: null };
  const wins = trades.filter(t => (t.pnl ?? 0) > 0);
  const grossWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(trades.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + (t.pnl ?? 0), 0));
  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const fp = trades.filter(t => (t.confidence ?? 0) >= 0.70 && (t.pnl ?? 0) <= 0).length;
  const cal = trades.reduce((s, t) => s + Math.abs((t.confidence ?? 0) - ((t.pnl ?? 0) > 0 ? 1 : 0)), 0) / n;
  return {
    trades: n,
    winRate: Math.round((wins.length / n) * 1000) / 10,
    expectancy: Math.round((totalPnl / n) * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : (grossWin > 0 ? Infinity : 0),
    falsePositives: fp,
    calibration: Math.round((1 - cal) * 100),
  };
}

export async function runRegimeBiasBacktest() {
  const rows = db.prepare(`
    SELECT id, asset_pair AS pair, outcome AS side, pnl, confidence, opened_at
    FROM trades
    WHERE trade_type IN ('scalp_v2','swing_v1') AND status='closed' AND pnl IS NOT NULL
    ORDER BY opened_at ASC
  `).all();

  if (rows.length === 0) {
    return { before: metrics([]), after: metrics([]), rejected: 0, classified: 0, total: 0, byRegime: {}, evaluated: [] };
  }

  // Reconstruct regimes with a small concurrency pool (keeps ~80 fetches fast).
  const regimes = new Array(rows.length);
  const POOL = 6;
  let idx = 0;
  await Promise.all(Array.from({ length: POOL }, async () => {
    while (idx < rows.length) {
      const i = idx++;
      regimes[i] = await regimeAtEntry(rows[i].pair, rows[i].opened_at);
    }
  }));

  const evaluated = [];
  const byRegime = {};
  let classified = 0;
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i];
    const regime = regimes[i];
    if (regime) classified++;
    const reg = regime ?? 'RANGE';
    const { confidence: biased, bias } = applyRegimeBias(t.confidence ?? 0, t.side, reg);
    const survives = biased >= GATE;
    evaluated.push({ ...t, regime: reg, biasedConfidence: biased, bias, survives });
    const key = `${t.side}|${reg}`;
    const g = byRegime[key] ?? (byRegime[key] = { side: t.side, regime: reg, trades: 0, wins: 0, rejected: 0, pnl: 0 });
    g.trades++; if ((t.pnl ?? 0) > 0) g.wins++; if (!survives) g.rejected++; g.pnl += t.pnl ?? 0;
  }

  const before = metrics(evaluated);
  const survivors = evaluated.filter(t => t.survives);
  const after = metrics(survivors);
  const rejected = evaluated.length - survivors.length;

  return { before, after, rejected, classified, total: evaluated.length, byRegime, evaluated };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('regimeBiasBacktest.mjs')) {
  const res = await runRegimeBiasBacktest();
  const pf = (x) => x === Infinity ? '∞' : x;
  console.log('\n══════════ REGIME BIAS BACKTEST ══════════');
  console.log(`Trades: ${res.total} | regime-classified from klines: ${res.classified} | gate: ${GATE}`);
  console.log(`Bias would reject ${res.rejected} countertrend trades.\n`);
  console.log('Metric          BEFORE      AFTER');
  console.log(`Trades          ${String(res.before.trades).padEnd(11)} ${res.after.trades}`);
  console.log(`Win rate        ${(res.before.winRate + '%').padEnd(11)} ${res.after.winRate}%`);
  console.log(`Expectancy      ${('$' + res.before.expectancy).padEnd(11)} $${res.after.expectancy}`);
  console.log(`Profit factor   ${String(pf(res.before.profitFactor)).padEnd(11)} ${pf(res.after.profitFactor)}`);
  console.log(`False positives ${String(res.before.falsePositives).padEnd(11)} ${res.after.falsePositives}`);
  console.log(`Calibration     ${String(res.before.calibration).padEnd(11)} ${res.after.calibration}`);
  console.log('\nBy side × regime (rejected = pushed below gate):');
  for (const g of Object.values(res.byRegime).sort((a, b) => b.trades - a.trades)) {
    const wr = g.trades ? Math.round(g.wins / g.trades * 100) : 0;
    console.log(`  ${g.side.padEnd(5)} ${g.regime.padEnd(15)} trades ${String(g.trades).padStart(3)} | win ${String(wr).padStart(3)}% | pnl $${g.pnl.toFixed(2).padStart(7)} | rejected ${g.rejected}`);
  }
  console.log('══════════════════════════════════════════\n');
  process.exit(0);
}
