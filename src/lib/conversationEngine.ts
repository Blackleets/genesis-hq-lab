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
}

export function createConversationRuntime(): ConversationRuntime {
  return {
    seenEventIds: new Set<string>(),
    bubbles: [],
  };
}

export function updateConversationRuntime(
  runtime: ConversationRuntime,
  events: SystemEvent[],
  lang: Lang,
  now: number,
): ActiveBubble[] {
  for (const event of events) {
    if (runtime.seenEventIds.has(event.id)) continue;
    runtime.seenEventIds.add(event.id);

    const bubble = bubbleFromEvent(event, lang, now);
    if (bubble) runtime.bubbles.push(bubble);
  }

  runtime.bubbles = runtime.bubbles.filter((bubble) => bubble.expiresAt > now);
  return runtime.bubbles;
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
