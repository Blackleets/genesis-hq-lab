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
    fallbackBubbleText(event.kind, lang);

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

function fallbackBubbleText(kind: SystemEvent['kind'], lang: Lang): string | null {
  const es = {
    'task.assigned': 'Voy al area asignada.',
    'task.started': 'Tarea iniciada.',
    'task.completed': 'Tarea completada.',
    'task.failed': 'Revisando evidencia.',
    'task.blocked': 'Riesgo detectado.',
    'agent.warning': 'Riesgo detectado.',
    'agent.onboarding.start': 'Onboarding iniciado.',
    'agent.onboarding.end': 'Listo para trabajar.',
    'agent.hired': 'Bienvenido a Genesis.',
    'agent.fired': 'Traslado al archivo.',
    'agent.says': null,
    'system.boot': null,
    'task.created': null,
    'task.moving': 'Voy al area asignada.',
    'office.upgrade.requested': null,
    'office.upgrade.in_progress': null,
    'office.upgrade.completed': null,
    'module.unlocked': null,
    'language.changed': null,
    'agent.promoted': null,
    'agent.suspended': null,
    'agent.retraining': 'Iniciando reentrenamiento.',
  } as const;

  const en = {
    'task.assigned': 'Moving to assigned area.',
    'task.started': 'Task started.',
    'task.completed': 'Task completed.',
    'task.failed': 'Reviewing evidence.',
    'task.blocked': 'Risk detected.',
    'agent.warning': 'Risk detected.',
    'agent.onboarding.start': 'Onboarding started.',
    'agent.onboarding.end': 'Ready for work.',
    'agent.hired': 'Welcome to Genesis.',
    'agent.fired': 'Moving to archive.',
    'agent.says': null,
    'system.boot': null,
    'task.created': null,
    'task.moving': 'Moving to assigned area.',
    'office.upgrade.requested': null,
    'office.upgrade.in_progress': null,
    'office.upgrade.completed': null,
    'module.unlocked': null,
    'language.changed': null,
    'agent.promoted': null,
    'agent.suspended': null,
    'agent.retraining': 'Starting retraining.',
  } as const;

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
