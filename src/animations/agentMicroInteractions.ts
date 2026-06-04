// Backwards-compat re-export. The conversation cycle has been replaced
// by event-driven bubbles. Anything that still imports useConversationCycle
// gets a thin adapter that returns the first active live bubble (if any).

import { useLiveBubbles } from '@activity/liveBubbles';

export interface ActiveBubble {
  agentId: string;
  text: { es: string; en: string };
}

export function useConversationCycle(): ActiveBubble | null {
  const map = useLiveBubbles();
  const first = Object.values(map)[0];
  return first ? { agentId: first.agentId, text: first.text } : null;
}

export { useLiveBubbles };
