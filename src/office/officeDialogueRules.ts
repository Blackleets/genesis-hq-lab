// officeDialogueRules — the allowed dialogue catalog and pacing rules
// for the live tile office (Phase 3).
//
// Honesty contract: without real system data the agents may only speak
// generic status lines (scanning / waiting / monitoring / analyzing /
// no confirmed edge). Result-sounding language is structurally banned
// via FORBIDDEN_PATTERNS, which generateAgentDialogue enforces at
// runtime on every candidate message — including future Phase 4 ones.

import type {
  AgentDialogueMessage,
  AgentState,
  OfficeAgentId,
} from './officeTypes';

/** Screen budget: never more than this many bubbles at once. */
export const MAX_VISIBLE_BUBBLES = 2;

/** How long a bubble stays up (random within range). */
export const BUBBLE_MIN_MS = 3000;
export const BUBBLE_MAX_MS = 5000;

/** Per-agent silence between their own bubbles (random within range). */
export const AGENT_COOLDOWN_MIN_MS = 14_000;
export const AGENT_COOLDOWN_MAX_MS = 26_000;

/** Minimum gap between any two bubble starts, office-wide. */
export const GLOBAL_BUBBLE_GAP_MS = 2_500;

/**
 * Claims that may never appear unless they come from a verified real
 * event (Phase 4 will attach provenance; until then nothing passes).
 */
export const FORBIDDEN_PATTERNS: RegExp[] = [
  /profit/i,
  /pnl/i,
  /trade\s+(opened|closed|filled)/i,
  /position\s+opened/i,
  /alpha/i,
  /tp\s+hit/i,
  /sl\s+hit/i,
  /take\s+profit/i,
  /stop\s+loss\s+hit/i,
  /\bwin(ner|ning)?\b/i,
  /signal\s+(found|confirmed)/i,
  /\+\d+(\.\d+)?\s*%/,
];

export function isMessageAllowed(text: string): boolean {
  return !FORBIDDEN_PATTERNS.some((re) => re.test(text));
}

const msg = (es: string, en: string): AgentDialogueMessage => ({
  text: { es, en },
  priority: 'routine',
});

/**
 * Work-oriented honest lines, by agent and visual state. States missing
 * here (walking, warning, executing) produce silence on purpose:
 * warning and executing may only speak when driven by a real event.
 */
export const BASE_MESSAGES: Record<OfficeAgentId, Partial<Record<AgentState, AgentDialogueMessage[]>>> = {
  scout: {
    scanning: [
      msg('Escaneando estructura de mercado.', 'Scanning market structure.'),
      msg('Revisando ruptura y volumen.', 'Reviewing breakout and volume.'),
      msg('Comparando impulsos entre marcos.', 'Comparing momentum across timeframes.'),
      msg('Buscando una entrada limpia.', 'Looking for a clean entry.'),
    ],
    thinking: [
      msg('Esperando un setup valido.', 'Waiting for a valid setup.'),
      msg('La senal todavia no esta limpia.', 'The signal is not clean yet.'),
      msg('Necesito mejor confirmacion antes de alertar.', 'Need stronger confirmation before alerting.'),
    ],
    idle: [
      msg('Vigilando el flujo del mercado.', 'Watching market flow.'),
      msg('Sin gatillo operativo por ahora.', 'No operational trigger yet.'),
    ],
  },
  risk: {
    thinking: [
      msg('Chequeo de riesgo activo.', 'Risk check active.'),
      msg('Validando exposicion antes de permitir entrada.', 'Validating exposure before allowing entry.'),
      msg('Esperando condiciones mas limpias.', 'Waiting for cleaner conditions.'),
    ],
    idle: [
      msg('Sin entradas forzadas.', 'No forced entries.'),
      msg('Disciplina primero, ejecucion despues.', 'Discipline first, execution second.'),
    ],
  },
  execution: {
    monitoring: [
      msg('Desk de ejecucion listo.', 'Execution desk ready.'),
      msg('Sin orden activa confirmada.', 'No active order confirmed.'),
      msg('Revisando condiciones antes de enviar orden.', 'Checking conditions before routing an order.'),
      msg('Esperando confirmacion operativa.', 'Waiting for operational confirmation.'),
    ],
    idle: [
      msg('En espera del desk.', 'Standing by at the desk.'),
      msg('Listo para enrutar si aparece una senal valida.', 'Ready to route if a valid signal appears.'),
    ],
  },
  analyst: {
    scanning: [
      msg('Analizando calidad del setup.', 'Analyzing setup quality.'),
      msg('Contexto de mercado en revision.', 'Market context under review.'),
      msg('Midiendo fuerza, continuidad y ruido.', 'Measuring strength, continuation, and noise.'),
      msg('Separando impulso real de movimiento sucio.', 'Separating real momentum from noisy movement.'),
    ],
    thinking: [
      msg('Todavia no veo edge confirmado.', 'No confirmed edge yet.'),
      msg('La lectura sigue en evaluacion.', 'The read is still under evaluation.'),
      msg('Quiero mas claridad antes de validar.', 'Need more clarity before validating.'),
    ],
    idle: [
      msg('Contexto de mercado en revision.', 'Market context under review.'),
      msg('Manteniendo lectura neutral por ahora.', 'Keeping a neutral read for now.'),
    ],
  },
  portfolio: {
    monitoring: [
      msg('Monitoreando exposicion.', 'Monitoring exposure.'),
      msg('Chequeo de portafolio activo.', 'Portfolio check active.'),
      msg('Revisando capital, margen y concentracion.', 'Reviewing capital, margin, and concentration.'),
      msg('Sin cambios confirmados en exposicion.', 'No confirmed change in exposure.'),
    ],
    thinking: [
      msg('Esperando datos confirmados.', 'Waiting for confirmed data.'),
      msg('Conciliando estado del portafolio.', 'Reconciling portfolio state.'),
      msg('Verificando consistencia entre desks.', 'Verifying consistency across desks.'),
    ],
    idle: [
      msg('Chequeo de portafolio activo.', 'Portfolio check active.'),
      msg('Capital bajo observacion.', 'Capital under observation.'),
    ],
  },
};
