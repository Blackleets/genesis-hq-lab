// Initial tasks Genesis starts with. Every entry is marked visualSeed.
// They are real entities in the store (createTask flow). Status will
// derive agent.status when the store runs its first tick.

import type { Task } from '../types/task';

const now = new Date().toISOString();

export const INITIAL_TASKS: Task[] = [
  {
    id: 'task-seed-market-1',
    title: { es: 'Escaneo inicial de mercado', en: 'Initial market scan' },
    description: { es: 'Revisión semilla de oportunidades visuales.', en: 'Seed sweep of visual opportunities.' },
    type: 'market_scan',
    assignedAgentIds: ['visual-market-scanner'],
    room: 'market-desk',
    status: 'assigned',
    priority: 'normal',
    createdAt: now,
    estimatedMs: 1000 * 60 * 8,
    isReal: false,
    isVisualSeed: true,
    startBubble: {
      es: 'Estoy revisando oportunidades.',
      en: 'I am reviewing opportunities.',
    },
  },
  {
    id: 'task-seed-risk-1',
    title: { es: 'Revisión de riesgo inicial', en: 'Initial risk review' },
    type: 'risk_review',
    assignedAgentIds: ['visual-risk-guardian'],
    room: 'risk-bunker',
    status: 'assigned',
    priority: 'high',
    createdAt: now,
    estimatedMs: 1000 * 60 * 10,
    isReal: false,
    isVisualSeed: true,
    startBubble: {
      es: 'Bloquearé cualquier acción sin evidencia.',
      en: 'I will block any action without evidence.',
    },
  },
  {
    id: 'task-seed-memory-1',
    title: { es: 'Archivar regla de día 1', en: 'Archive day-1 rule' },
    type: 'memory_archive',
    assignedAgentIds: ['visual-memory-curator'],
    room: 'memory-archive',
    status: 'assigned',
    priority: 'normal',
    createdAt: now,
    estimatedMs: 1000 * 60 * 6,
    isReal: false,
    isVisualSeed: true,
    startBubble: {
      es: 'Guardando una regla nueva en el archivo.',
      en: 'Storing a new rule in the archive.',
    },
  },
  {
    id: 'task-seed-hr-1',
    title: { es: 'Revisar candidatos de contratación', en: 'Review hiring candidates' },
    type: 'hr_review',
    assignedAgentIds: ['visual-hr-evaluator'],
    room: 'hr-pod',
    status: 'assigned',
    priority: 'normal',
    createdAt: now,
    estimatedMs: 1000 * 60 * 5,
    isReal: false,
    isVisualSeed: true,
    startBubble: {
      es: 'Recomiendo contratar al Agente de Debate pronto.',
      en: 'I recommend hiring the Debate Agent soon.',
    },
  },
  {
    id: 'task-seed-core-1',
    title: { es: 'Coordinar ciclo del día', en: 'Coordinate today’s cycle' },
    type: 'system_check',
    assignedAgentIds: ['visual-genesis-core'],
    room: 'open-workspace',
    status: 'assigned',
    priority: 'high',
    createdAt: now,
    estimatedMs: 1000 * 60 * 15,
    isReal: false,
    isVisualSeed: true,
    startBubble: {
      es: 'Coordino el ciclo de hoy con los cinco agentes.',
      en: 'Coordinating today’s cycle with the five agents.',
    },
  },
];
