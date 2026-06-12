// commentaryEngine.mjs — Genesis AI Commentary System.
//
// Narrates Genesis's reasoning in a professional quant-desk voice. Hybrid:
//   - Deterministic layer (default): templates keyed by real event type + computed
//     deltas (e.g. confidence 81 → 69). Zero hype, zero hallucination, no API cost.
//   - Claude layer (periodic): one DESK_SUMMARY line, regenerated at most once / 5 min,
//     fire-and-forget so it never blocks the HTTP response. Deterministic fallback when
//     no API key.
//
// Source of truth is real system state — getCryptoFeedEvents() (operator_events +
// trades), confidence diagnostics, and market intelligence. No fake activity.

import { getCryptoFeedEvents, getMarketIntelligence } from '../crypto/marketIntelligence.mjs';
import { getConfidenceDiagnostics } from '../intelligence/confidenceEngine.mjs';
import { routeToProvider, isProviderConfigured } from '../agents/providerRouter.mjs';

const SUMMARY_TTL_MS = 5 * 60 * 1000;

// Per-type minimum interval between emitted lines (ms). 0 = no floor.
const TYPE_FLOOR_MS = {
  SCANNING:  60_000,
  ANALYZING: 60_000,
};

// ── Module-level state (server is long-lived) ─────────────────────────────────
let _lastConfidence = null;       // last reported confidence score
let _summaryCache   = { text: null, ts: 0, source: 'deterministic' };
let _summaryInFlight = false;

// ── Event → CommentaryType classification ─────────────────────────────────────

export function classifyEvent(event) {
  const r = (event.reason ?? '').toUpperCase();
  const cat = (event.category ?? '').toUpperCase();
  const exitReason = event.metadata?.exitReason;

  if (event.metadata?.type === 'close') {
    if (exitReason === 'take_profit') return 'TP_HIT';
    if (exitReason === 'stop_loss')   return 'SL_HIT';
    if (exitReason === 'confidence_collapse' || exitReason === 'timeout') return 'EARLY_EXIT';
    return 'EARLY_EXIT';
  }
  if (event.metadata?.type === 'open' || r.includes('OPENED')) return 'TRADE_OPENED';

  if (r.includes('SAFE_MODE') || r.includes('SAFE MODE') || event.severity === 'CRITICAL') return 'SAFE_MODE';
  if (r.includes('BLOCKED') || r.includes('REJECTED') || r.includes('INSUFFICIENT') || r.includes('VETO')) return 'TRADE_REJECTED';
  if (r.includes('SIGNAL') || r.includes('SETUP') || r.includes('EV CHECK')) return 'SIGNAL_FOUND';
  if (cat === 'LEARNING' || r.includes('LESSON') || r.includes('LEARNED')) return 'LEARNING_UPDATE';
  if (r.includes('ANALYZING') || r.includes('ANALYSIS')) return 'ANALYZING';
  if (r.includes('SCANNING') || cat === 'SCAN') return 'SCANNING';

  return 'ANALYZING';
}

// ── Narration: event → human-readable quant-desk line ─────────────────────────

export function narrate(event) {
  const type = classifyEvent(event);
  const m    = event.metadata ?? {};
  const pair = (m.pair ?? '').replace('USDT', '');
  const conf = m.confidence != null ? `${Math.round(m.confidence * 100)}%` : null;

  let text, detail = '';

  switch (type) {
    case 'TRADE_OPENED':
      text = `${m.side ?? 'Position'} ${pair || ''} opened${m.entry ? `. Entry $${m.entry}` : ''}${conf ? `, conf ${conf}` : ''}.`.replace(/\s+/g, ' ').trim();
      detail = event.reason ?? '';
      break;
    case 'TP_HIT':
      text = `TP hit · ${pair} ${fmtPnl(m.pnl)}.`;
      detail = event.reason ?? '';
      break;
    case 'SL_HIT':
      text = `SL hit · ${pair} ${fmtPnl(m.pnl)}.`;
      detail = event.reason ?? '';
      break;
    case 'EARLY_EXIT':
      text = `Early exit · ${pair} ${fmtPnl(m.pnl)}.`;
      detail = m.exitReason ? `Reason: ${m.exitReason}.` : (event.reason ?? '');
      break;
    case 'TRADE_REJECTED':
      text = shorten(event.reason ?? 'Setup rejected.');
      detail = event.reason ?? '';
      break;
    case 'SIGNAL_FOUND':
      text = shorten(event.reason ?? `Setup found${pair ? ` · ${pair}` : ''}.`);
      detail = event.reason ?? '';
      break;
    case 'SAFE_MODE':
      text = 'Safe mode active. Trading paused.';
      detail = event.reason ?? '';
      break;
    case 'LEARNING_UPDATE':
      text = shorten(event.reason ?? 'Lesson logged.');
      detail = event.reason ?? '';
      break;
    case 'SCANNING':
      text = shorten(event.reason ?? 'Scanning market.');
      break;
    case 'ANALYZING':
    default:
      text = shorten(event.reason ?? 'Analyzing.');
      break;
  }

  return {
    id:       String(event.id),
    ts:       event.ts,
    type,
    text,
    detail,
    severity: event.severity ?? 'INFO',
    source:   'deterministic',
  };
}

function fmtPnl(pnl) {
  const n = pnl ?? 0;
  return n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`;
}

function shorten(s, max = 90) {
  const clean = String(s).replace(/\s+/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

// ── Confidence delta narration ────────────────────────────────────────────────
// Emits an ANALYZING item when the live confidence score moves ≥ 5 points.

export function confidenceDeltaItem() {
  let curr = null, band = null;
  try {
    const c = getConfidenceDiagnostics();
    curr = c.lastScore;
    band = c.lastBand;
  } catch { return null; }

  if (curr == null) return null;
  const prev = _lastConfidence;
  _lastConfidence = curr;

  if (prev == null || Math.abs(curr - prev) < 5) return null;

  const arrow = curr < prev ? '↓' : '↑';
  return {
    id:       `conf-${Date.now()}`,
    ts:       new Date().toISOString(),
    type:     'ANALYZING',
    text:     `Confidence ${Math.round(prev)} → ${Math.round(curr)} ${arrow}.`,
    detail:   band ? `Band: ${String(band).replace(/_/g, ' ')}.` : '',
    severity: curr < prev ? 'WARNING' : 'INFO',
    source:   'deterministic',
  };
}

// ── Deterministic desk summary (fallback + always-available) ───────────────────

export function deterministicSummary() {
  try {
    const intel = getMarketIntelligence();
    return `Desk: ${intel.momentum.toLowerCase()} momentum, ${intel.volatility.toLowerCase()} vol, ${intel.regime} regime. ${intel.recommendation}.`;
  } catch {
    return 'Desk: monitoring market. No qualified setup.';
  }
}

// ── LLM desk summary — prefers Gemini Flash (free), falls back to Claude ──────

async function regenerateSummaryAsync() {
  if (_summaryInFlight) return;
  const hasGemini = isProviderConfigured('gemini');
  const hasClaude = isProviderConfigured('claude');
  if (!hasGemini && !hasClaude) {
    _summaryCache = { text: deterministicSummary(), ts: Date.now(), source: 'deterministic' };
    return;
  }
  _summaryInFlight = true;
  try {
    let intelLine = '';
    try {
      const intel = getMarketIntelligence();
      intelLine = `Momentum ${intel.momentum}, volatility ${intel.volatility}, trend ${intel.trend}, regime ${intel.regime}, recommendation ${intel.recommendation}, confidence ${Math.round((intel.confidence?.score ?? 0))} (${intel.confidence?.band}), risk ${intel.risk?.band}${intel.risk?.safeMode ? ' SAFE MODE' : ''}.`;
    } catch { /* non-fatal */ }

    const system = `You are Genesis HQ's trading desk. Write ONE factual desk-update sentence (max 140 chars) summarizing current posture. Quant-desk tone: numbers over adjectives, no hype, no emojis, no exclamation marks. Plain text only.`;
    const provider = hasGemini ? 'gemini' : 'claude';
    const modelId  = hasGemini ? 'gemini-2.0-flash' : 'claude-haiku-4-5-20251001';
    const llmResult = await routeToProvider(
      [{ role: 'user', content: `State:\n${intelLine}\n\nWrite the desk update.` }],
      system,
      { provider, modelId, maxTokens: 80, timeoutMs: 15000 },
    );
    const text = (llmResult.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
    _summaryCache = text
      ? { text, ts: Date.now(), source: 'llm' }
      : { text: deterministicSummary(), ts: Date.now(), source: 'deterministic' };
  } catch (err) {
    console.warn('[commentaryEngine] summary regen failed:', err?.message);
    _summaryCache = { text: deterministicSummary(), ts: Date.now(), source: 'deterministic' };
  } finally {
    _summaryInFlight = false;
  }
}

function summaryItem(hasActivity) {
  const now = Date.now();
  const stale = now - _summaryCache.ts > SUMMARY_TTL_MS;

  // Refresh in the background (never blocks). Only when stale AND there is activity.
  if (stale && hasActivity) void regenerateSummaryAsync();

  const text = _summaryCache.text ?? deterministicSummary();
  return {
    id:       `desk-${Math.floor(_summaryCache.ts / 1000) || 'init'}`,
    ts:       _summaryCache.ts ? new Date(_summaryCache.ts).toISOString() : new Date().toISOString(),
    type:     'DESK_SUMMARY',
    text,
    detail:   _summaryCache.source === 'llm' ? 'Claude synthesis of live desk state.' : 'Deterministic desk synthesis.',
    severity: 'INFO',
    source:   _summaryCache.source,
  };
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

function applyRateLimit(items) {
  const out = [];
  const lastTypeTs = {};   // type → ms of last kept item
  let lastKey = null;

  // items are sorted DESC; iterate oldest→newest so floors apply chronologically
  for (const it of [...items].reverse()) {
    const key = `${it.type}|${it.text}`;
    if (key === lastKey) continue;                       // dedupe consecutive identical

    const floor = TYPE_FLOOR_MS[it.type] ?? 0;
    if (floor > 0) {
      const ms = Date.parse(it.ts) || 0;
      const prev = lastTypeTs[it.type] ?? -Infinity;
      if (ms - prev < floor) continue;                   // too soon for this type
      lastTypeTs[it.type] = ms;
    }
    out.push(it);
    lastKey = key;
  }
  return out.reverse();  // back to DESC
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function getCommentary({ limit = 40 } = {}) {
  // 1. Real events → narrated commentary
  let events = [];
  try { events = getCryptoFeedEvents(limit * 2); } catch { events = []; }
  const narrated = events.map(narrate);

  // 2. Confidence delta (real state transition)
  const delta = confidenceDeltaItem();
  if (delta) narrated.push(delta);

  // 3. Desk summary (hybrid)
  const hasActivity = narrated.length > 0;
  narrated.push(summaryItem(hasActivity));

  // 4. Sort DESC, rate-limit, slice
  narrated.sort((a, b) => (b.ts ?? '').localeCompare(a.ts ?? ''));
  const limited = applyRateLimit(narrated);
  return limited.slice(0, limit);
}
