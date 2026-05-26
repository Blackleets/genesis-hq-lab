// Genesis HQ visual-lab activity feed (bilingual).
// Every entry has isVisualSeed: true. NOT live data.

import type { TKey } from '../i18n/translations';

export type ActivityFeedKind = 'task' | 'warning' | 'hr' | 'memory' | 'debate' | 'system' | 'decision' | 'upgrade';

export interface ActivityFeedEntry {
  id: string;
  agentId?: string;
  agentName?: string;
  kind: ActivityFeedKind;
  message: { es: string; en: string };
  at: string;
  isVisualSeed: boolean;
}

export const KIND_TKEY: Record<ActivityFeedKind, TKey> = {
  task:     'feed.kind.task',
  warning:  'feed.kind.warning',
  hr:       'feed.kind.hr',
  memory:   'feed.kind.memory',
  debate:   'feed.kind.debate',
  system:   'feed.kind.system',
  decision: 'feed.kind.decision',
  upgrade:  'feed.kind.upgrade',
};

const now = Date.now();
const minAgo = (m: number) => new Date(now - m * 60_000).toISOString();

export const ACTIVITY_FEED: ActivityFeedEntry[] = [
  {
    id: 'vf-1',
    agentId: 'visual-genesis-core',
    agentName: 'Genesis Core',
    kind: 'task',
    message: {
      es: 'Génesis Core asignó una tarea al Escáner de Mercado',
      en: 'Genesis Core assigned a task to Market Scanner',
    },
    at: minAgo(0),
    isVisualSeed: true,
  },
  {
    id: 'vf-2',
    agentId: 'visual-risk-guardian',
    agentName: 'Risk Guardian',
    kind: 'warning',
    message: {
      es: 'Guardián de riesgo detectó exposición elevada',
      en: 'Risk Guardian detected elevated exposure',
    },
    at: minAgo(2),
    isVisualSeed: true,
  },
  {
    id: 'vf-3',
    agentId: 'visual-memory-curator',
    agentName: 'Memory Curator',
    kind: 'memory',
    message: {
      es: 'Curador de memoria archivó 3 aprendizajes semilla',
      en: 'Memory Curator archived 3 seed lessons',
    },
    at: minAgo(5),
    isVisualSeed: true,
  },
  {
    id: 'vf-4',
    agentId: 'visual-hr-evaluator',
    agentName: 'HR Evaluator',
    kind: 'hr',
    message: {
      es: 'HR recomienda contratar al Agente de Debate cuando haya 5 decisiones',
      en: 'HR recommends hiring Debate Agent once 5 decisions are recorded',
    },
    at: minAgo(8),
    isVisualSeed: true,
  },
  {
    id: 'vf-5',
    agentId: 'visual-genesis-core',
    agentName: 'Genesis Core',
    kind: 'system',
    message: {
      es: 'Génesis nació con 5 agentes activos',
      en: 'Genesis was born with 5 active agents',
    },
    at: minAgo(12),
    isVisualSeed: true,
  },
  {
    id: 'vf-6',
    agentId: 'visual-genesis-core',
    agentName: 'Genesis Core',
    kind: 'upgrade',
    message: {
      es: 'Solicitada mejora visual del Laboratorio de Estrategia',
      en: 'Visual upgrade requested for Strategy Lab',
    },
    at: minAgo(18),
    isVisualSeed: true,
  },
  {
    id: 'vf-7',
    agentId: 'visual-market-scanner',
    agentName: 'Market Scanner',
    kind: 'task',
    message: {
      es: 'Escáner observó volumen elevado en datos semilla',
      en: 'Market Scanner observed elevated volume in seed data',
    },
    at: minAgo(22),
    isVisualSeed: true,
  },
];
