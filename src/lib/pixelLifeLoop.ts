import { createConversationRuntime, updateConversationRuntime, type ActiveBubble, type ConversationRuntime } from './conversationEngine';
import { updateVisualAgents, type VisualAgentState } from './agentMovement';
import type { Lang } from '../i18n/translations';
import type { Agent } from '../types/genesis';
import type { SystemEvent } from '../types/event';
import type { Task } from '../types/task';

export interface PixelLifeInput {
  agents: Agent[];
  firedAgents: Agent[];
  tasks: Task[];
  events: SystemEvent[];
  lang: Lang;
}

export interface PixelLifeRuntime {
  lastTimestamp: number;
  visualAgents: Record<string, VisualAgentState>;
  conversation: ConversationRuntime;
}

export function createPixelLifeRuntime(): PixelLifeRuntime {
  return {
    lastTimestamp: 0,
    visualAgents: {},
    conversation: createConversationRuntime(),
  };
}

export function stepPixelLifeLoop(
  runtime: PixelLifeRuntime,
  input: PixelLifeInput,
  timestamp: number,
): {
  visualAgents: VisualAgentState[];
  bubbles: ActiveBubble[];
} {
  const dtMs = runtime.lastTimestamp > 0 ? Math.min(40, timestamp - runtime.lastTimestamp) : 16;
  runtime.lastTimestamp = timestamp;
  runtime.visualAgents = updateVisualAgents(runtime.visualAgents, {
    agents: input.agents,
    firedAgents: input.firedAgents,
    tasks: input.tasks,
    now: timestamp,
    dtMs,
  });

  const bubbles = updateConversationRuntime(runtime.conversation, input.events, input.lang, timestamp);
  const talkingAgentIds = new Set(bubbles.map((bubble) => bubble.agentId));
  for (const visual of Object.values(runtime.visualAgents)) {
    if (!talkingAgentIds.has(visual.agentId)) continue;
    if (visual.animation === 'warning' || visual.animation === 'walk' || visual.animation === 'fired' || visual.animation === 'work') continue;
    visual.animation = 'talk';
  }
  const visualAgents = Object.values(runtime.visualAgents).sort((a, b) => a.y - b.y);

  return {
    visualAgents,
    bubbles,
  };
}
