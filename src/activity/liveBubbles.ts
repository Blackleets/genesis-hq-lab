// Reads recent voiced events from the store and returns a per-agent
// bubble that is alive on screen for ~6 seconds after the event fires.
// Replaces the old scripted useConversationCycle — bubbles are now an
// effect of real events.

import { useMemo, useEffect, useState } from 'react';
import { useEvents } from '@core/store/genesisStore';

const BUBBLE_TTL_MS = 6000;

export interface ActiveBubble {
  agentId: string;
  text: { es: string; en: string };
  /** ms remaining; useful for fade animations */
  remaining: number;
}

export function useLiveBubbles(): Record<string, ActiveBubble> {
  const events = useEvents();
  const [now, setNow] = useState(() => Date.now());

  // Tick once per second to keep TTL fresh.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  return useMemo(() => {
    const map: Record<string, ActiveBubble> = {};
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (!e.voicedBy || !e.voicedText) continue;
      const age = now - Date.parse(e.at);
      if (age > BUBBLE_TTL_MS) continue;
      // First (most recent) voiced event per agent wins
      if (map[e.voicedBy]) continue;
      map[e.voicedBy] = {
        agentId: e.voicedBy,
        text: e.voicedText,
        remaining: BUBBLE_TTL_MS - age,
      };
    }
    return map;
  }, [events, now]);
}
