// Registry of Genesis modules. The sidebar reads this to render nav.
// Each module has:
//   - id (route key)
//   - state (drives badge color + placeholder copy)
//   - i18n keys for title, description, future actions, relation to HQ
//
// State enum is referenced by both the sidebar badge and the
// ModulePlaceholder copy.

import type { TKey } from '../i18n/translations';

export type ModuleId =
  | 'dashboard'
  | 'hq'
  | 'factory'
  | 'auto'
  | 'hr'
  | 'markets'
  | 'decisions'
  | 'progress'
  | 'settings';

export type ModuleState =
  | 'ready'
  | 'visual-only'
  | 'locked-backend'
  | 'locked-polymarket'
  | 'disabled-phase-8';

export interface ModuleEntry {
  id: ModuleId;
  navKey: TKey;
  state: ModuleState;
  /** description shown in the placeholder; bilingual via inline strings */
  description: { es: string; en: string };
  futureActions: { es: string; en: string }[];
  relation: { es: string; en: string };
}

const STATE_TO_TKEY: Record<ModuleState, TKey> = {
  'ready':              'state.ready',
  'visual-only':        'state.visualOnly',
  'locked-backend':     'state.lockedBackend',
  'locked-polymarket':  'state.lockedPolymarket',
  'disabled-phase-8':   'state.disabledPhase8',
};

export function stateTKey(s: ModuleState): TKey {
  return STATE_TO_TKEY[s];
}

export const MODULES: ModuleEntry[] = [
  {
    id: 'dashboard',
    navKey: 'nav.dashboard',
    state: 'visual-only',
    description: {
      es: 'Vista general de Génesis: agentes activos, nivel de aprendizaje, salud de la empresa y módulos desbloqueados.',
      en: 'Overview of Genesis: active agents, learning level, company health, and unlocked modules.',
    },
    futureActions: [
      { es: 'Resumen de tareas del día.',           en: 'Daily task summary.' },
      { es: 'Saltos rápidos a cada módulo.',         en: 'Quick jumps to each module.' },
      { es: 'Alertas pendientes del Guardián de Riesgo.', en: 'Pending alerts from Risk Guardian.' },
    ],
    relation: {
      es: 'Es el punto de entrada antes de bajar a la oficina.',
      en: 'The entry point before going down to the office.',
    },
  },
  {
    id: 'hq',
    navKey: 'nav.hq',
    state: 'ready',
    description: {
      es: 'La sede central donde viven los agentes activos. Mapa pixel art de una sola pantalla.',
      en: 'The headquarters where active agents live. Single-screen pixel-art map.',
    },
    futureActions: [
      { es: 'Click en agente abre su panel detallado.', en: 'Click an agent to open its detail panel.' },
      { es: 'Burbujas de conversación se actualizan en vivo.', en: 'Conversation bubbles update live.' },
      { es: 'Eventos de oficina (mejoras) aparecen como obras temporales.', en: 'Office events (upgrades) appear as temporary works.' },
    ],
    relation: {
      es: 'Es la propia oficina — esta pantalla es Génesis HQ.',
      en: 'This is the office itself — this screen is Genesis HQ.',
    },
  },
  {
    id: 'factory',
    navKey: 'nav.factory',
    state: 'locked-backend',
    description: {
      es: 'Aquí se crearán agentes manualmente o desde plantillas de agency-agents.',
      en: 'Here agents will be created manually or from agency-agents templates.',
    },
    futureActions: [
      { es: 'Crear agente con rol, departamento, herramientas y límites.', en: 'Create an agent with role, department, tools, and limits.' },
      { es: 'Importar skill desde agency-agents.',  en: 'Import a skill from agency-agents.' },
      { es: 'Asignar visualProfile (paleta + arquetipo).', en: 'Assign visualProfile (palette + archetype).' },
    ],
    relation: {
      es: 'Cada agente creado aquí aparece luego sentado en su zona de Génesis HQ.',
      en: 'Each agent created here later appears seated in its zone in Genesis HQ.',
    },
  },
  {
    id: 'auto',
    navKey: 'nav.auto',
    state: 'locked-backend',
    description: {
      es: 'Escribe un objetivo. Génesis propondrá un equipo de agentes para ejecutarlo.',
      en: 'Write an objective. Genesis proposes a team of agents to execute it.',
    },
    futureActions: [
      { es: 'Interpretar objetivo del usuario.',     en: 'Interpret the user’s goal.' },
      { es: 'Proponer plantilla de agentes y herramientas.', en: 'Propose an agent/tool roster.' },
      { es: 'Aprobar y crear el equipo de un click.', en: 'Approve and spawn the roster with one click.' },
    ],
    relation: {
      es: 'Los agentes creados aquí son contratados directamente y se ven en la oficina.',
      en: 'Agents created here are hired directly and show up in the office.',
    },
  },
  {
    id: 'hr',
    navKey: 'nav.hr',
    state: 'visual-only',
    description: {
      es: 'Recursos humanos de Génesis: plantilla actual, cola de contratación y recomendaciones del Evaluador.',
      en: 'Genesis HR: current roster, hiring queue, and Evaluator recommendations.',
    },
    futureActions: [
      { es: 'Promover, reentrenar, suspender o despedir agentes.', en: 'Promote, retrain, suspend or fire agents.' },
      { es: 'Contratar candidatos cuando se cumpla la condición de desbloqueo.', en: 'Hire candidates when the unlock condition is met.' },
      { es: 'Ver historial de contrataciones y despidos.', en: 'View hire/fire history.' },
    ],
    relation: {
      es: 'Las contrataciones aparecen como nuevos personajes en la oficina.',
      en: 'Hires appear as new characters on the office floor.',
    },
  },
  {
    id: 'markets',
    navKey: 'nav.markets',
    state: 'ready',
    description: {
      es: 'Aquí se conectará Polymarket de solo lectura para listar mercados reales. Sin trading real.',
      en: 'Read-only snapshot of real Polymarket markets. No real trading.',
    },
    futureActions: [
      { es: 'Listar mercados activos por volumen/liquidez.', en: 'List active markets by volume/liquidity.' },
      { es: 'Mostrar precios, outcomes y fecha de cierre.', en: 'Show prices, outcomes, and end dates.' },
      { es: 'Si el proveedor falla, mostrar el error real.', en: 'If the provider fails, show the real error.' },
    ],
    relation: {
      es: 'El Escáner de mercado leerá estos datos desde su escritorio en HQ.',
      en: 'Market Scanner will read this data from its desk in HQ.',
    },
  },
  {
    id: 'decisions',
    navKey: 'nav.decisions',
    state: 'locked-backend',
    description: {
      es: 'Decisiones tomadas por Génesis con razones, riesgos y resultado.',
      en: 'Decisions taken by Genesis with reasons, risks, and outcomes.',
    },
    futureActions: [
      { es: 'Disparar análisis Bull / Bear / Riesgo.', en: 'Trigger Bull / Bear / Risk analysis.' },
      { es: 'Ver veto del Guardián de Riesgo.',        en: 'See the Risk Guardian veto.' },
      { es: 'Auditar precisión cuando se resuelve.',   en: 'Audit accuracy when resolved.' },
    ],
    relation: {
      es: 'Cada decisión refleja una conversación entre agentes en HQ.',
      en: 'Each decision reflects an agent conversation in HQ.',
    },
  },
  {
    id: 'progress',
    navKey: 'nav.progress',
    state: 'visual-only',
    description: {
      es: 'Métricas de crecimiento de Génesis: edad, aprendizaje, contrataciones, mejoras.',
      en: 'Genesis growth metrics: age, learning, hires, upgrades.',
    },
    futureActions: [
      { es: 'Fórmula transparente del nivel de aprendizaje.', en: 'Transparent learning-level formula.' },
      { es: 'Tendencias semanales.',                       en: 'Weekly trends.' },
      { es: 'Eventos clave (primer despido, primera mejora).', en: 'Key events (first fire, first upgrade).' },
    ],
    relation: {
      es: 'Las métricas determinan qué módulos y agentes se desbloquean.',
      en: 'Metrics determine which modules and agents unlock.',
    },
  },
  {
    id: 'settings',
    navKey: 'nav.settings',
    state: 'visual-only',
    description: {
      es: 'Ajustes del laboratorio visual. Por ahora: idioma. Otras opciones se habilitan con el backend.',
      en: 'Visual lab settings. For now: language. Others unlock with the backend.',
    },
    futureActions: [
      { es: 'Configurar proveedores LLM.',          en: 'Configure LLM providers.' },
      { es: 'Conectar Polymarket de solo lectura.', en: 'Connect Polymarket read-only.' },
      { es: 'Definir ruta de agency-agents.',       en: 'Define agency-agents path.' },
    ],
    relation: {
      es: 'No afecta la oficina visual. Afectará a Génesis real desde fase 8.',
      en: 'Doesn’t affect the visual office. Will affect real Genesis from phase 8.',
    },
  },
];

export const MODULE_BY_ID: Record<ModuleId, ModuleEntry> =
  Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ModuleId, ModuleEntry>;
