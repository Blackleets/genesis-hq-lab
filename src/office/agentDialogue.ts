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
  OfficeAgentId,
} from './officeTypes';

const randBetween = (min: number, max: number) => min + Math.random() * (max - min);

/**
 * Returns an allowed message for this agent's role + current state, or
 * null when the agent has nothing honest to say (e.g. walking, or a
 * reserved state like warning/executing with no real event behind it).
 */
export function generateAgentDialogue(
  agent: LiveOfficeAgent,
  officeState: LiveOfficeState,
  lastText?: string,
): AgentDialogueMessage | null {
  // Phase 3: no live data is ever connected, so only the generic honest
  // catalog applies. Phase 4 will branch here on real officeState events.
  void officeState.liveDataConnected;

  const pool = BASE_MESSAGES[agent.def.id][agent.state] ?? [];
  const candidates = pool.filter((m) => {
    if (!isMessageAllowed(m.text)) {
      console.warn('[agentDialogue] blocked forbidden message:', m.text);
      return false;
    }
    return true;
  });
  if (candidates.length === 0) return null;

  const fresh = candidates.filter((m) => m.text !== lastText);
  const pickFrom = fresh.length > 0 ? fresh : candidates;
  return pickFrom[Math.floor(Math.random() * pickFrom.length)];
}

export interface DialogueRuntime {
  bubbles: ActiveDialogueBubble[];
  nextGlobalSpeakAt: number;
  nextSpeakAt: Partial<Record<OfficeAgentId, number>>;
  lastText: Partial<Record<OfficeAgentId, string>>;
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

  const agent = eligible[Math.floor(Math.random() * eligible.length)];
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
