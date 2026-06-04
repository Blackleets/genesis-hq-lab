import { createConversationRuntime, updateConversationRuntime, type ActiveBubble, type ConversationRuntime, type LiveTradeLite } from '@activity/conversationEngine';
import { updateVisualAgents, type VisualAgentState } from '@animations/agentMovement';
import type { Lang } from '@core/i18n/translations';
import type { Agent } from '@core/types/genesis';
import type { SystemEvent } from '@core/types/event';
import type { Task } from '@core/types/task';

export interface PixelLifeInput {
  agents: Agent[];
  firedAgents: Agent[];
  tasks: Task[];
  events: SystemEvent[];
  lang: Lang;
  liveTrades?: LiveTradeLite[];
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

  const presentAgentIds = input.agents
    .filter((a) => a.status !== 'fired')
    .map((a) => a.id);
  const bubbles = updateConversationRuntime(runtime.conversation, input.events, input.lang, timestamp, {
    presentAgentIds,
    liveTrades: input.liveTrades,
  });
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
