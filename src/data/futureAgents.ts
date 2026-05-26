// Hiring Queue — agents that Genesis will hire later, when the
// system needs them. Each entry has an unlock CONDITION (visual-only
// for now; in Phase 11+ Genesis Core / HR Evaluator will fire these
// rules against real metrics).

import type { Archetype, Department } from '../types/genesis';

export type UnlockCondition =
  | 'tasks-pending-many'
  | 'decisions-5-recorded'
  | 'module-unlocked-decisions'
  | 'module-unlocked-markets'
  | 'learning-level-up'
  | 'office-needs-upgrade'
  | 'errors-keep-happening'
  | 'role-gap-detected';

export interface FutureAgent {
  id: string;
  name: { es: string; en: string };
  role: { es: string; en: string };
  department: Department;
  archetype: Archetype;
  unlockReason: { es: string; en: string };
  unlockCondition: UnlockCondition;
  /** display tag */
  state: 'visual-seed' | 'pending' | 'unlockable';
}

export const FUTURE_AGENTS: FutureAgent[] = [
  {
    id: 'future-debate-agent',
    name:    { es: 'Agente de debate',       en: 'Debate Agent' },
    role:    { es: 'Forza Bull / Bear / Riesgo', en: 'Forces Bull / Bear / Risk debate' },
    department: 'Debate Room',
    archetype: 'mediator',
    unlockReason: {
      es: 'Cuando haya 5 decisiones registradas, Génesis lo contratará.',
      en: 'Will be hired once 5 decisions are recorded.',
    },
    unlockCondition: 'decisions-5-recorded',
    state: 'pending',
  },
  {
    id: 'future-strategy-agent',
    name:    { es: 'Agente de estrategia',    en: 'Strategy Agent' },
    role:    { es: 'Construye y prueba hipótesis de estrategia', en: 'Builds and tests strategy hypotheses' },
    department: 'Strategy Lab',
    archetype: 'scientist',
    unlockReason: {
      es: 'Se contratará cuando el nivel de aprendizaje supere 0.5.',
      en: 'Hired once Learning Level exceeds 0.5.',
    },
    unlockCondition: 'learning-level-up',
    state: 'pending',
  },
  {
    id: 'future-execution-guardian',
    name:    { es: 'Guardián de ejecución',   en: 'Execution Guardian' },
    role:    { es: 'Tiene las llaves; rechaza ejecuciones inseguras', en: 'Holds the keys; refuses unsafe execs' },
    department: 'Execution Desk',
    archetype: 'guardian',
    unlockReason: {
      es: 'Se contratará al desbloquear el módulo de Decisiones.',
      en: 'Hired when the Decisions module is unlocked.',
    },
    unlockCondition: 'module-unlocked-decisions',
    state: 'pending',
  },
  {
    id: 'future-news-analyst',
    name:    { es: 'Analista de noticias',    en: 'News Analyst' },
    role:    { es: 'Lee señales públicas y las sintetiza',   en: 'Reads public signals and synthesizes' },
    department: 'Memory Archive',
    archetype: 'listener',
    unlockReason: {
      es: 'Se contratará al desbloquear el módulo de Mercados.',
      en: 'Hired when the Markets module is unlocked.',
    },
    unlockCondition: 'module-unlocked-markets',
    state: 'pending',
  },
  {
    id: 'future-probability-analyst',
    name:    { es: 'Analista de probabilidad', en: 'Probability Analyst' },
    role:    { es: 'Modela tasas base de cada pregunta', en: 'Builds base-rate models per question' },
    department: 'Strategy Lab',
    archetype: 'scientist',
    unlockReason: {
      es: 'Se contratará al desbloquear el módulo de Decisiones.',
      en: 'Hired when the Decisions module is unlocked.',
    },
    unlockCondition: 'module-unlocked-decisions',
    state: 'pending',
  },
  {
    id: 'future-intern-analyst',
    name:    { es: 'Pasante analista',        en: 'Intern Analyst' },
    role:    { es: 'Pregunta, aprende, ejecuta tareas simples', en: 'Asks, learns, runs simple tasks' },
    department: 'Genesis HR',
    archetype: 'intern',
    unlockReason: {
      es: 'Se contratará si hay demasiadas tareas pendientes.',
      en: 'Hired if too many tasks pile up.',
    },
    unlockCondition: 'tasks-pending-many',
    state: 'pending',
  },
  {
    id: 'future-audit-agent',
    name:    { es: 'Agente de auditoría',     en: 'Audit Agent' },
    role:    { es: 'Audita decisiones pasadas y mide acierto', en: 'Audits past decisions, measures accuracy' },
    department: 'Audit Office',
    archetype: 'reviewer',
    unlockReason: {
      es: 'Se contratará cuando haya errores recurrentes.',
      en: 'Hired when recurring errors are detected.',
    },
    unlockCondition: 'errors-keep-happening',
    state: 'pending',
  },
  {
    id: 'future-ui-maintenance',
    name:    { es: 'Operario de mantenimiento', en: 'UI Maintenance Worker' },
    role:    { es: 'Actualiza zonas y atiende eventos visuales', en: 'Upgrades zones and handles visual events' },
    department: 'Operations Room',
    archetype: 'engineer',
    unlockReason: {
      es: 'Se llama cuando una zona requiere mejora.',
      en: 'Called when a zone needs upgrading.',
    },
    unlockCondition: 'office-needs-upgrade',
    state: 'visual-seed',
  },
  {
    id: 'future-office-builder',
    name:    { es: 'Contratista virtual',      en: 'Virtual Contractor' },
    role:    { es: 'Construye estaciones nuevas en la oficina', en: 'Builds new stations in the office' },
    department: 'Operations Room',
    archetype: 'engineer',
    unlockReason: {
      es: 'Se llama cuando la oficina necesita expansión.',
      en: 'Called when the office needs expansion.',
    },
    unlockCondition: 'office-needs-upgrade',
    state: 'visual-seed',
  },
];
