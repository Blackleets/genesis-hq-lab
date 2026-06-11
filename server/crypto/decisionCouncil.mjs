// decisionCouncil.mjs — Genesis Decision Council.
//
// Multi-agent trade-desk decision layer inspired by TradingAgents
// (Analyst Team → Bull/Bear debate → Trader synthesis → Risk review →
// Portfolio Manager approval → decision memory), reimplemented natively
// for Genesis:
//
//   · Every role is a deterministic function over REAL data (signal
//     components, cost model, regime classifier, treasury, trade history).
//     No LLM in the hot path, no invented numbers — when a source is
//     unavailable the report says "insufficient_data", same contract as
//     the rest of Genesis.
//   · evaluateTrade(signal, context) returns the structured decision
//     object and persists it via decisionMemory. The execution engine
//     refuses any order without a fresh approved decision_id, so the
//     Council cannot be bypassed.
//
// Roles: Technical Analyst, Sentiment/News Analyst, Market Regime Analyst,
// Bull Researcher, Bear Researcher, Trader, Risk Manager, Portfolio Manager.

import db from '../db/database.mjs';
import { getTreasury } from '../trading/treasury.mjs';
import { getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import {
  getCryptoFeePct,
  getCryptoFuturesFeePct,
  cryptoSlippagePct,
  cryptoFuturesSlippagePct,
} from '../trading/costs.mjs';
import { BIAS } from './regime.mjs';
import { getSetupPerformance, setupKey } from './autoVeto.mjs';
import {
  newDecisionId,
  normalizeSide,
  saveDecision,
  getLessonsForSimilarTrades,
  getDailyRealizedPnlUsd,
  getLossStreak,
  getLastLossAt,
} from './decisionMemory.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';

// ── Configurable hard thresholds (Fase 6 risk gate) ───────────────────────────
const MIN_RR = parseFloat(process.env.COUNCIL_MIN_RR ?? '1.5');
const MIN_CONFIDENCE = parseFloat(process.env.COUNCIL_MIN_CONFIDENCE ?? '0.60');
const MIN_PF = parseFloat(process.env.COUNCIL_MIN_PF ?? '0.9');
const MIN_WIN_RATE = parseFloat(process.env.COUNCIL_MIN_WIN_RATE ?? '0.35');
const MIN_SETUP_SAMPLES = parseInt(process.env.COUNCIL_MIN_SETUP_SAMPLES ?? '12', 10);
const MAX_LOSS_STREAK = parseInt(process.env.COUNCIL_MAX_LOSS_STREAK ?? '5', 10);
const MAX_DAILY_LOSS_PCT = parseFloat(process.env.COUNCIL_MAX_DAILY_LOSS_PCT ?? '0.03');
const COOLDOWN_MIN = parseInt(process.env.COUNCIL_COOLDOWN_MIN ?? '30', 10);
const MAX_OPEN_EXPOSURE_PCT = parseFloat(process.env.COUNCIL_MAX_EXPOSURE_PCT ?? '0.30');

const round2 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const round4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
const pct = (x) => `${(x * 100).toFixed(2)}%`;

// ── Context builder — every field read from real Genesis sources ──────────────

function buildContext(signal, overrides = {}) {
  const ctx = { ...overrides };
  if (!ctx.treasury) {
    try { ctx.treasury = getTreasury(); } catch { ctx.treasury = null; }
  }
  if (!ctx.risk) {
    try { ctx.risk = getGlobalRiskDiagnostics(); } catch { ctx.risk = null; }
  }
  if (!ctx.setupStats) {
    try { ctx.setupStats = getSetupPerformance(); } catch { ctx.setupStats = []; }
  }
  if (ctx.openPositions === undefined) {
    try {
      ctx.openPositions = db.prepare(
        "SELECT asset_pair, trade_type, outcome AS side, capital_used FROM trades WHERE status = 'open'",
      ).all();
    } catch { ctx.openPositions = []; }
  }
  if (ctx.dailyPnlUsd === undefined) {
    try { ctx.dailyPnlUsd = getDailyRealizedPnlUsd(); } catch { ctx.dailyPnlUsd = 0; }
  }
  if (ctx.lossStreak === undefined) {
    try { ctx.lossStreak = getLossStreak(signal.tradeType ?? null); } catch { ctx.lossStreak = 0; }
  }
  if (ctx.lastLossAt === undefined) {
    try {
      ctx.lastLossAt = (signal.pair && signal.tradeType)
        ? getLastLossAt(signal.pair, signal.tradeType)
        : null;
    } catch { ctx.lastLossAt = null; }
  }
  if (ctx.lessons === undefined) {
    try {
      ctx.lessons = getLessonsForSimilarTrades(
        { symbol: signal.symbol, strategy: signal.strategy, side: signal.side });
    } catch { ctx.lessons = []; }
  }
  // sentiment/news: Genesis has no live news source wired yet — stays null
  // unless a caller provides real items; the analyst then reports
  // insufficient_data instead of inventing narrative.
  ctx.newsItems = ctx.newsItems ?? null;
  ctx.nowMs = ctx.nowMs ?? Date.now();
  return ctx;
}

// ── Economics — entry/stop/target, costs, EV (all from the real cost model) ──

/** Spread estimate by liquidity tier; Genesis's cost model folds spread into
 *  slippage, so this is a conservative explicit estimate, flagged as such. */
function estimateSpreadPct(volume24h) {
  if (!Number.isFinite(volume24h) || volume24h <= 0) return 0.001;
  if (volume24h >= 1_000_000_000) return 0.0002;
  if (volume24h >= 100_000_000) return 0.0005;
  return 0.001;
}

function computeEconomics(signal, context) {
  const isFutures = signal.instrumentType === 'futures';
  const isBinary = signal.strategy === 'event_alpha';
  const capital = signal.capitalUsed ?? 0;
  const leverage = isFutures ? Math.max(1, signal.leverage ?? 1) : 1;
  const notional = capital * leverage;

  if (isBinary) {
    // Binary prediction market: win pays (1 - entry) per share, loss costs entry.
    const entry = signal.entryPrice;
    const shares = entry > 0 ? capital / entry : 0;
    const rewardUsd = (1 - entry) * shares;
    const riskUsd = capital;
    const p = signal.genesisProb ?? signal.confidence ?? null;
    const feeUsd = p != null ? 0.02 * rewardUsd : 0; // 2% of winnings (Polymarket)
    const slipPct = cryptoSlippagePct(capital, signal.volume24h ?? 0);
    const slipUsd = slipPct * capital;
    const grossEv = p == null ? null : p * rewardUsd - (1 - p) * riskUsd;
    const ev = grossEv == null ? null : grossEv - p * 0.02 * rewardUsd - slipUsd;
    return {
      isBinary, notional, entry, stopLoss: 0, takeProfit: 1,
      rewardUsd, riskUsd, riskReward: riskUsd > 0 ? rewardUsd / riskUsd : null,
      feesUsd: feeUsd, spreadPct: 0, spreadUsd: 0, slipPct, slipUsd,
      pWin: p, pSource: 'genesis_debate', grossEv, ev,
    };
  }

  const entry = signal.entryPrice;
  const targetPct = signal.targetPct ?? (signal.targetPrice && entry
    ? Math.abs(signal.targetPrice - entry) / entry : null);
  const stopPct = signal.stopPct ?? (signal.stopPrice && entry
    ? Math.abs(signal.stopPrice - entry) / entry : null);
  if (entry == null || targetPct == null || stopPct == null || stopPct <= 0) {
    return { insufficient: true };
  }

  const sideUp = normalizeSide(signal.side) === 'long';
  const takeProfit = sideUp ? entry * (1 + targetPct) : entry * (1 - targetPct);
  const stopLoss = sideUp ? entry * (1 - stopPct) : entry * (1 + stopPct);
  const rewardUsd = targetPct * notional;
  const riskUsd = stopPct * notional;
  const feePct = isFutures ? getCryptoFuturesFeePct() : getCryptoFeePct();
  const feesUsd = feePct * notional * 2; // entry + exit
  const slipPct = isFutures
    ? cryptoFuturesSlippagePct(notional, signal.volume24h ?? 0)
    : cryptoSlippagePct(capital, signal.volume24h ?? 0);
  const slipUsd = slipPct * notional * 2;
  const spreadPct = estimateSpreadPct(signal.volume24h);
  const spreadUsd = spreadPct * notional;

  // Win probability: real setup history when there is enough of it, otherwise
  // the engine's own stated confidence (the only real estimate available —
  // history takes over as soon as MIN_SETUP_SAMPLES trades exist).
  const stats = (context.setupStats ?? []).find(
    (s) => s.key === setupKey((signal.side ?? '').toUpperCase(), signal.regime ?? 'RANGE'));
  const useHistory = stats && stats.samples >= MIN_SETUP_SAMPLES && stats.winRate != null;
  const pWin = useHistory ? stats.winRate : (signal.confidence ?? null);
  const grossEv = pWin == null ? null : pWin * rewardUsd - (1 - pWin) * riskUsd;
  const ev = grossEv == null ? null : grossEv - (feesUsd + spreadUsd + slipUsd);

  return {
    isBinary, notional, entry, stopLoss, takeProfit,
    rewardUsd, riskUsd, riskReward: riskUsd > 0 ? rewardUsd / riskUsd : null,
    feesUsd, spreadPct, spreadUsd, slipPct, slipUsd,
    pWin, pSource: useHistory ? `setup_history(n=${stats.samples})` : 'signal_confidence',
    setupStats: stats ?? null, grossEv, ev,
  };
}

// ── Role 1: Technical Analyst ─────────────────────────────────────────────────

function technicalAnalyst(signal, eco) {
  if (eco.insufficient) {
    return { ok: false, report: 'insufficient_data — missing entry/stop/target; cannot assess the setup.' };
  }
  const lines = [];
  const sig = (signal.signals ?? []).join(', ') || 'none reported';
  lines.push(`Setup: ${signal.strategy} ${normalizeSide(signal.side)} ${signal.symbol} @ ${eco.entry}.`);
  lines.push(`Signals: ${sig}.`);
  if (signal.rsi14 != null) lines.push(`Momentum: RSI14 ${signal.rsi14}.`);
  if (!eco.isBinary) {
    lines.push(`Levels: TP ${round4(eco.takeProfit)} / SL ${round4(eco.stopLoss)} (stop distance ${pct(Math.abs(eco.entry - eco.stopLoss) / eco.entry)}).`);
  }
  lines.push(`Risk/reward: ${eco.riskReward != null ? eco.riskReward.toFixed(2) : 'n/a'} (reward $${round2(eco.rewardUsd)} vs risk $${round2(eco.riskUsd)}).`);
  lines.push(`Entry quality: costs round-trip $${round2(eco.feesUsd + eco.spreadUsd + eco.slipUsd)} ` +
    `(fees $${round2(eco.feesUsd)}, spread $${round2(eco.spreadUsd)}, slippage $${round2(eco.slipUsd)}) ` +
    `= ${pct((eco.feesUsd + eco.spreadUsd + eco.slipUsd) / Math.max(1e-9, eco.notional))} of notional.`);
  return { ok: true, report: lines.join('\n') };
}

// ── Role 2: Sentiment / News Analyst (never invents) ──────────────────────────

function sentimentAnalyst(context) {
  const items = context.newsItems;
  if (!items || items.length === 0) {
    return {
      verdict: 'insufficient_data',
      report: 'insufficient_data — no live news/sentiment source is wired into Genesis; '
        + 'catalyst risk unassessed. This analyst abstains rather than inventing narrative.',
    };
  }
  const lines = items.slice(0, 5).map((n) => `- ${n.title ?? n.text ?? String(n)}`);
  return { verdict: 'reported', report: `Recent items considered:\n${lines.join('\n')}` };
}

// ── Role 3: Market Regime Analyst ─────────────────────────────────────────────

function regimeAnalyst(signal) {
  const regime = signal.regime ?? null;
  if (!regime || !BIAS[regime]) {
    return { regime: regime ?? 'UNKNOWN', compatible: null, report: `insufficient_data — regime not classified for ${signal.symbol}.` };
  }
  const sideKey = normalizeSide(signal.side) === 'long' ? 'LONG' : 'SHORT';
  const bias = BIAS[regime][sideKey];
  const compatible = bias > -10; // hard incompatibility: heavy penalty regimes
  const fit = bias > 0 ? 'favorable' : bias === 0 ? 'neutral' : compatible ? 'unfavorable' : 'incompatible';
  const strategyNote = signal.strategy === 'swing_v1' && regime === 'RANGE'
    ? ' swing_v1 prefers trending regimes; RANGE weakens multi-TF follow-through.'
    : signal.strategy === 'scalp_v2' && regime === 'HIGH_VOLATILITY'
      ? ' scalp_v2 stops are tight for HIGH_VOLATILITY conditions.'
      : '';
  return {
    regime, compatible,
    report: `Regime ${regime}: ${fit} for ${sideKey} (bias ${bias > 0 ? '+' : ''}${bias} pts).${strategyNote}`,
  };
}

// ── Roles 4/5: Bull & Bear Researchers (adversarial cases over real evidence) ─

function bullResearcher(signal, eco, regimeRep, context) {
  const pts = [];
  if ((signal.signals ?? []).length > 0) pts.push(`Confluence of ${signal.signals.length} real signals: ${signal.signals.join(', ')}.`);
  if (eco.riskReward != null && eco.riskReward >= MIN_RR) pts.push(`Asymmetric payoff: RR ${eco.riskReward.toFixed(2)} ≥ ${MIN_RR}.`);
  if (regimeRep.compatible && /favorable/.test(regimeRep.report)) pts.push(`Regime tailwind: ${regimeRep.regime} favours this side.`);
  if (eco.setupStats && eco.setupStats.samples >= MIN_SETUP_SAMPLES && eco.setupStats.profitFactor > 1) {
    pts.push(`Setup has real edge: PF ${eco.setupStats.profitFactor} over ${eco.setupStats.samples} trades.`);
  }
  if (eco.ev != null && eco.ev > 0) pts.push(`Positive net EV after all costs: $${round2(eco.ev)} (p=${round2(eco.pWin)} from ${eco.pSource}).`);
  if (signal.confidence != null && signal.confidence >= 0.75) pts.push(`Engine conviction high: ${pct(signal.confidence)}.`);
  if (pts.length === 0) pts.push('No strong affirmative evidence — the bull case is thin.');
  return { case: pts.join('\n') };
}

function bearResearcher(signal, eco, regimeRep, context) {
  const pts = [];
  const costs = eco.insufficient ? null : eco.feesUsd + eco.spreadUsd + eco.slipUsd;
  if (eco.insufficient) pts.push('Setup is underspecified (missing levels) — unquantifiable risk.');
  if (eco.riskReward != null && eco.riskReward < MIN_RR) pts.push(`Payoff too thin: RR ${eco.riskReward.toFixed(2)} < ${MIN_RR}.`);
  if (costs != null && eco.grossEv != null && costs >= eco.grossEv && eco.grossEv > 0) {
    pts.push(`Costs eat the edge: $${round2(costs)} round-trip vs gross EV $${round2(eco.grossEv)}.`);
  }
  if (eco.ev != null && eco.ev <= 0) pts.push(`Net expected value is non-positive: $${round2(eco.ev)}.`);
  if (regimeRep.compatible === false) pts.push(`Regime headwind: ${regimeRep.regime} is incompatible with this side.`);
  if (eco.setupStats && eco.setupStats.samples >= MIN_SETUP_SAMPLES && eco.setupStats.profitFactor < 1) {
    pts.push(`History argues against: PF ${eco.setupStats.profitFactor} over ${eco.setupStats.samples} trades.`);
  }
  if ((context.lossStreak ?? 0) >= 3) pts.push(`Desk is on a ${context.lossStreak}-loss streak — execution quality suspect.`);
  if ((context.dailyPnlUsd ?? 0) < 0) pts.push(`Today is already negative: $${round2(context.dailyPnlUsd)} realized.`);
  if (context.lessons?.length) pts.push(`Memory: ${context.lessons[0]}`);
  if (pts.length === 0) pts.push('No strong negative evidence beyond normal market risk.');
  return { case: pts.join('\n') };
}

// ── Role 6: Trader (synthesis → long | short | no_trade) ─────────────────────

function traderAgent(signal, eco, bull, bear) {
  const bullPoints = bull.case.split('\n').filter((l) => !l.startsWith('No strong')).length;
  const bearPoints = bear.case.split('\n').filter((l) => !l.startsWith('No strong')).length;
  const evOk = eco.ev != null && eco.ev > 0;
  const proposed = (!eco.insufficient && evOk && bullPoints >= bearPoints)
    ? normalizeSide(signal.side)
    : 'no_trade';
  const summary = proposed === 'no_trade'
    ? `Trader declines: bull ${bullPoints} pts vs bear ${bearPoints} pts, net EV ${eco.ev != null ? `$${round2(eco.ev)}` : 'unknown'} — the debate does not support paying the costs.`
    : `Trader proposes ${proposed.toUpperCase()} ${signal.symbol}: bull case outweighs bear (${bullPoints} vs ${bearPoints} pts) with net EV $${round2(eco.ev)} after costs at p=${round2(eco.pWin)} (${eco.pSource}).`;
  return { proposed, summary };
}

// ── Role 7: Risk Manager — hard gates (Fase 6) ────────────────────────────────

function riskManager(signal, eco, regimeRep, trader, context) {
  const rejections = [];
  const treasury = context.treasury;

  if (eco.insufficient) rejections.push('insufficient_data');
  if (trader.proposed === 'no_trade') rejections.push('trader_no_trade');
  if (!eco.isBinary && eco.riskReward != null && eco.riskReward < MIN_RR) rejections.push(`risk_reward_below_${MIN_RR}`);
  if (eco.ev == null) rejections.push('expected_value_unknown');
  else if (eco.ev <= 0) {
    rejections.push(eco.grossEv != null && eco.grossEv > 0 ? 'costs_destroy_edge' : 'negative_expected_value');
  }
  if (signal.confidence == null || signal.confidence < MIN_CONFIDENCE) rejections.push(`confidence_below_${MIN_CONFIDENCE}`);
  if (eco.setupStats && eco.setupStats.samples >= MIN_SETUP_SAMPLES) {
    if (eco.setupStats.profitFactor < MIN_PF) rejections.push('setup_profit_factor_below_floor');
    if (eco.setupStats.winRate != null && eco.setupStats.winRate < MIN_WIN_RATE) rejections.push('setup_win_rate_below_floor');
  }
  const dup = (context.openPositions ?? []).some(
    (p) => p.asset_pair === signal.pair && p.trade_type === signal.tradeType);
  if (dup) rejections.push('duplicate_position');
  if (context.lastLossAt) {
    const minsSince = (context.nowMs - new Date(context.lastLossAt).getTime()) / 60000;
    if (minsSince >= 0 && minsSince < COOLDOWN_MIN) rejections.push('cooldown_active');
  }
  const totalCapital = treasury?.total ?? null;
  if (totalCapital != null && (context.dailyPnlUsd ?? 0) <= -(MAX_DAILY_LOSS_PCT * totalCapital)) {
    rejections.push('daily_max_loss_reached');
  }
  if ((context.lossStreak ?? 0) >= MAX_LOSS_STREAK) rejections.push('loss_streak_limit');
  if (regimeRep.compatible === false) rejections.push('regime_incompatible');

  return {
    verdict: rejections.length === 0 ? 'approved' : 'rejected',
    rejections,
  };
}

// ── Role 8: Portfolio Manager — final word ────────────────────────────────────

function portfolioManager(signal, eco, riskVerdict, context) {
  if (riskVerdict.verdict !== 'approved') {
    return { verdict: 'rejected', reason: `risk_manager_rejected:${riskVerdict.rejections[0]}` };
  }
  const t = context.treasury;
  const risk = context.risk;
  if (!t) return { verdict: 'rejected', reason: 'treasury_unavailable' };
  if (t.isPaused) return { verdict: 'rejected', reason: 'drawdown_pause' };
  if (risk && (risk.band === 'CRITICAL' || risk.band === 'HIGH_RISK')) {
    return { verdict: 'rejected', reason: `risk_band_${risk.band}` };
  }
  if ((signal.capitalUsed ?? 0) > (t.available ?? 0)) {
    return { verdict: 'rejected', reason: 'insufficient_available_capital' };
  }
  const openExposure = (context.openPositions ?? []).reduce((s, p) => s + (p.capital_used ?? 0), 0);
  if (t.total > 0 && (openExposure + (signal.capitalUsed ?? 0)) > MAX_OPEN_EXPOSURE_PCT * t.total) {
    return { verdict: 'rejected', reason: 'open_exposure_cap' };
  }
  return { verdict: 'approved', reason: '' };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Evaluate a trade signal through the full council. Persists and returns the
 * structured decision. If final_decision !== 'approved', the execution layer
 * will refuse to open the trade (enforced in paperExecutionEngine/execution).
 *
 * @param {{
 *   strategy: string,            // 'scalp_v2' | 'swing_v1' | 'event_alpha' | 'breakout_v1' | futures profiles
 *   symbol: string, pair?: string,
 *   side: 'LONG'|'SHORT'|'YES'|'NO',
 *   entryPrice: number,
 *   targetPct?: number, stopPct?: number,
 *   targetPrice?: number, stopPrice?: number,
 *   confidence: number,          // 0–1, engine's own estimate
 *   capitalUsed: number,         // USD margin/capital
 *   leverage?: number, instrumentType?: 'spot'|'futures',
 *   volume24h?: number, regime?: string, signals?: string[],
 *   rsi14?: number, agentId?: string, tradeType?: string,
 *   genesisProb?: number,        // event_alpha only
 * }} signal
 * @param {object} [contextOverrides]  injectable for tests (treasury, risk,
 *   setupStats, openPositions, dailyPnlUsd, lossStreak, lastLossAt, lessons, nowMs)
 */
export async function evaluateTrade(signal, contextOverrides = {}) {
  const context = buildContext(signal, contextOverrides);
  const eco = computeEconomics(signal, context);

  const technical = technicalAnalyst(signal, eco);
  const sentiment = sentimentAnalyst(context);
  const regimeRep = regimeAnalyst(signal);
  const bull = bullResearcher(signal, eco, regimeRep, context);
  const bear = bearResearcher(signal, eco, regimeRep, context);
  const trader = traderAgent(signal, eco, bull, bear);
  const riskVerdict = riskManager(signal, eco, regimeRep, trader, context);
  const pm = portfolioManager(signal, eco, riskVerdict, context);

  const finalApproved = riskVerdict.verdict === 'approved' && pm.verdict === 'approved';
  const rejectionReason = finalApproved ? '' : (
    riskVerdict.verdict !== 'approved' ? riskVerdict.rejections.join(', ') : pm.reason);

  const decision = {
    decision_id: newDecisionId(),
    timestamp: new Date(context.nowMs).toISOString(),
    symbol: signal.symbol,
    asset_pair: signal.pair ?? null,
    strategy: signal.strategy,
    trade_type: signal.tradeType ?? null,
    agent_id: signal.agentId ?? null,
    side: finalApproved ? normalizeSide(signal.side) : (trader.proposed === 'no_trade' ? 'no_trade' : normalizeSide(signal.side)),
    entry: round4(eco.entry ?? signal.entryPrice ?? null),
    stop_loss: round4(eco.stopLoss),
    take_profit: round4(eco.takeProfit),
    risk_reward: round2(eco.riskReward),
    position_size: round2(signal.capitalUsed),
    risk_usd: round2(eco.riskUsd),
    fees_estimated: round2(eco.feesUsd),
    spread_estimated: round2(eco.spreadUsd),
    slippage_estimated: round2(eco.slipUsd),
    expected_value: round2(eco.ev),
    profit_factor: eco.setupStats?.samples >= MIN_SETUP_SAMPLES
      ? (eco.setupStats.profitFactor === Infinity ? 999 : eco.setupStats.profitFactor)
      : null,
    win_rate: eco.setupStats?.samples >= MIN_SETUP_SAMPLES ? eco.setupStats.winRate : null,
    confidence: round2(signal.confidence),
    market_regime: regimeRep.regime,
    technical_report: technical.report,
    sentiment_report: sentiment.report,
    bull_case: bull.case,
    bear_case: bear.case,
    trader_summary: trader.summary,
    risk_manager_verdict: riskVerdict.verdict,
    portfolio_manager_verdict: pm.verdict,
    final_decision: finalApproved ? 'approved' : 'rejected',
    rejection_reason: rejectionReason,
    lessons_from_similar_trades: context.lessons ?? [],
  };

  try {
    saveDecision(decision);
  } catch (err) {
    // A decision that cannot be persisted cannot be audited → fail closed.
    decision.final_decision = 'rejected';
    decision.rejection_reason = `decision_persist_failed: ${err?.message ?? 'unknown'}`;
  }

  logEvent({
    category: CATEGORY.RISK,
    severity: finalApproved ? SEVERITY.INFO : SEVERITY.WARNING,
    subsystem: 'decision-council',
    reason: `COUNCIL ${decision.final_decision.toUpperCase()} — ${signal.strategy} ${decision.side} ${signal.symbol}`
      + (finalApproved ? ` | EV $${decision.expected_value}` : ` | ${rejectionReason}`),
    metadata: {
      decisionId: decision.decision_id, strategy: signal.strategy, symbol: signal.symbol,
      side: decision.side, ev: decision.expected_value, rr: decision.risk_reward,
      finalDecision: decision.final_decision, rejectionReason,
    },
  });

  return decision;
}

/** Thresholds snapshot (dashboard + diagnostics). */
export function getCouncilConfig() {
  return {
    minRiskReward: MIN_RR,
    minConfidence: MIN_CONFIDENCE,
    minProfitFactor: MIN_PF,
    minWinRate: MIN_WIN_RATE,
    minSetupSamples: MIN_SETUP_SAMPLES,
    maxLossStreak: MAX_LOSS_STREAK,
    maxDailyLossPct: MAX_DAILY_LOSS_PCT,
    cooldownMinutes: COOLDOWN_MIN,
    maxOpenExposurePct: MAX_OPEN_EXPOSURE_PCT,
  };
}
