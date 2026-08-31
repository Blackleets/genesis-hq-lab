// HQView — pixel office + paper capture blotter. Public root. No wallet wall.

import { useMemo, useState } from 'react';
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
import { TRADING_AGENTS } from '@agents/data/tradingAgents';
import type { TradingAgent } from '@core/types/tradingAgent';
import TileOffice from '@office/TileOffice';
import { OFFICE_CANVAS_H, OFFICE_CANVAS_W } from '@office/officeLayout';
import { CaptureDeskPanel } from '@components/crypto/CaptureDeskPanel';

const HQ_RENDERER = 'canvas' as const;

function tradingDataForAgent(agent: Agent | null): TradingAgent | undefined {
  if (!agent) return undefined;
  if (agent.id.startsWith('trading-')) {
    const tradingId = agent.id.replace('trading-', '');
    return TRADING_AGENTS.find(a => a.id === tradingId);
  }
  switch (agent.department) {
    case 'Market Room':     return TRADING_AGENTS.find(a => a.id === 'scalping-hunter');
    case 'Risk Office':     return TRADING_AGENTS.find(a => a.id === 'risk-sentinel');
    case 'Board Room':      return TRADING_AGENTS.find(a => a.id === 'capital-manager');
    case 'Strategy Lab':    return TRADING_AGENTS.find(a => a.id === 'backtest-engineer');
    case 'Memory Archive':  return TRADING_AGENTS.find(a => a.id === 'market-analyst');
    case 'Genesis HR':      return TRADING_AGENTS.find(a => a.id === 'backtest-engineer');
    default:                return undefined;
  }
}

export default function HQView() {
  const t = useT();
  const lang = useLanguage();
  const es = lang === 'es';
  const agents = useAgents();
  const bubbles = useLiveBubbles();
  const selectedAgent = useSelectedAgent();
  const [hoveredAgent, setHoveredAgent] = useState<Agent | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [roomOpen, setRoomOpen] = useState<RoomId | null>(null);
  const initialRenderer = useMemo(() => {
    const raw = (import.meta.env.VITE_USE_LIVE_TILE_OFFICE ?? 'true').trim().toLowerCase();
    return raw === 'false' || raw === '0' || raw === 'off' ? 'legacy' : 'canvas';
  }, []);
  const tileOfficeEnabled = useMemo(() => {
    const raw = (import.meta.env.VITE_USE_LIVE_TILE_OFFICE ?? 'true').trim().toLowerCase();
    return !(raw === 'false' || raw === '0' || raw === 'off');
  }, []);
  const [rendererMode, setRendererMode] = useState<'canvas' | 'legacy'>(initialRenderer);
  const [tileOfficeFailed, setTileOfficeFailed] = useState(false);
  const tileOfficeActive = tileOfficeEnabled && !tileOfficeFailed;

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
      <main className="flex-1 min-w-0 min-h-0 relative flex flex-col bg-[#05070a]">
        <div className="bg-[#07090d] border-b border-[#1c2430] px-3 py-1 flex flex-wrap items-center gap-1.5 overflow-hidden">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500 shrink-0 mr-1">
            {t('work.title')}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-amber-500/40 text-amber-300">PAPER</span>
          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-zinc-700 text-zinc-500">LIVE_OFF</span>
          <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border border-red-500/30 text-red-400">GO NO</span>
          <span className="font-mono text-[9px] text-zinc-600 hidden sm:inline">
            {es ? '10k paper · Kalman fair · sin fills inventados' : '10k paper · Kalman fair · no invented fills'}
          </span>
          <span className="w-px h-3 bg-[#1c2430] mx-1 hidden sm:block" />
          {(Object.keys(OFFICE_ROOMS) as RoomId[]).map((rid) => (
            <button
              key={rid}
              type="button"
              onClick={() => setRoomOpen(rid)}
              className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] px-2 py-1 border text-zinc-300 hover:bg-white/5"
              style={{ borderColor: `${OFFICE_ROOMS[rid].color}55` }}
            >
              {OFFICE_ROOMS[rid].label[lang]}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-1 min-h-0 relative">
          {tileOfficeActive ? (
            <PixelOfficeViewport internalWidth={OFFICE_CANVAS_W} internalHeight={OFFICE_CANVAS_H}>
              {() => (
                <TileOffice
                  onAssetError={(error) => {
                    console.warn('[TileOffice] falling back to legacy office:', error.message);
                    setTileOfficeFailed(true);
                  }}
                  onRoomClick={(room) => setRoomOpen(room)}
                />
              )}
            </PixelOfficeViewport>
          ) : rendererMode === 'canvas' && HQ_RENDERER === 'canvas' ? (
            <PixelOfficeViewport internalWidth={PIXEL_CANVAS_WIDTH} internalHeight={PIXEL_CANVAS_HEIGHT}>
              {(scale) => (
                <PixelOfficeCanvas
                  scale={scale}
                  onAgentHover={(agent, screenX, screenY) => {
                    setHoveredAgent(agent);
                    setHoverPos({ x: screenX, y: screenY });
                  }}
                  onRoomClick={(room) => setRoomOpen(room)}
                  onRendererDegraded={() => setRendererMode('legacy')}
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
            <AgentTooltip
              agent={hoveredAgent}
              x={hoverPos.x}
              y={hoverPos.y}
              tradingData={tradingDataForAgent(hoveredAgent)}
            />
          )}
          <AgentInspector
            agent={selectedAgent}
            onClose={() => actions.setSelectedAgent(null)}
            onAction={() => { /* visual-only */ }}
            tradingData={tradingDataForAgent(selectedAgent)}
          />
          </div>
          <div className="shrink-0 max-h-[42%] overflow-y-auto border-t border-[#1c2430]">
            <CaptureDeskPanel es={es} />
          </div>
        </div>
      </main>
      <AgentActivityFeed />
    </>
  );
}
