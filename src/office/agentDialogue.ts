// agentDialogue — picks honest messages for agents and manages the
// bubble lifecycle (cooldowns, concurrency, priority) for Phase 3.
//
// Everything an agent says passes through generateAgentDialogue, which
// rejects any message matching FORBIDDEN_PATTERNS — so result-sounding
// claims cannot reach the screen, in this phase or future ones.

import {
  AGENT_COOLDOWN_MAX_MS,
  AGENT_COOLDOWN_MIN_MS,
  BASE_MESSAGES,
  BUBBLE_MAX_MS,
  BUBBLE_MIN_MS,
  GLOBAL_BUBBLE_GAP_MS,
  isMessageAllowed,
  MAX_VISIBLE_BUBBLES,
} from './officeDialogueRules';
import type {
  ActiveDialogueBubble,
  AgentDialogueMessage,
  LiveOfficeAgent,
  LiveOfficeState,
  LocalizedDialogueText,
  OfficeAgentId,
} from './officeTypes';

const randBetween = (min: number, max: number) => min + Math.random() * (max - min);
const msg = (es: string, en: string, priority: 'routine' | 'alert' = 'routine'): AgentDialogueMessage => ({
  text: { es, en },
  priority,
});

type ActivitySignal = 'pause' | 'waiting' | 'momentum' | 'breakout' | 'volatility' | 'neutral' | 'risk' | 'monitoring' | 'unknown';

function normalize(text: string | null): string {
  return (text ?? '').toLowerCase();
}

function extractPair(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\b([A-Z]{2,10}(?:\/USDT|USDT)?)\b/);
  return match?.[1] ?? null;
}

function deriveActivitySignal(state: LiveOfficeState): ActivitySignal {
  const text = normalize(state.latestActivity);
  if (!text) return 'unknown';
  if (/\bpause|paused|wait|waiting|stand by|neutral\b/.test(text)) return /\bpause|paused\b/.test(text) ? 'pause' : 'waiting';
  if (/\bbreakout|rupture|ruptura\b/.test(text)) return 'breakout';
  if (/\bmomentum|trend|impulse|impulso\b/.test(text)) return 'momentum';
  if (/\bvol|volatility|low vol|high vol|chop\b/.test(text)) return 'volatility';
  if (/\brisk|drawdown|loss|fatigue|blocked\b/.test(text)) return 'risk';
  if (/\bmonitor|position|open\b/.test(text)) return 'monitoring';
  if (/\bcontext|range|regime|scan|structure\b/.test(text)) return 'neutral';
  return 'unknown';
}

function contextualMessages(agent: LiveOfficeAgent, state: LiveOfficeState): AgentDialogueMessage[] {
  if (!state.liveDataConnected) return [];

  const signal = deriveActivitySignal(state);
  const pair = extractPair(state.latestActivity);
  const pos = state.openPositionsCount;
  const risk = normalize(state.riskStatus);
  const messages: AgentDialogueMessage[] = [];

  if (agent.def.id === 'risk') {
    if (state.engineStatus === 'offline') {
      messages.push(msg('Motor sin latido. Mantengo bloqueo.', 'Engine heartbeat missing. Holding the block.', 'alert'));
    } else if (state.engineStatus === 'degraded') {
      messages.push(msg('Motor degradado. Reviso permisos antes de liberar riesgo.', 'Engine degraded. Reviewing permissions before releasing risk.'));
    }
    if (risk.includes('critical')) {
      messages.push(msg('Riesgo critico detectado. Nada se fuerza.', 'Critical risk detected. Nothing gets forced.', 'alert'));
    } else if (risk.includes('high') || risk.includes('warning') || risk.includes('elevated')) {
      messages.push(msg('Riesgo elevado. Solo dejo pasar estructura limpia.', 'Risk elevated. Only clean structure gets through.'));
    }
    if (pos !== null) {
      messages.push(msg(`Tengo ${pos} posiciones bajo control de riesgo.`, `I have ${pos} positions under risk control.`));
    }
  }

  if (agent.def.id === 'execution') {
    if (pos !== null && pos > 0) {
      messages.push(msg(`Hay ${pos} posiciones abiertas. Monitoreando ejecucion.`, `There are ${pos} open positions. Monitoring execution.`));
    } else if (pos === 0) {
      messages.push(msg('Sin orden activa confirmada.', 'No active order confirmed.'));
    }
    if (signal === 'pause' || signal === 'waiting') {
      messages.push(msg('Desk en espera hasta nueva confirmacion.', 'Desk waiting for renewed confirmation.'));
    }
    if (state.engineStatus === 'degraded') {
      messages.push(msg('Ejecucion en modo prudente por latencia del motor.', 'Execution in cautious mode due to engine latency.'));
    }
  }

  if (agent.def.id === 'portfolio') {
    if (pos !== null) {
      messages.push(msg(`Exposicion viva: ${pos} posiciones activas.`, `Live exposure: ${pos} active positions.`));
    }
    if (signal === 'monitoring' || signal === 'risk') {
      messages.push(msg('Estoy conciliando exposicion y margen.', 'Reconciling exposure and margin.'));
    }
    if (state.engineStatus === 'offline') {
      messages.push(msg('Sin telemetria fresca. Mantengo vigilancia pasiva.', 'No fresh telemetry. Keeping passive watch.'));
    }
  }

  if (agent.def.id === 'scout') {
    if (signal === 'breakout') {
      messages.push(msg(
        pair ? `${pair} entra en radar de ruptura.` : 'Tengo una posible ruptura en radar.',
        pair ? `${pair} is entering breakout radar.` : 'A possible breakout is on radar.',
      ));
    }
    if (signal === 'momentum') {
      messages.push(msg(
        pair ? `Estoy midiendo el impulso en ${pair}.` : 'Estoy midiendo el impulso actual.',
        pair ? `Measuring momentum in ${pair}.` : 'Measuring current momentum.',
      ));
    }
    if (signal === 'waiting' || signal === 'pause') {
      messages.push(msg('El flujo sigue sucio. No mando nada al desk.', 'Flow is still dirty. Sending nothing to the desk.'));
    }
    if (signal === 'volatility') {
      messages.push(msg('La volatilidad sigue inestable. Espero estructura.', 'Volatility remains unstable. Waiting for structure.'));
    }
  }

  if (agent.def.id === 'analyst') {
    if (signal === 'neutral' || signal === 'unknown') {
      messages.push(msg('El contexto sigue mixto. Falta claridad.', 'Context remains mixed. Clarity is still missing.'));
    }
    if (signal === 'momentum') {
      messages.push(msg('El impulso existe, pero sigo validando continuidad.', 'Momentum exists, but I am still validating continuation.'));
    }
    if (signal === 'breakout') {
      messages.push(msg('La ruptura necesita confirmacion estructural.', 'The breakout still needs structural confirmation.'));
    }
    if (pair) {
      messages.push(msg(`${pair} sigue bajo lectura contextual.`, `${pair} remains under contextual review.`));
    }
  }

  return messages;
}

function contextualPriority(agent: LiveOfficeAgent, state: LiveOfficeState): number {
  const messages = contextualMessages(agent, state);
  if (messages.some((m) => m.priority === 'alert')) return 2;
  if (messages.length > 0) return 1;
  return 0;
}

/**
 * Returns an allowed message for this agent's role + current state, or
 * null when the agent has nothing honest to say (e.g. walking, or a
 * reserved state like warning/executing with no real event behind it).
 */
export function generateAgentDialogue(
  agent: LiveOfficeAgent,
  officeState: LiveOfficeState,
  lastText?: LocalizedDialogueText,
): AgentDialogueMessage | null {
  // Phase 3: no live data is ever connected, so only the generic honest
  // catalog applies. Phase 4 will branch here on real officeState events.
  const pool = [
    ...contextualMessages(agent, officeState),
    ...(BASE_MESSAGES[agent.def.id][agent.state] ?? []),
  ];
  const candidates = pool.filter((m) => {
    if (!isMessageAllowed(m.text.es) || !isMessageAllowed(m.text.en)) {
      console.warn('[agentDialogue] blocked forbidden message:', m.text.es, '|', m.text.en);
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;

  const fresh = candidates.filter((m) => m.text.es !== lastText?.es && m.text.en !== lastText?.en);
  const pickFrom = fresh.length > 0 ? fresh : candidates;
  return pickFrom[Math.floor(Math.random() * pickFrom.length)];
}

export interface DialogueRuntime {
  bubbles: ActiveDialogueBubble[];
  nextGlobalSpeakAt: number;
  nextSpeakAt: Partial<Record<OfficeAgentId, number>>;
  lastText: Partial<Record<OfficeAgentId, LocalizedDialogueText>>;
  nextBubbleId: number;
}

export function createDialogueRuntime(now: number): DialogueRuntime {
  return {
    bubbles: [],
    // brief quiet period after load before anyone speaks
    nextGlobalSpeakAt: now + 2_000,
    nextSpeakAt: {},
    lastText: {},
    nextBubbleId: 1,
  };
}

/**
 * Advances the dialogue system one frame: expires old bubbles and lets at
 * most one agent start speaking per call, respecting per-agent cooldowns,
 * the office-wide gap, and the bubble budget. Alerts (Phase 4) preempt a
 * routine bubble when all slots are busy.
 */
export function stepDialogue(
  runtime: DialogueRuntime,
  agents: LiveOfficeAgent[],
  officeState: LiveOfficeState,
  now: number,
): ActiveDialogueBubble[] {
  runtime.bubbles = runtime.bubbles.filter((b) => b.expiresAt > now);

  if (now < runtime.nextGlobalSpeakAt) return runtime.bubbles;

  const speaking = new Set(runtime.bubbles.map((b) => b.agentId));
  const eligible = agents.filter((a) =>
    a.state !== 'walking'
    && !speaking.has(a.def.id)
    && now >= (runtime.nextSpeakAt[a.def.id] ?? 0),
  );
  if (eligible.length === 0) return runtime.bubbles;

  const bestPriority = Math.max(...eligible.map((a) => contextualPriority(a, officeState)));
  const priorityPool = eligible.filter((a) => contextualPriority(a, officeState) === bestPriority);
  const agent = priorityPool[Math.floor(Math.random() * priorityPool.length)];
  const message = generateAgentDialogue(agent, officeState, runtime.lastText[agent.def.id]);
  if (!message) {
    // nothing honest to say right now — small per-agent backoff
    runtime.nextSpeakAt[agent.def.id] = now + 4_000;
    return runtime.bubbles;
  }

  if (runtime.bubbles.length >= MAX_VISIBLE_BUBBLES) {
    if (message.priority !== 'alert') return runtime.bubbles;
    const routineIdx = runtime.bubbles.findIndex((b) => b.priority === 'routine');
    if (routineIdx === -1) return runtime.bubbles;
    runtime.bubbles.splice(routineIdx, 1); // alert preempts oldest routine bubble
  }

  runtime.bubbles.push({
    id: runtime.nextBubbleId++,
    agentId: agent.def.id,
    text: message.text,
    priority: message.priority,
    startedAt: now,
    expiresAt: now + randBetween(BUBBLE_MIN_MS, BUBBLE_MAX_MS),
  });
  runtime.lastText[agent.def.id] = message.text;
  runtime.nextSpeakAt[agent.def.id] = now + randBetween(AGENT_COOLDOWN_MIN_MS, AGENT_COOLDOWN_MAX_MS);
  runtime.nextGlobalSpeakAt = now + GLOBAL_BUBBLE_GAP_MS;
  return runtime.bubbles;
}
