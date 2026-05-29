// decisionEngine — uses Claude Haiku to analyze markets and decide trades.
// Includes constitution rules + recent lessons as context (learns over time).
// Cost: ~$0.0002 per decision = ~$1.80/month at 5-min intervals.

import { getRecentLessons, getCapital, logDecision } from './memoryStore.mjs';
import { getDecisionContext } from './memory/learningEngine.mjs';
import { checkVeto, logVeto } from './memory/mistakePrevention.mjs';

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';

// Constitution rules injected into every decision prompt
const CONSTITUTION = `
CONSTITUCIÓN GÉNESIS HQ — REGLAS OBLIGATORIAS:
1. SUPERVIVENCIA PRIMERO. Nunca arriesgar más del 5% del capital disponible en un solo trade.
2. Confianza mínima para operar: 0.65. Si la confianza es menor, acción = SKIP.
3. Evidencia mínima: 2 señales independientes. Sin evidencia = SKIP.
4. Evitar mercados con volumen < $5,000 total.
5. Horizonte máximo: 45 días. Mercados más lejanos = muy inciertos.
6. No operar si ya hay más de 5 trades abiertos (sobreexposición).
7. PAPER TRADING ÚNICAMENTE. Ninguna orden real.
8. Si el mercado ya está resuelto, acción = SKIP.
`.trim();

// ─── Claude call ──────────────────────────────────────────────────────────────

async function callClaude(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const res = await fetch(ANTHROPIC_API, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(20000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// ─── Parse JSON from Claude response safely ───────────────────────────────────

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

// ─── Main decision function ───────────────────────────────────────────────────

export async function analyzeMarkets(markets, openTradesCount = 0) {
  if (markets.length === 0) {
    console.log('[decisionEngine] No markets to analyze');
    return null;
  }

  // Constitution Rule: max 5 open trades
  if (openTradesCount >= 5) {
    console.log('[decisionEngine] Max open trades reached (5), skipping');
    return { action: 'SKIP', reason: 'Max 5 trades abiertos simultáneamente (Regla #1)' };
  }

  // Get SQLite memory context (lessons, rules, mistake patterns)
  const topMarket = markets[0];
  const dbContext = topMarket
    ? getDecisionContext(topMarket.category ?? 'general', topMarket.yesPrice - 0.1, topMarket.yesPrice + 0.1)
    : { lessons: [], rules: [], patterns: [], agent: null };

  const [jsonLessons, capital] = await Promise.all([getRecentLessons(5), getCapital()]);

  const maxPerTrade = Math.floor(capital.available * 0.05); // 5% rule
  if (maxPerTrade < 1) {
    return { action: 'SKIP', reason: 'Capital insuficiente (< $1 disponible)' };
  }

  // Merge SQLite lessons + JSON file lessons (SQLite wins, more structured)
  const allLessons = [
    ...dbContext.lessons.map(l => ({ lesson: l.lesson_text, rule: l.new_rule })),
    ...jsonLessons.map(l => ({ lesson: l.lesson })),
  ].slice(0, 10);

  const lessonsText = allLessons.length > 0
    ? `\nLECCIONES APRENDIDAS (aplicar siempre):\n${allLessons.map((l, i) => `${i+1}. ${l.lesson}${l.rule ? ` → Regla: ${l.rule}` : ''}`).join('\n')}`
    : '\nSin lecciones previas aún.';

  // Inject mistake patterns as hard warnings
  const patternText = dbContext.patterns.length > 0
    ? `\nPATRONES DE ERROR CONOCIDOS (evitar):\n${dbContext.patterns.map(p => `⚠ ${p.pattern_desc}`).join('\n')}`
    : '';

  // Inject active rules
  const rulesText = dbContext.rules.length > 0
    ? `\nREGLAS ACTIVAS:\n${dbContext.rules.slice(0, 6).map(r => `${r.rule_type === 'hard_constraint' ? '🔴' : '🟡'} ${r.rule_text}`).join('\n')}`
    : '';

  const marketsText = markets.slice(0, 12).map((m, i) =>
    `[${i+1}] ${m.source.toUpperCase()} | ${m.question}\n` +
    `    YES: ${(m.yesPrice*100).toFixed(1)}% | NO: ${(m.noPrice*100).toFixed(1)}% | ` +
    `Vol24h: $${m.volume24h.toLocaleString()} | Cierra en: ${m.daysToClose}d | Score: ${m.score?.toFixed(2)}`
  ).join('\n');

  const systemPrompt = `Eres un agente de trading de prediction markets en Génesis HQ.
Operas SOLO con paper trading (dinero simulado con precios reales).

${CONSTITUTION}
${lessonsText}
${patternText}
${rulesText}

Capital disponible: $${capital.available.toFixed(2)}
Máximo por trade: $${maxPerTrade.toFixed(2)} (5% del capital)
Trades abiertos: ${openTradesCount}/5

Responde ÚNICAMENTE con un JSON válido. Sin texto adicional. Sin markdown.`;

  const userPrompt = `MERCADOS DISPONIBLES HOY:
${marketsText}

Analiza cada mercado. Elige el MEJOR o decide SKIP si ninguno cumple los criterios.

Responde con este JSON exacto:
{
  "action": "BUY" | "SKIP",
  "marketIndex": N,
  "outcome": "YES" | "NO",
  "shares": N,
  "entryPrice": 0.XX,
  "capitalUsed": X.XX,
  "confidence": 0.XX,
  "reason": "Por qué este mercado (1-2 frases)",
  "evidence": ["señal 1", "señal 2"],
  "risk": "descripción del riesgo principal",
  "skipReason": "solo si action=SKIP, por qué no hay buena oportunidad"
}`;

  let rawResponse = '';
  try {
    rawResponse = await callClaude(systemPrompt, userPrompt);
    const decision = extractJSON(rawResponse);

    if (!decision) {
      console.warn('[decisionEngine] Could not parse JSON from response:', rawResponse.slice(0, 200));
      return { action: 'SKIP', reason: 'No se pudo parsear respuesta de Claude' };
    }

    // Validate decision against constitution rules
    if (decision.action === 'BUY') {
      if (decision.confidence < 0.65) {
        return { action: 'SKIP', reason: `Confianza ${decision.confidence} < 0.65 mínimo (Regla #2)` };
      }
      if (!decision.evidence || decision.evidence.length < 2) {
        return { action: 'SKIP', reason: 'Menos de 2 señales de evidencia (Regla #2)' };
      }
      if (decision.capitalUsed > maxPerTrade) {
        decision.capitalUsed = maxPerTrade;
        decision.shares = Math.floor(maxPerTrade / decision.entryPrice);
      }

      // Attach the actual market data
      const market = markets[decision.marketIndex ?? 0];
      if (market) {
        decision.marketId      = market.id;
        decision.marketSource  = market.source;
        decision.marketQuestion = market.question;
        decision.daysToClose   = market.daysToClose;
      }
    }

    await logDecision({ ...decision, rawResponse: rawResponse.slice(0, 500) });
    return decision;

  } catch (err) {
    console.error('[decisionEngine] Error:', err.message);
    await logDecision({ action: 'ERROR', error: err.message, rawResponse: rawResponse.slice(0, 300) });
    return { action: 'SKIP', reason: `Error en motor de decisiones: ${err.message}` };
  }
}

// ─── Marketing content generation ─────────────────────────────────────────────

export async function generateMarketingContent(context) {
  const systemPrompt = `Eres el agente de marketing de Génesis HQ, una empresa de IA autónoma.
Generas contenido conciso, profesional y auténtico sobre las actividades de los agentes.
Nunca inventar datos. Solo comunicar hechos reales.
Responde SOLO con JSON válido.`;

  const userPrompt = `Genera contenido de marketing basado en este contexto:
${JSON.stringify(context, null, 2)}

Responde:
{
  "tweet": "Tweet máximo 280 chars sobre la actividad",
  "linkedin": "Post corto LinkedIn (2-3 oraciones) sobre el aprendizaje",
  "insight": "Una frase de insight clave del período"
}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt);
    return extractJSON(raw) ?? { tweet: '', linkedin: '', insight: '' };
  } catch {
    return { tweet: '', linkedin: '', insight: '' };
  }
}

// ─── Post-trade lesson generation ─────────────────────────────────────────────

export async function generateLesson(trade, marketQuestion) {
  const outcome = (trade.pnl ?? 0) >= 0 ? 'GANANCIA' : 'PÉRDIDA';
  const systemPrompt = `Eres el sistema de aprendizaje de Génesis HQ.
Analizas trades cerrados y extraes lecciones concretas y accionables.
Las lecciones deben ser específicas, no genéricas.
Responde SOLO con JSON válido.`;

  const userPrompt = `TRADE CERRADO — ${outcome}:
Mercado: ${marketQuestion}
Predicción: ${trade.outcome} @ ${(trade.entryPrice*100).toFixed(1)}%
Resultado real: ${trade.resolvedOutcome?.toUpperCase()}
PnL: $${(trade.pnl ?? 0).toFixed(2)}
Capital usado: $${trade.capitalUsed?.toFixed(2)}
Confianza original: ${trade.confidence}
Razón original: ${trade.reason}
Evidencia: ${trade.evidence?.join(', ')}

Responde:
{
  "lesson": "Lección específica aprendida (1 oración clara)",
  "newRule": "Regla concreta que se debe aplicar en el futuro",
  "category": "timing" | "confidence" | "evidence" | "market_selection" | "position_size",
  "severity": "info" | "warning" | "critical"
}`;

  try {
    const raw = await callClaude(systemPrompt, userPrompt);
    return extractJSON(raw);
  } catch {
    return null;
  }
}
