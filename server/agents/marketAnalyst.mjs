// MarketAnalystAgent — deterministic prediction market signal generator.
//
// Subscribes to market_update events from the Kalshi adapter's internal bus.
// Analyzes 4 market quality factors and emits signal_generated events when
// a strong opportunity is detected. No LLM, no DB, no side effects.
//
// Signal logic:
//   score >= 0.60 → BUY  (strong market quality, worth entering)
//   score <= 0.15 → SELL  (negative quality indicators, avoid)
//   else          → HOLD  (insufficient signal)
//
// BUY/SELL here describe market opportunity quality, not a directional YES/NO
// bet — the execution layer determines that from price position.

import { onMarketUpdate }                    from '../kalshi/adapter.mjs';
import { saveDecision }                      from '../memory/decisionLedger.mjs';
import { addSignal, resolveConsensus }       from '../memory/consensusEngine.mjs';

const AGENT_ID = 'market-analyst';

// ── Thresholds ────────────────────────────────────────────────────────────────

const T = {
  liquidity:   { min: 1_000, good: 10_000 },
  price:       { tooLow: 0.10, tooHigh: 0.90 },
  daysToClose: { tooFew: 2, ideal: 20, ok: 45 },
  volume:      { low: 1_000, spike: 5_000 },
  signal:      { buyThreshold: 0.60, sellThreshold: 0.15 },
  cooldown_ms: 15 * 60_000,  // suppress repeated signals per ticker
};

// ── State ─────────────────────────────────────────────────────────────────────

let _broadcast = null;
const _lastSignal = new Map();   // ticker → { signal, ts }

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(v) { return `${(v * 100).toFixed(0)}%`; }
function usd(n) { return `$${Math.round(n ?? 0).toLocaleString()}`; }

// ── Public API ────────────────────────────────────────────────────────────────

export function start(broadcastFn) {
  _broadcast = broadcastFn;
  onMarketUpdate(_handleMarketUpdate);
  console.log(`[${AGENT_ID}] started — listening for market_update events`);
}

// ── Deterministic analysis (exported for unit testing) ────────────────────────
//
// Input:  canonical market_update object (from normalizeMarket)
// Output: { signal: 'BUY'|'SELL'|'HOLD', confidence: number, reasoning: string[] }
//
// Four factors scored:
//   1. Liquidity (0.30 max)  — is the market deep enough to trade?
//   2. Price position (0.25) — is the price in an actionable zone?
//   3. Time to close (0.20)  — is the horizon suitable?
//   4. Volume anomaly (0.25) — is activity elevated?

export function analyze(market) {
  const { yesPrice, liquidity, volume24h, daysToClose } = market;
  const reasoning = [];
  let score = 0;

  // ── Factor 1: Liquidity ────────────────────────────────────────────────────
  if (liquidity == null || liquidity < T.liquidity.min) {
    reasoning.push(`illiquid: ${usd(liquidity)}`);
    return { signal: 'HOLD', confidence: 0.05, reasoning };
  }
  if (liquidity >= T.liquidity.good) {
    reasoning.push(`high liquidity: ${usd(liquidity)}`);
    score += 0.30;
  } else {
    reasoning.push(`adequate liquidity: ${usd(liquidity)}`);
    score += 0.10;
  }

  // ── Factor 2: Price position ───────────────────────────────────────────────
  if (yesPrice == null) {
    reasoning.push('no price data');
    return { signal: 'HOLD', confidence: 0.05, reasoning };
  }
  if (yesPrice <= T.price.tooLow || yesPrice >= T.price.tooHigh) {
    reasoning.push(`price near certainty: ${pct(yesPrice)} — no edge`);
    return { signal: 'HOLD', confidence: 0.10, reasoning };
  }
  const priceEdge = 1 - Math.abs(yesPrice - 0.5) * 2;
  if (priceEdge >= 0.5) {
    reasoning.push(`price in edge zone: ${pct(yesPrice)} (near 50/50)`);
    score += 0.25;
  } else {
    reasoning.push(`price actionable: ${pct(yesPrice)}`);
    score += 0.12;
  }

  // ── Factor 3: Time to close ────────────────────────────────────────────────
  if (daysToClose == null || daysToClose < T.daysToClose.tooFew) {
    reasoning.push(`closing imminently: ${daysToClose ?? 0}d — binary risk`);
    score -= 0.20;
  } else if (daysToClose <= T.daysToClose.ideal) {
    reasoning.push(`ideal window: ${daysToClose}d`);
    score += 0.20;
  } else if (daysToClose <= T.daysToClose.ok) {
    reasoning.push(`acceptable horizon: ${daysToClose}d`);
    score += 0.08;
  } else {
    reasoning.push(`horizon too long: ${daysToClose}d`);
    score -= 0.05;
  }

  // ── Factor 4: Volume anomaly ───────────────────────────────────────────────
  if (volume24h == null || volume24h < T.volume.low) {
    reasoning.push(`low volume: ${usd(volume24h)}/day`);
    // neutral — no positive or negative contribution
  } else if (volume24h >= T.volume.spike) {
    reasoning.push(`volume spike: ${usd(volume24h)}/day`);
    score += 0.25;
  } else {
    reasoning.push(`active volume: ${usd(volume24h)}/day`);
    score += 0.12;
  }

  // ── Determine signal ───────────────────────────────────────────────────────
  const confidence = Math.max(0.05, Math.min(0.95, Math.round(score * 100) / 100));

  let signal;
  if (score >= T.signal.buyThreshold) {
    signal = 'BUY';
  } else if (score <= T.signal.sellThreshold) {
    signal = 'SELL';
  } else {
    signal = 'HOLD';
  }

  return { signal, confidence, reasoning };
}

// ── Internal event handler ────────────────────────────────────────────────────

function _handleMarketUpdate(event) {
  try {
    const { ticker } = event;
    if (!ticker) return;

    const { signal, confidence, reasoning } = analyze(event);

    // Only process actionable signals — HOLD generates no entry
    if (signal === 'HOLD') return;

    const ts = Date.now();

    // Per-ticker cooldown: suppress repeating the same signal within the window
    const last = _lastSignal.get(ticker);
    if (last && last.signal === signal && ts - last.ts < T.cooldown_ms) return;

    _lastSignal.set(ticker, { signal, ts });

    // Deterministic ID for idempotency: same agent+ticker+signal within a cooldown
    // window produces the same ID — INSERT OR IGNORE absorbs crash-restart duplicates.
    const decisionId = `${AGENT_ID}:${ticker}:${signal}:${Math.floor(ts / T.cooldown_ms)}`;

    const saved = saveDecision({
      id:             decisionId,
      timestamp:      ts,
      ticker,
      agentName:      AGENT_ID,
      signal,
      confidence,
      reasoning,
      marketPrice:    event.yesPrice       ?? null,
      marketCategory: event.marketCategory ?? null,
    });

    // ── Feed ConsensusEngine ──────────────────────────────────────────────────
    addSignal(ticker, AGENT_ID, signal, confidence);
    const consensus = resolveConsensus(ticker);

    // ── Broadcast both individual signal and consensus result ─────────────────
    const sigPayload = {
      type:       'signal_generated',
      agentId:    AGENT_ID,
      decisionId,
      ticker,
      signal,
      confidence,
      reasoning,
      timestamp:  ts,
    };

    const consensusPayload = {
      type:      'consensus_decision',
      ticker,
      decision:  consensus.decision,
      buyScore:  consensus.buyScore,
      sellScore: consensus.sellScore,
      holdScore: consensus.holdScore,
      vetoed:    consensus.vetoed,
      vetoBy:    consensus.vetoBy,
      explanation: consensus.explanation,
      signalCount: consensus.signalCount,
      timestamp:  ts,
    };

    if (_broadcast) {
      _broadcast(sigPayload);
      _broadcast(consensusPayload);
    }

    console.log(
      `[${AGENT_ID}] ${signal} ${ticker} (${(confidence * 100).toFixed(0)}%)` +
      `${saved ? '' : ' [dup]'} — ${reasoning[0]}`
    );
  } catch (err) {
    console.error(`[${AGENT_ID}] handler error:`, err.message);
  }
}
