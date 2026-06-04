// cryptoDebate.mjs — Claude Sonnet Bull/Bear/Arbiter debate for crypto scalping.
// Mirrors debateRoom.mjs but for LONG/SHORT decisions on BTC/ETH/SOL/BNB.
// Same output shape as runDebate() so the rest of the pipeline is reusable.

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

const CRYPTO_DEBATE_SYSTEM = `You are Genesis HQ's crypto scalping debate facilitator.
Generate a structured debate between three agents about whether to open a position:
- BULL: argues for entering LONG (price will rise shortly). Cites specific technical evidence.
- BEAR: argues against or for SHORT/SKIP (price unclear or will drop). Identifies specific risk.
- ARBITER: weighs both sides, makes the final call.

Rules:
- No emotional language. Price levels, indicators, and momentum only.
- Bull must cite at least 2 specific technical reasons (EMA alignment, RSI level, price momentum).
- Bear must identify at least 1 specific risk (overbought/oversold, weak volume, trend reversal signal).
- Arbiter must reference both sides before deciding.
- If Bull confidence < 0.62 OR Bear confidence > 0.55, ARBITER votes SKIP.
- Confidence = probability this position hits its +1.5% target before its -0.75% stop-loss.
- When trend + RSI + volume are aligned, you MUST TRADE. Excessive caution is a losing strategy.
- SKIP only when: (a) indicators are conflicting, (b) volume is weak, or (c) a hard rule is violated.`;

const JSON_DIRECTIVE = `\n\nRespond ONLY with valid JSON. No markdown. No explanation outside the JSON.`;

function fallbackCryptoDebate(asset) {
  const bullishSetup = asset.trend === 'bullish' && asset.rsi14 >= 40 && asset.rsi14 <= 60;
  const bearishSetup = asset.trend === 'bearish' && asset.rsi14 >= 40 && asset.rsi14 <= 60;

  if (bullishSetup) {
    return { action: 'TRADE', outcome: 'LONG', confidence: 0.63,
      bull: { evidence: ['EMA9 > EMA21 bullish', `RSI ${asset.rsi14} neutral-rising`] },
      bear: { risks: ['Rule-based fallback — limited signal quality'] },
      arbiterSummary: 'Rule-based: bullish EMA + neutral RSI → LONG' };
  }
  if (bearishSetup) {
    return { action: 'TRADE', outcome: 'SHORT', confidence: 0.63,
      bull: { evidence: ['Rule-based fallback'] },
      bear: { risks: ['EMA9 < EMA21 bearish', `RSI ${asset.rsi14} neutral-falling`] },
      arbiterSummary: 'Rule-based: bearish EMA + neutral RSI → SHORT' };
  }
  return { action: 'SKIP', skipReason: 'Rule-based fallback: indicators not aligned', confidence: 0 };
}

export async function runCryptoDebate(asset, contextLessons = []) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallbackCryptoDebate(asset);

  const lessonsCtx = contextLessons.length > 0
    ? `\nPrevious crypto lessons:\n${contextLessons.slice(0, 3).map(l => `- ${l.lesson_text || l.lesson}`).join('\n')}`
    : '';

  const userPrompt = `ASSET TO DEBATE:
Symbol: ${asset.symbol} (${asset.pair})
Current price: $${asset.price}
EMA9: $${asset.ema9} | EMA21: $${asset.ema21} | Trend: ${asset.trend.toUpperCase()}
RSI(14): ${asset.rsi14}
1h change: ${asset.change1h > 0 ? '+' : ''}${asset.change1h}%
24h change: ${asset.change24h > 0 ? '+' : ''}${asset.change24h}%
24h volume: $${Math.round(asset.volume24h).toLocaleString()}
${lessonsCtx}

Target if LONG: $${(asset.price * 1.015).toFixed(2)} (+1.5%) | Stop: $${(asset.price * 0.9925).toFixed(2)} (-0.75%)
Target if SHORT: $${(asset.price * 0.985).toFixed(2)} (-1.5%) | Stop: $${(asset.price * 1.0075).toFixed(2)} (+0.75%)

Generate the full debate and decision. Respond with:
{
  "bull": {
    "thesis": "1-2 sentence argument for LONG",
    "evidence": ["specific technical reason 1", "specific technical reason 2"],
    "confidence": 0.XX
  },
  "bear": {
    "thesis": "1-2 sentence argument for SHORT or SKIP",
    "risks": ["specific risk or counter-signal"],
    "confidence": 0.XX
  },
  "arbiter": {
    "summary": "1-2 sentence synthesis",
    "action": "TRADE | SKIP",
    "outcome": "LONG | SHORT",
    "final_confidence": 0.XX,
    "skip_reason": "only if action=SKIP"
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
        system: CRYPTO_DEBATE_SYSTEM + JSON_DIRECTIVE,
        messages: [{ role: 'user', content: userPrompt }],
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text().then(t => t.slice(0, 200))}`);

    const data = await res.json();
    const raw  = data.content?.[0]?.text ?? '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const debate = JSON.parse(match[0]);

    return enforceRules(debate, asset);

  } catch (err) {
    console.warn(`[cryptoDebate] Error for ${asset.symbol}:`, err.message);
    return fallbackCryptoDebate(asset);
  }
}

function enforceRules(debate, asset) {
  const arb = debate.arbiter;
  let action = arb.action ?? 'SKIP';
  let skipReason = arb.skip_reason;

  if ((arb.final_confidence ?? 0) < 0.62) {
    action = 'SKIP';
    skipReason = `Confidence ${arb.final_confidence} below 0.62 minimum`;
  }
  if ((debate.bear?.confidence ?? 0) > 0.55) {
    action = 'SKIP';
    skipReason = `Bear confidence ${debate.bear.confidence} too high`;
  }
  if (asset.volume24h < 1_000_000) {
    action = 'SKIP';
    skipReason = `Volume $${Math.round(asset.volume24h).toLocaleString()} below $1M minimum`;
  }

  return {
    action,
    skipReason: action === 'SKIP' ? (skipReason ?? 'Debate inconclusive') : null,
    outcome: arb.outcome ?? 'LONG',
    confidence: arb.final_confidence ?? 0.5,
    bull:  debate.bull,
    bear:  debate.bear,
    arbiterSummary: arb.summary,
  };
}
