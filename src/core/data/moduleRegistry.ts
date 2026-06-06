// Registry of Genesis modules. The sidebar reads this to render nav.
// Each module has:
//   - id (route key)
//   - state (drives badge color + placeholder copy)
//   - i18n keys for title, description, future actions, relation to HQ
//
// State enum is referenced by both the sidebar badge and the
// ModulePlaceholder copy.

import type { TKey } from '@core/i18n/translations';

export type ModuleId =
  | 'dashboard'
  | 'hq'
  | 'factory'
  | 'auto'
  | 'hr'
  | 'markets'
  | 'decisions'
  | 'progress'
  | 'settings'
  | 'wallet'
  | 'marketing'
  | 'tech'
  | 'console'
  | 'integrations'
  | 'agents-live'
  | 'edge'
  | 'crypto'
  | 'system';

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
    state: 'ready',
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
    state: 'ready',
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
    state: 'ready',
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
    state: 'ready',
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
    id: 'edge',
    navKey: 'nav.edge',
    state: 'ready',
    description: {
      es: 'Scorecard GO/NO-GO: métricas de edge real para decidir cuándo pasar a capital real.',
      en: 'GO/NO-GO scorecard: real edge metrics to decide when to move to real capital.',
    },
    futureActions: [
      { es: 'Ver veredicto en tiempo real.', en: 'View real-time verdict.' },
      { es: 'Checklist de condiciones GO.', en: 'GO conditions checklist.' },
      { es: 'Historial de progreso hacia GO.', en: 'Progress history toward GO.' },
    ],
    relation: {
      es: 'Cuando el veredicto sea GO, activar REAL_TRADING=1.',
      en: "When verdict is GO, flip REAL_TRADING=1.",
    },
  },
  {
    id: 'crypto',
    navKey: 'nav.crypto',
    state: 'ready',
    description: {
      es: 'Motor de scalping crypto: params en vivo, optimizador entrenando 24/7, PnL real con costos y posiciones abiertas.',
      en: 'Crypto scalping engine: live params, optimizer training 24/7, real cost-aware PnL, and open positions.',
    },
    futureActions: [
      { es: 'Ver al optimizador adoptar o rechazar configs (walk-forward).', en: 'Watch the optimizer adopt or reject configs (walk-forward).' },
      { es: 'PnL crypto separado del de Polymarket, con costos.', en: 'Crypto PnL separated from Polymarket, cost-aware.' },
      { es: 'Posiciones abiertas con target/stop en vivo.', en: 'Open positions with live target/stop.' },
    ],
    relation: {
      es: 'El scalper crypto opera desde su escritorio en HQ con el motor validado por backtest.',
      en: 'The crypto scalper trades from its HQ desk with the backtest-validated engine.',
    },
  },
  {
    id: 'system',
    navKey: 'nav.system',
    state: 'ready',
    description: {
      es: 'Diagnóstico granular de sistema: DB, WebSocket, agentes, Kalshi, learning loop, treasury.',
      en: 'Granular system diagnostics: DB, WebSocket, agents, Kalshi, learning loop, treasury.',
    },
    futureActions: [
      { es: 'Alertas en tiempo real de desincronización.', en: 'Real-time desync alerts.' },
      { es: 'Historial de issues detectados.', en: 'Detected issues history.' },
    ],
    relation: {
      es: 'Source of truth del sistema — datos reales de todos los subsistemas.',
      en: 'System source of truth — real data from all subsystems.',
    },
  },
  {
    id: 'progress',
    navKey: 'nav.progress',
    state: 'ready',
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
  {
    id: 'wallet',
    navKey: 'nav.wallet',
    state: 'ready',
    description: {
      es: 'Conecta tu wallet de Polygon para habilitar trading real con USDC en Polymarket.',
      en: 'Connect your Polygon wallet to enable real USDC trading on Polymarket.',
    },
    futureActions: [
      { es: 'Ver balance MATIC y USDC en tiempo real.', en: 'View real-time MATIC and USDC balance.' },
      { es: 'Habilitar modo de trading real.',           en: 'Enable real trading mode.' },
      { es: 'Firmar órdenes en Polymarket via CLOB.',    en: 'Sign orders on Polymarket via CLOB.' },
    ],
    relation: {
      es: 'Cuando conectada, los agentes trader operarán con capital real.',
      en: 'When connected, trader agents will operate with real capital.',
    },
  },
  {
    id: 'marketing',
    navKey: 'nav.marketing',
    state: 'visual-only',
    description: {
      es: 'División de Marketing & Growth. Campañas, contenido, SEO y análisis de crecimiento gestionados por agentes especializados.',
      en: 'Marketing & Growth division. Campaigns, content, SEO, and growth analysis managed by specialized agents.',
    },
    futureActions: [
      { es: 'Lanzar campañas con agente CMO.', en: 'Launch campaigns with CMO agent.' },
      { es: 'Medir embudo de conversión.', en: 'Measure conversion funnel.' },
      { es: 'Integración con Google Ads y SEMrush.', en: 'Google Ads and SEMrush integration.' },
    ],
    relation: {
      es: 'Los agentes de Marketing operan desde Growth Room y Design Studio en HQ.',
      en: 'Marketing agents operate from Growth Room and Design Studio in HQ.',
    },
  },
  {
    id: 'tech',
    navKey: 'nav.tech',
    state: 'ready',
    description: {
      es: 'División Tecnológica & Operaciones. Sprint board, code review, QA y deploys gestionados por agentes de ingeniería.',
      en: 'Tech & Operations division. Sprint board, code review, QA, and deployments managed by engineering agents.',
    },
    futureActions: [
      { es: 'Sprint board con backlog y kanban.', en: 'Sprint board with backlog and kanban.' },
      { es: 'Velocity chart semanal.', en: 'Weekly velocity chart.' },
      { es: 'Integración con GitHub para deploy log.', en: 'GitHub integration for deploy log.' },
    ],
    relation: {
      es: 'Los agentes Tech operan desde Operations Room en HQ.',
      en: 'Tech agents operate from Operations Room in HQ.',
    },
  },
  {
    id: 'console',
    navKey: 'nav.console',
    state: 'ready',
    description: {
      es: 'Consola de delegación. Escribe qué quieres lograr y los agentes lo ejecutan en tiempo real con seguimiento en vivo.',
      en: 'Delegation console. Write what you want to achieve and agents execute it in real time with live tracking.',
    },
    futureActions: [
      { es: 'Historial de comandos persistente.', en: 'Persistent command history.' },
      { es: 'Asignación automática por capacidades.', en: 'Auto-assignment by capabilities.' },
      { es: 'Feedback adaptativo con Claude.', en: 'Adaptive feedback with Claude.' },
    ],
    relation: {
      es: 'Los comandos de la consola crean tareas que los agentes ejecutan en Génesis HQ.',
      en: 'Console commands create tasks that agents execute in Genesis HQ.',
    },
  },
  {
    id: 'integrations',
    navKey: 'nav.integrations',
    state: 'ready',
    description: {
      es: 'Conecta Genesis HQ a plataformas externas. Los agentes ejecutan trabajo real en Facebook, LinkedIn, Slack, GitHub y más.',
      en: 'Connect Genesis HQ to external platforms. Agents execute real work on Facebook, LinkedIn, Slack, GitHub, and more.',
    },
    futureActions: [
      { es: 'OAuth automático para redes sociales.', en: 'Automatic OAuth for social networks.' },
      { es: 'Historial de sincronizaciones por plataforma.', en: 'Sync history per platform.' },
      { es: 'Rate limits y cuotas en tiempo real.', en: 'Real-time rate limits and quotas.' },
    ],
    relation: {
      es: 'Los agentes de Marketing y Tech usan estas integraciones para ejecutar trabajo en plataformas externas.',
      en: 'Marketing and Tech agents use these integrations to execute work on external platforms.',
    },
  },
  {
    id: 'agents-live',
    navKey: 'nav.agents-live',
    state: 'ready',
    description: {
      es: 'Agentes IA reales con ejecución de tareas, memoria por agente, logs en vivo y soporte multi-proveedor (Claude, OpenAI, Gemini).',
      en: 'Real AI agents with task execution, per-agent memory, live logs, and multi-provider support (Claude, OpenAI, Gemini).',
    },
    futureActions: [
      { es: 'Asignar tareas a agentes específicos.', en: 'Assign tasks to specific agents.' },
      { es: 'Ver logs de ejecución en tiempo real.', en: 'View real-time execution logs.' },
      { es: 'Cambiar proveedor LLM por agente.', en: 'Switch LLM provider per agent.' },
    ],
    relation: {
      es: 'Cada agente aquí tiene un gemelo visual en Génesis HQ.',
      en: 'Each agent here has a visual twin in Genesis HQ.',
    },
  },
];

export const MODULE_BY_ID: Record<ModuleId, ModuleEntry> =
  Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<ModuleId, ModuleEntry>;
