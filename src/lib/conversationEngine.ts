import type { Lang } from '../i18n/translations';
import type { SystemEvent } from '../types/event';

export interface ActiveBubble {
  id: string;
  agentId: string;
  text: string;
  createdAt: number;
  expiresAt: number;
}

export interface ConversationRuntime {
  seenEventIds: Set<string>;
  bubbles: ActiveBubble[];
  lastChatterAt: number;
  seenTradeIds: Set<string>;
  chatterSeedReady: boolean;
}

/** Minimal shape of a live backend trade used for execution announcements. */
export interface LiveTradeLite {
  id: string;
  market_question?: string;
  outcome?: string;
  entry_price?: number;
  confidence?: number;
  status?: string;
}

export interface ChatterContext {
  presentAgentIds: string[];
  liveTrades?: LiveTradeLite[];
}

export function createConversationRuntime(): ConversationRuntime {
  return {
    seenEventIds: new Set<string>(),
    bubbles: [],
    lastChatterAt: 0,
    seenTradeIds: new Set<string>(),
    chatterSeedReady: false,
  };
}

const CHATTER_INTERVAL = 2000;   // a new ambient line about every 7s
const CHATTER_DURATION = 4200;

export function updateConversationRuntime(
  runtime: ConversationRuntime,
  events: SystemEvent[],
  lang: Lang,
  now: number,
  ctx?: ChatterContext,
): ActiveBubble[] {
  for (const event of events) {
    if (runtime.seenEventIds.has(event.id)) continue;
    runtime.seenEventIds.add(event.id);

    const bubble = bubbleFromEvent(event, lang, now);
    if (bubble) runtime.bubbles.push(bubble);
  }

  // Real paper-trade executions → the trader (shark) announces them.
  if (ctx?.liveTrades?.length) {
    for (const t of ctx.liveTrades) {
      if (t.status !== 'open' || runtime.seenTradeIds.has(t.id)) continue;
      runtime.seenTradeIds.add(t.id);
      // Skip announcing on first load (avoid a burst of stale trades)
      if (!runtime.chatterSeedReady) continue;
      runtime.bubbles.push({
        id: `trade-${t.id}`,
        agentId: 'visual-market-scanner',
        text: tradeLine(t, lang),
        createdAt: now,
        expiresAt: now + 5200,
      });
    }
    runtime.chatterSeedReady = true;
  }

  // Ambient themed chatter so the office feels alive.
  if (ctx?.presentAgentIds?.length && now - runtime.lastChatterAt > CHATTER_INTERVAL) {
    runtime.lastChatterAt = now;
    const speaker = ctx.presentAgentIds[Math.floor((now / CHATTER_INTERVAL)) % ctx.presentAgentIds.length];
    const line = chatterLine(speaker, lang, now);
    if (line) {
      runtime.bubbles.push({
        id: `chatter-${speaker}-${now}`,
        agentId: speaker,
        text: line,
        createdAt: now,
        expiresAt: now + CHATTER_DURATION,
      });
    }
  }

  runtime.bubbles = runtime.bubbles.filter((bubble) => bubble.expiresAt > now);
  return runtime.bubbles;
}

function tradeLine(t: LiveTradeLite, lang: Lang): string {
  const q = (t.market_question ?? 'el mercado').slice(0, 34);
  const price = t.entry_price != null ? `${Math.round(t.entry_price * 100)}%` : '';
  const conf = t.confidence != null ? `${Math.round(t.confidence * 100)}%` : '';
  if (lang === 'es') return `Abrí ${t.outcome ?? ''} en "${q}" @${price} · conf ${conf}`;
  return `Opened ${t.outcome ?? ''} on "${q}" @${price} · conf ${conf}`;
}

// Themed idle chatter per creature. Speakers stay in character.
const CHATTER: Record<string, { es: string[]; en: string[] }> = {
  'visual-genesis-core': {
    es: ['Disciplina primero, sobrevivir antes que ganar.', '¿Cuál es nuestra mejor probabilidad hoy?', 'Mantengamos el riesgo bajo control.', 'Buen trabajo, equipo. Sigamos.'],
    en: ['Discipline first — survive before you win.', 'What is our best edge today?', 'Keep the risk under control.', 'Good work, team. Keep going.'],
  },
  'visual-market-scanner': {
    es: ['El volumen está subiendo en varios mercados.', 'Veo un posible edge en deportes.', 'Polymarket se mueve rápido hoy.', 'Confirmando señales antes de entrar.'],
    en: ['Volume is climbing across markets.', 'I see a possible edge in sports.', 'Polymarket is moving fast today.', 'Confirming signals before I enter.'],
  },
  'visual-risk-guardian': {
    es: ['Esa apuesta no tiene evidencia suficiente.', 'Reduzcan el tamaño, el riesgo sube.', 'Nada de revenge trading.', 'Máximo 5% por operación, recuerden.'],
    en: ['That bet lacks enough evidence.', 'Cut the size — risk is rising.', 'No revenge trading.', 'Max 5% per trade, remember.'],
  },
  'visual-memory-curator': {
    es: ['Ya vimos este patrón antes.', 'Archivando la lección de ese trade.', 'La calibración mejora poco a poco.', 'Revisé las pérdidas pasadas.'],
    en: ['We have seen this pattern before.', 'Archiving the lesson from that trade.', 'Calibration is slowly improving.', 'I reviewed our past losses.'],
  },
  'visual-hr-evaluator': {
    es: ['El equipo rinde bien esta semana.', '¿Contratamos otro analista?', 'Buen ratio de aciertos últimamente.', 'Evaluando el desempeño de todos.'],
    en: ['The team is performing well this week.', 'Should we hire another analyst?', 'Good hit rate lately.', 'Evaluating everyone’s performance.'],
  },
};

const COFFEE_CHATTER = {
  es: ['Voy por un café ☕', 'Necesitaba un descanso.', 'Café y de vuelta al mercado.'],
  en: ['Grabbing a coffee ☕', 'Needed a quick break.', 'Coffee, then back to the market.'],
};

function chatterLine(agentId: string, lang: Lang, now: number): string | null {
  const pool = CHATTER[agentId];
  // ~1 in 5 lines is coffee banter from anyone
  if (!pool || (Math.floor(now / CHATTER_INTERVAL) % 5 === 0)) {
    const c = COFFEE_CHATTER[lang];
    return c[Math.floor(now / CHATTER_INTERVAL) % c.length];
  }
  const lines = pool[lang];
  return lines[Math.floor(now / (CHATTER_INTERVAL * 2)) % lines.length];
}

function bubbleFromEvent(event: SystemEvent, lang: Lang, now: number): ActiveBubble | null {
  const agentId = event.voicedBy ?? event.agentId;
  if (!agentId) return null;

  const text =
    event.voicedText?.[lang] ??
    fallbackBubbleText(event.kind, lang, event.id);

  if (!text) return null;

  const duration = durationForEvent(event.kind);

  return {
    id: event.id,
    agentId,
    text,
    createdAt: now,
    expiresAt: now + duration,
  };
}

const PROGRESS_PHRASES_ES = [
  'Procesando datos...',
  'Revisando documentos.',
  'Analizando resultados.',
  'Ejecutando protocolo.',
  'Verificando estado.',
  'Compilando informe.',
  'Monitoreando sistema.',
  'En progreso.',
];

const PROGRESS_PHRASES_EN = [
  'Processing data...',
  'Reviewing documents.',
  'Analyzing results.',
  'Running protocol.',
  'Checking status.',
  'Compiling report.',
  'Monitoring system.',
  'In progress.',
];

function fallbackBubbleText(kind: SystemEvent['kind'], lang: Lang, seed?: string): string | null {
  if (kind === 'task.progress') {
    const pool = lang === 'es' ? PROGRESS_PHRASES_ES : PROGRESS_PHRASES_EN;
    const idx = seed ? (seed.charCodeAt(seed.length - 1) % pool.length) : 0;
    return pool[idx];
  }

  const es: Partial<Record<SystemEvent['kind'], string | null>> = {
    'task.assigned': 'Voy al area asignada.',
    'task.started': 'Tarea iniciada.',
    'task.completed': 'Completado.',
    'task.failed': 'Revisando evidencia.',
    'task.blocked': 'Bloqueado. Necesito ayuda.',
    'agent.warning': 'Riesgo detectado.',
    'agent.onboarding.start': 'Iniciando onboarding.',
    'agent.onboarding.end': 'Listo para trabajar.',
    'agent.hired': 'Bienvenido a Genesis.',
    'agent.fired': 'Traslado al archivo.',
    'task.moving': 'Voy al area asignada.',
    'agent.retraining': 'Iniciando reentrenamiento.',
  };

  const en: Partial<Record<SystemEvent['kind'], string | null>> = {
    'task.assigned': 'Moving to assigned area.',
    'task.started': 'Task started.',
    'task.completed': 'Completed.',
    'task.failed': 'Reviewing evidence.',
    'task.blocked': 'Blocked. Need assistance.',
    'agent.warning': 'Risk detected.',
    'agent.onboarding.start': 'Starting onboarding.',
    'agent.onboarding.end': 'Ready for work.',
    'agent.hired': 'Welcome to Genesis.',
    'agent.fired': 'Moving to archive.',
    'task.moving': 'Moving to assigned area.',
    'agent.retraining': 'Starting retraining.',
  };

  return (lang === 'es' ? es[kind] : en[kind]) ?? null;
}

function durationForEvent(kind: SystemEvent['kind']): number {
  switch (kind) {
    case 'task.failed':
    case 'task.blocked':
    case 'agent.warning':
      return 3600;
    case 'agent.hired':
    case 'agent.onboarding.start':
    case 'agent.onboarding.end':
      return 3400;
    case 'task.completed':
      return 2600;
    default:
      return 2800;
  }
}
