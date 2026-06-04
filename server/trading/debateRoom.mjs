// debateRoom.mjs — structured multi-agent debate before any trade.
// Bull agent vs Bear agent, arbitrated by a third voice.
// All 3 voices generated in ONE Claude call (Haiku primary, reliable + cheap).
// Prevents impulsive decisions. Forces thesis articulation.

import db, { tx } from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

import { getSkillPrompt } from '../skills/skillLoader.mjs';

// Fallback prompt if skills/polymarket_agent/best_skill.md is missing or unreadable.
// The deployed skill.md (when present) replaces this — see resolveSystemPrompt().
const DEBATE_SYSTEM_FALLBACK = `You are Genesis HQ's debate facilitator.
You generate a structured investment debate between three agents:
- BULL: argues for the trade (provides evidence, states confidence)
- BEAR: argues against (challenges evidence, identifies risks)
- ARBITER: weighs both sides, makes the final call

Rules for the debate:
- No emotional language. Facts and probabilities only.
- Bull must cite at least 2 specific reasons to trade.
- Bear must identify at least 1 specific risk or weakness.
- Arbiter must reference arguments from both sides before deciding.
- If Bull confidence < 0.65 OR Bear confidence > 0.55, ARBITER votes SKIP.
- Confidence = probability the YES outcome wins (not "confidence in the debate").
- When genuine edge exists (market price differs from fair probability by >5%), you MUST TRADE. Excessive caution is a losing strategy.
- SKIP only when: (a) you have no informational edge, (b) both Bull and Bear are genuinely uncertain, or (c) a hard rule is violated.`;

const JSON_DIRECTIVE = `\n\nRespond ONLY with valid JSON. No markdown. No explanation outside the JSON.`;

// Resolve the system prompt: deployed skill.md if available, else inline fallback.
// The JSON directive is always appended so output format never depends on the skill.
function resolveSystemPrompt(agent = 'polymarket_agent') {
  const skill = getSkillPrompt(agent);
  return (skill ?? DEBATE_SYSTEM_FALLBACK) + JSON_DIRECTIVE;
}

// ─── Run a debate for a specific market ───────────────────────────────────────

export async function runDebate(market, contextLessons = [], contextRules = [], contextSignals = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // No API key: use rule-based decision (now considers research signals)
    return fallbackDebate(market, contextSignals);
  }

  const lessonsCtx = contextLessons.length > 0
    ? `\nPrevious lessons relevant to this category:\n${contextLessons.slice(0, 4).map(l => `- ${l.lesson_text || l.lesson}`).join('\n')}`
    : '';

  const rulesCtx = contextRules.length > 0
    ? `\nActive rules:\n${contextRules.slice(0, 4).map(r => `- ${r.rule_text}`).join('\n')}`
    : '';

  const signalsCtx = contextSignals.length > 0
    ? `\nLive research signals (free news/sentiment — weigh but don't blindly trust):\n${contextSignals.slice(0, 4).map(s => `- ${s.text || s.signal_text}`).join('\n')}`
    : '';

  const userPrompt = `MARKET TO DEBATE:
Source: ${market.source?.toUpperCase() ?? 'POLYMARKET'}
Question: "${market.question}"
Category: ${market.category ?? 'general'}
YES price: ${(market.yesPrice * 100).toFixed(1)}% | NO price: ${(market.noPrice * 100).toFixed(1)}%
24h Volume: $${Math.round(market.volume24h ?? 0).toLocaleString()}
Total Volume: $${Math.round(market.volumeTotal ?? 0).toLocaleString()}
Days to close: ${market.daysToClose}
Market score: ${market.score?.toFixed(3) ?? 'N/A'}
${lessonsCtx}
${rulesCtx}
${signalsCtx}

Generate the full debate and decision. Respond with:
{
  "bull": {
    "thesis": "1-2 sentence argument for YES",
    "evidence": ["specific reason 1", "specific reason 2"],
    "confidence": 0.XX,
    "position_recommended": "YES"
  },
  "bear": {
    "thesis": "1-2 sentence argument against",
    "evidence": ["specific risk or counter-signal"],
    "confidence": 0.XX,
    "position_recommended": "NO or SKIP"
  },
  "arbiter": {
    "summary": "1-2 sentence synthesis of the debate",
    "winning_argument": "bull | bear | inconclusive",
    "final_confidence": 0.XX,
    "final_outcome_bet": "YES | NO",
    "action": "TRADE | SKIP",
    "skip_reason": "only if action=SKIP: specific reason"
  }
}`;

  try {
    const res = await fetch(CLAUDE_API, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        system: resolveSystemPrompt('polymarket_agent'),
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Claude ${res.status}: ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    const raw  = data.content?.[0]?.text ?? '';

    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const debate = JSON.parse(match[0]);

    // Validate and enforce rules
    const result = enforceDebateRules(debate, market);
    await saveDebate(market, debate, result);
    return result;

  } catch (err) {
    console.warn(`[debateRoom] Claude failed for "${market.question?.slice(0,40)}": ${err.message} — using rule-based fallback`);
    const fallback = fallbackDebate(market, contextSignals);
    // Persist fallback debates too so team_memory has a full record
    try { await saveDebate(market, { bull: fallback.bull, bear: fallback.bear, arbiter: { summary: fallback.arbiterSummary, action: fallback.action, final_outcome_bet: fallback.outcome, final_confidence: fallback.confidence } }, fallback); } catch { /* best-effort */ }
    return fallback;
  }
}

// ─── Enforce rules on debate outcome ─────────────────────────────────────────

function enforceDebateRules(debate, market) {
  const arb = debate.arbiter;
  let action = arb.action ?? 'SKIP';
  let skipReason = arb.skip_reason;

  // Hard rules that override arbiter's decision
  if (arb.final_confidence < 0.65) {
    action = 'SKIP';
    skipReason = `Final confidence ${arb.final_confidence} below 0.65 minimum`;
  }

  if (debate.bear?.confidence > 0.58) {
    action = 'SKIP';
    skipReason = `Bear confidence ${debate.bear.confidence} too high — significant opposing signal`;
  }

  if (market.daysToClose > 45) {
    action = 'SKIP';
    skipReason = `Market closes in ${market.daysToClose} days — exceeds 45-day limit`;
  }

  if ((market.volumeTotal ?? 0) < 5000) {
    action = 'SKIP';
    skipReason = `Total volume $${market.volumeTotal} below $5000 minimum`;
  }

  return {
    action,
    skipReason: action === 'SKIP' ? (skipReason ?? 'Debate inconclusive') : null,
    outcome:       arb.final_outcome_bet ?? 'YES',
    confidence:    arb.final_confidence ?? 0.5,
    bull:          debate.bull,
    bear:          debate.bear,
    arbiterSummary: arb.summary,
    winningArgument: arb.winning_argument,
  };
}

// ─── Fallback when no Claude API ─────────────────────────────────────────────

function fallbackDebate(market, contextSignals = []) {
  // Pure math + research signals: trade only when price edge AND sentiment align.
  const marketPrice = market.yesPrice;
  const score = market.score ?? 0;

  // Summarize research sentiment (from free news/HN). Net = bullish - bearish strength.
  let net = 0;
  let signalNote = 'no research signal';
  const fresh = contextSignals.find((s) => s.sentiment); // live signal object
  if (fresh) {
    net = fresh.sentiment === 'bullish' ? fresh.strength
        : fresh.sentiment === 'bearish' ? -fresh.strength
        : 0;
    signalNote = `${fresh.sentiment} (${fresh.strength})`;
  }

  // Require strong score AND price in "interesting" range
  if (score > 0.6 && marketPrice >= 0.35 && marketPrice <= 0.70) {
    // Direction: lean on research sentiment; fall back to price when neutral
    const outcome = net > 0.15 ? 'YES'
                  : net < -0.15 ? 'NO'
                  : marketPrice >= 0.5 ? 'YES' : 'NO';

    // Confidence: base 0.62, bumped when research agrees with the bet
    const agrees = (outcome === 'YES' && net > 0) || (outcome === 'NO' && net < 0);
    const confidence = Math.min(0.78, 0.62 + (agrees ? Math.abs(net) * 0.15 : 0));

    return {
      action:         'TRADE',
      outcome,
      confidence:     Math.round(confidence * 100) / 100,
      bull:           { thesis: 'Favorable odds, volume, and research sentiment (rule-based)', evidence: ['Volume > threshold', 'Price in edge range', `Research: ${signalNote}`], confidence },
      bear:           { thesis: 'No AI debate; relying on heuristics', evidence: ['Claude API unavailable'], confidence: 0.45 },
      arbiterSummary: `Rule-based: price edge + research ${signalNote}`,
      winningArgument:'bull',
      skipReason:     null,
    };
  }

  return {
    action:         'SKIP',
    skipReason:     `Rule-based: score/price criteria not met (research: ${signalNote})`,
    outcome:        'YES',
    confidence:     0,
    bull:           null,
    bear:           null,
    arbiterSummary: 'Insufficient criteria without AI analysis',
    winningArgument:'bear',
  };
}

// ─── Persist debate to database ───────────────────────────────────────────────

async function saveDebate(market, debate, result) {
  tx(() => {
    db.prepare(`
      INSERT OR IGNORE INTO team_memory
        (id, event_type, participants, topic, summary, outcome, decision_made, created_at)
      VALUES (?, 'debate', '["bull-agent","bear-agent","arbiter"]', ?, ?, ?, ?, datetime('now'))
    `).run(
      `debate-${nanoid()}`,
      market.question?.slice(0, 100) ?? market.market_id,
      result.arbiterSummary,
      result.action,
      JSON.stringify({
        action: result.action,
        confidence: result.confidence,
        bull_confidence: debate.bull?.confidence,
        bear_confidence: debate.bear?.confidence,
        winner: result.winningArgument,
      }),
    );
  });
}

// ─── Get recent debates for dashboard ────────────────────────────────────────

export function getRecentDebates(limit = 10) {
  return db.prepare(`
    SELECT * FROM team_memory
    WHERE event_type = 'debate'
    ORDER BY created_at DESC LIMIT ?
  `).all(limit);
}
