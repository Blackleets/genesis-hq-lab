// HQView — the pixel office viewport: agents at work, bubbles, room drill-in.

import { useState } from 'react';
import { useT, useLanguage } from '@core/i18n/languageStore';
import { actions, useAgents, useSelectedAgent } from '@core/store/genesisStore';
import { useLiveBubbles } from '@activity/liveBubbles';
import type { Agent } from '@core/types/genesis';
import type { RoomId } from '@core/types/office';
import WorkScreen from '@workflows/WorkScreen';
import AgentActivityFeed from '@activity/AgentActivityFeed';
import { OFFICE_ROOMS } from '@animations/officeRooms';
import { PIXEL_CANVAS_HEIGHT, PIXEL_CANVAS_WIDTH } from '@animations/pixelOfficeMap';
import PixelOfficeCanvas from '@animations/PixelOfficeCanvas';
import PixelOfficeViewport from '@animations/PixelOfficeViewport';
import OfficeViewport from '@animations/OfficeViewport';
import GenesisOfficeWorld from '@animations/GenesisOfficeWorld';
import AgentTooltip from '@agents/AgentTooltip';
import AgentInspector from '@agents/AgentInspector';

const HQ_RENDERER = 'canvas' as const;

export default function HQView() {
  const t = useT();
  const lang = useLanguage();
  const agents = useAgents();
  const bubbles = useLiveBubbles();
  const selectedAgent = useSelectedAgent();
  const [hoveredAgent, setHoveredAgent] = useState<Agent | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [roomOpen, setRoomOpen] = useState<RoomId | null>(null);

  const firstSpeaker = Object.values(bubbles)[0];
  const speakingAgentId = firstSpeaker?.agentId ?? null;
  const speakingText = firstSpeaker?.text[lang] ?? null;

  if (roomOpen) {
    return (
      <>
        <WorkScreen room={roomOpen} onClose={() => setRoomOpen(null)} />
        <AgentActivityFeed />
      </>
    );
  }

  return (
    <>
      <main className="flex-1 min-w-0 min-h-0 relative flex flex-col">
        <div className="bg-carbon-200 border-b border-trim px-3 py-1.5 flex flex-wrap items-center gap-1.5 overflow-hidden">
          <span className="gx-label shrink-0 mr-1">
            {t('work.title')}:
          </span>
          {(Object.keys(OFFICE_ROOMS) as RoomId[]).map((rid) => (
            <button
              key={rid}
              type="button"
              onClick={() => setRoomOpen(rid)}
              className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] px-2 py-1 border border-trim text-zinc-300 hover:bg-white/5"
              style={{ borderColor: `${OFFICE_ROOMS[rid].color}55` }}
            >
              {OFFICE_ROOMS[rid].label[lang]}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 relative bg-carbon-300">
          {HQ_RENDERER === 'canvas' ? (
            <PixelOfficeViewport internalWidth={PIXEL_CANVAS_WIDTH} internalHeight={PIXEL_CANVAS_HEIGHT}>
              {(scale) => (
                <PixelOfficeCanvas
                  scale={scale}
                  onAgentHover={(agent, screenX, screenY) => {
                    setHoveredAgent(agent);
                    setHoverPos({ x: screenX, y: screenY });
                  }}
                  onRoomClick={(room) => setRoomOpen(room)}
                />
              )}
            </PixelOfficeViewport>
          ) : (
            <OfficeViewport
              onMouseMoveWorld={(_wx, _wy, screenX, screenY) => setHoverPos({ x: screenX, y: screenY })}
              onMouseLeave={() => setHoveredAgent(null)}
            >
              <GenesisOfficeWorld
                agents={agents}
                speakingAgentId={speakingAgentId}
                speakingText={speakingText}
                highlightedAgentId={hoveredAgent?.id ?? selectedAgent?.id ?? null}
                onAgentClick={(a) => actions.setSelectedAgent(selectedAgent?.id === a.id ? null : a.id)}
                onAgentHover={(agent) => setHoveredAgent(agent)}
              />
            </OfficeViewport>
          )}
          {hoveredAgent && !selectedAgent && (
            <AgentTooltip agent={hoveredAgent} x={hoverPos.x} y={hoverPos.y} />
          )}
          <AgentInspector
            agent={selectedAgent}
            onClose={() => actions.setSelectedAgent(null)}
            onAction={() => { /* visual-only */ }}
          />
        </div>
      </main>
      <AgentActivityFeed />
    </>
  );
}
