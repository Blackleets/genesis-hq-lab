// copilot.mjs — Genesis Trading Co-Pilot.
//
// Assisted manual trading: given a pair + side the operator is considering, returns
// Genesis's real read using the SAME engines that drive the bot — evaluateSignal,
// marketIntelligence, globalRiskEngine, cryptoRisk, live params. Deterministic, no LLM.
//
// SAFETY: assertTradeAllowed() is the authoritative gate. The co-pilot never bypasses
// safe mode or risk systems — it informs, and execution is re-validated server-side.

import { evaluateSignal, computeHtfTrend } from './signal.mjs';
import { classifyRegime, BIAS } from './regime.mjs';
import { getParams } from './strategyParams.mjs';
import { buildAssetContext } from './priceFeeder.mjs';
import { getMarketIntelligence } from './marketIntelligence.mjs';
import { getGlobalRiskDiagnostics } from '../risk/globalRiskEngine.mjs';
import {
  getCryptoRiskConfig, exceedsDailyCap, isAssetInCooldown, dailyCryptoRealizedPnl,
} from './cryptoRisk.mjs';
import db from '../db/database.mjs';

const BINANCE = process.env.BINANCE_BASE || 'https://data-api.binance.vision/api/v3';
const NOTIONAL = 100;  // paper position size used for EV in dollars

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

// ── Signal breakdown: WHY LONG / WHY NOT, each condition checked independently ─

export function buildSignalBreakdown(ctx, side, params) {
  const positive = [];
  const negative = [];
  const isLong = side === 'LONG';

  // EMA trend
  const sep = (ctx.ema9 - ctx.ema21) / ctx.ema21;
  const trendOk = isLong ? sep >= params.emaMarginPct : sep <= -params.emaMarginPct;
  (trendOk ? positive : negative).push(
    trendOk
      ? `EMA9 ${isLong ? 'above' : 'below'} EMA21 by ${Math.abs(sep * 100).toFixed(2)}%`
      : `EMA trend not ${isLong ? 'bullish' : 'bearish'} (sep ${(sep * 100).toFixed(2)}%)`
  );

  // 1h momentum
  const momOk = isLong ? ctx.change1h >= params.momentumPct : ctx.change1h <= -params.momentumPct;
  (momOk ? positive : negative).push(
    momOk
      ? `1h momentum ${ctx.change1h > 0 ? '+' : ''}${ctx.change1h}%`
      : `Momentum ${ctx.change1h}% not ${isLong ? '≥' : '≤'} ${isLong ? '+' : '-'}${params.momentumPct}%`
  );

  // RSI band
  const band = isLong
    ? { lo: params.rsiLongMin,  hi: params.rsiLongMax }
    : { lo: params.rsiShortMin, hi: params.rsiShortMax };
  const rsiOk = ctx.rsi14 >= band.lo && ctx.rsi14 <= band.hi;
  (rsiOk ? positive : negative).push(
    rsiOk
      ? `RSI ${ctx.rsi14} in ${side} band [${band.lo}–${band.hi}]`
      : `RSI ${ctx.rsi14} outside ${side} band [${band.lo}–${band.hi}]`
  );

  // Volume floor
  const volOk = ctx.volume24h >= params.minVolume24h;
  (volOk ? positive : negative).push(
    volOk
      ? `Volume $${Math.round(ctx.volume24h).toLocaleString()} above floor`
      : `Volume $${Math.round(ctx.volume24h).toLocaleString()} below $${params.minVolume24h.toLocaleString()} floor`
  );

  // HTF trend
  if (params.useHtfFilter) {
    const htf = computeHtfTrend(ctx.closes, params);
    const against = (isLong && htf === 'bearish') || (!isLong && htf === 'bullish');
    if (against) negative.push(`Higher timeframe (${params.htfMinutes}m) is ${htf} — opposes ${side}`);
    else if (htf !== 'neutral') positive.push(`HTF ${params.htfMinutes}m ${htf} confirms`);
    else positive.push(`HTF ${params.htfMinutes}m neutral (no block)`);
  }

  return { positive, negative };
}

// ── Confidence (0–100), split by whether the engine endorses the side ─────────

export function copilotConfidence(engine, side, breakdown) {
  const pos = breakdown.positive.length;
  const neg = breakdown.negative.length;
  const posRatio = pos + neg > 0 ? pos / (pos + neg) : 0;
  if (engine.action === 'TRADE' && engine.side === side) {
    return Math.round(60 + 40 * clamp(engine.score, 0, 1));
  }
  return Math.round(50 * posRatio);
}

// ── Win probability + EV ──────────────────────────────────────────────────────

export function winProb(confidence, recentWinRate) {
  const base = confidence / 100;
  const wr = recentWinRate == null ? base : recentWinRate;
  return clamp(0.7 * base + 0.3 * wr, 0.05, 0.92);
}

export function expectedValue(pWin, targetPct, stopPct) {
  const evPct = pWin * targetPct - (1 - pWin) * stopPct;
  return { evPct, evUsd: evPct * NOTIONAL };
}

// ── Outcome simulation (normalized probabilities) ─────────────────────────────

export function simulate(pWin, change1h) {
  const flatness = clamp(1 - Math.abs(change1h) / 1.0, 0, 1); // flatter market → more timeouts
  const pTimeout = clamp(0.06 + 0.10 * flatness, 0.04, 0.25);
  let pTP = pWin * (1 - pTimeout);
  let pSL = (1 - pWin) * (1 - pTimeout);
  const sum = pTP + pSL + pTimeout;
  return {
    pTP:      Math.round((pTP / sum) * 1000) / 1000,
    pSL:      Math.round((pSL / sum) * 1000) / 1000,
    pTimeout: Math.round((pTimeout / sum) * 1000) / 1000,
  };
}

// ── Recent crypto win rate (last 20 closed) ───────────────────────────────────

function recentCryptoWinRate() {
  try {
    const rows = db.prepare(`
      SELECT pnl FROM trades
      WHERE trade_type IN ('crypto_scalp','scalp_v2','swing_v1') AND status='closed'
      ORDER BY closed_at DESC LIMIT 20
    `).all();
    if (rows.length < 5) return null;
    const wins = rows.filter(r => (r.pnl ?? 0) > 0).length;
    return wins / rows.length;
  } catch { return null; }
}

// ── Safety gate (authoritative) ───────────────────────────────────────────────

export function assertTradeAllowed({ pair }) {
  const reasons = [];

  try {
    const risk = getGlobalRiskDiagnostics();
    if (risk.safeMode)        reasons.push('Safe mode active — execution halted');
    if (risk.band === 'CRITICAL') reasons.push('System risk CRITICAL — execution halted');
  } catch { /* non-fatal: if risk engine unavailable, fall through to other checks */ }

  try {
    const cfg = getCryptoRiskConfig();
    if (exceedsDailyCap(dailyCryptoRealizedPnl(), cfg.dailyLossCapUsd)) {
      reasons.push(`Daily loss cap ($${cfg.dailyLossCapUsd}) reached`);
    }
    if (pair) {
      const last = db.prepare(`
        SELECT pnl, closed_at FROM trades
        WHERE trade_type='crypto_scalp' AND status='closed' AND asset_pair=?
        ORDER BY closed_at DESC LIMIT 1
      `).get(pair);
      if (isAssetInCooldown(last, Date.now(), cfg.cooldownMin)) {
        reasons.push(`${pair.replace('USDT', '')} cooling down after a loss`);
      }
    }
  } catch { /* non-fatal */ }

  return { blocked: reasons.length > 0, reasons };
}

// ── Fetch single-pair context from Binance ────────────────────────────────────

async function fetchContext(pair) {
  const symbol = pair.replace('USDT', '');
  const [kRes, tRes] = await Promise.all([
    fetch(`${BINANCE}/klines?symbol=${pair}&interval=1m&limit=360`, { signal: AbortSignal.timeout(8000) }),
    fetch(`${BINANCE}/ticker/24hr?symbol=${pair}`, { signal: AbortSignal.timeout(8000) }),
  ]);
  if (!kRes.ok || !tRes.ok) throw new Error(`Binance HTTP ${kRes.status}/${tRes.status}`);
  const klines = await kRes.json();
  const ticker = await tRes.json();
  if (!Array.isArray(klines) || klines.length < 22) throw new Error('Insufficient klines');
  return buildAssetContext(symbol, pair, klines, ticker);
}

// ── Main: analyze a candidate trade ───────────────────────────────────────────

export async function analyzeTrade({ pair, side }) {
  if (!['LONG', 'SHORT'].includes(side)) throw new Error('side must be LONG or SHORT');
  const params = getParams();
  const ctx    = await fetchContext(pair);

  const engine    = evaluateSignal(ctx, params);
  const breakdown = buildSignalBreakdown(ctx, side, params);
  const rawConfidence = copilotConfidence(engine, side, breakdown);

  // Phase 6B.1: directional regime bias (same source of truth as the engines).
  const directionalRegime = classifyRegime(ctx);
  const regimeBias = (BIAS[directionalRegime]?.[side] ?? 0);
  const confidence = Math.max(0, Math.min(92, rawConfidence + regimeBias));

  let risk = { score: 0, band: 'HEALTHY', safeMode: false };
  try {
    const r = getGlobalRiskDiagnostics();
    risk = { score: r.score ?? 0, band: r.band ?? 'HEALTHY', safeMode: r.safeMode ?? false };
  } catch { /* non-fatal */ }

  let regime = 'Scalp', momentum = 'Neutral', volatility = 'Low';
  try {
    const intel = getMarketIntelligence();
    regime = intel.regime; momentum = intel.momentum; volatility = intel.volatility;
  } catch { /* non-fatal */ }

  const isLong = side === 'LONG';
  const entry  = ctx.price;
  const tp = isLong ? entry * (1 + params.targetPct) : entry * (1 - params.targetPct);
  const sl = isLong ? entry * (1 - params.stopPct)   : entry * (1 + params.stopPct);

  const pWin = winProb(confidence, recentCryptoWinRate());
  const { evPct, evUsd } = expectedValue(pWin, params.targetPct, params.stopPct);
  const simulation = simulate(pWin, ctx.change1h);
  const safety = assertTradeAllowed({ pair });

  return {
    pair,
    side,
    price: Math.round(entry * 100) / 100,
    confidence,
    engineEndorsed: engine.action === 'TRADE' && engine.side === side,
    risk,
    tp:    Math.round(tp * 100) / 100,
    sl:    Math.round(sl * 100) / 100,
    tpPct: Math.round(params.targetPct * 10000) / 100,
    slPct: Math.round(params.stopPct * 10000) / 100,
    regime, momentum, volatility,
    directionalRegime, regimeBias, rawConfidence,
    evPct: Math.round(evPct * 10000) / 100,
    evUsd: Math.round(evUsd * 100) / 100,
    winProb: Math.round(pWin * 100),
    positive: breakdown.positive,
    negative: breakdown.negative,
    simulation,
    safety,
  };
}
