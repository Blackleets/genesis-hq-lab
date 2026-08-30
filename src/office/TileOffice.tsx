// TileOffice — React wrapper for the live tile office canvas.
// Phase 1: static tiles. Phase 2: live agents on a RAF loop.
// Phase 3: honest dialogue bubbles overlaid in canvas pixel space.
// Degrades gracefully: tilesheet failure reports up via onAssetError
// (HQView falls back to the legacy office); an agent-loop failure falls
// back to the static scene; a dialogue failure just mutes the bubbles.

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { OFFICE_CANVAS_H, OFFICE_CANVAS_W, OFFICE_CHARACTERS } from './officeLayout';
import {
  drawOfficeBase,
  drawTileOffice,
  loadOfficeTilesheet,
  renderOfficeFrame,
} from './TileOfficeRenderer';
import { AGENT_DEFINITIONS, createLiveOfficeAgents } from './officeAgents';
import { stepOfficeAgents } from './officeAgentMovement';
import { applyLiveOfficeEvents, createLiveEventsRuntime } from './officeLiveEvents';
import { createDialogueRuntime, stepDialogue } from './agentDialogue';
import DialogueBubble from './DialogueBubble';
import OfficeStatusBar from './OfficeStatusBar';
import { useLiveOfficeState } from '@hooks/useLiveOfficeState';
import { OFFICE_ZONES, type OfficeZoneId } from './officeZones';
import type { RoomId } from '@core/types/office';

interface Props {
  onAssetError: (error: Error) => void;
  onRoomClick?: (room: RoomId) => void;
}

/** Desk tints on the tile floor → HQ rooms that already exist. */
const ZONE_TO_ROOM: Record<OfficeZoneId, RoomId> = {
  researchDesk: 'strategy-lab',
  analyticsScreen: 'memory-archive',
  executionDesk: 'execution-desk',
  riskDesk: 'risk-bunker',
  portfolioDesk: 'board-room',
  serverRack: 'memory-archive',
  restArea: 'open-workspace',
  centralFloor: 'open-workspace',
};

function hitZone(x: number, y: number): OfficeZoneId | null {
  for (const z of Object.values(OFFICE_ZONES)) {
    const r = z.tint ?? z.area;
    if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return z.id;
  }
  return null;
}

interface BubbleView {
  key: number;
  text: string;
  x: number;
  y: number;
  accent: string;
  fading: boolean;
}

const BUBBLE_SYNC_MS = 100;
const FADE_OUT_MS = 420;

export default function TileOffice({ onAssetError, onRoomClick }: Props) {
  const lang = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);
  const [bubbleViews, setBubbleViews] = useState<BubbleView[]>([]);
  const officeState = useLiveOfficeState();
  // ref mirror so the RAF loop reads fresh data without re-running the effect
  const officeStateRef = useRef(officeState);
  useEffect(() => {
    officeStateRef.current = officeState;
  }, [officeState]);

  useEffect(() => {
    let active = true;
    loadOfficeTilesheet()
      .then((img) => {
        if (active) setSheet(img);
      })
      .catch((error: Error) => {
        if (active) onAssetError(error);
      });
    return () => {
      active = false;
    };
    // onAssetError is a stable fallback setter in HQView; load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sheet) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onAssetError(new Error('2d context unavailable'));
      return;
    }

    // prerender the immutable layers once
    const base = document.createElement('canvas');
    base.width = OFFICE_CANVAS_W;
    base.height = OFFICE_CANVAS_H;
    const baseCtx = base.getContext('2d');
    if (!baseCtx) {
      drawTileOffice(ctx, sheet);
      return;
    }
    drawOfficeBase(baseCtx, sheet);

    const agents = createLiveOfficeAgents(performance.now());
    const accentById = new Map(AGENT_DEFINITIONS.map((d) => [d.id, d.accent]));
    const dialogue = createDialogueRuntime(performance.now());
    const liveEvents = createLiveEventsRuntime();
    let dialogueAlive = true;
    let frameId = 0;
    let lastTs = 0;
    let lastBubbleSync = 0;
    let lastBubbleSignature = '';

    const tick = (ts: number) => {
      const dt = lastTs === 0 ? 16 : ts - lastTs;
      lastTs = ts;
      try {
        stepOfficeAgents(agents, ts, dt);
        applyLiveOfficeEvents(agents, officeStateRef.current, liveEvents, ts);
        renderOfficeFrame(ctx, base, sheet, agents, ts, officeStateRef.current.engineStatus);
      } catch (error) {
        // agent loop broke — degrade to the static Phase 1 scene
        console.warn('[TileOffice] agent loop failed, rendering static office:', error);
        drawTileOffice(ctx, sheet);
        setBubbleViews([]);
        return;
      }

      if (dialogueAlive) {
        try {
          const bubbles = stepDialogue(dialogue, agents, officeStateRef.current, ts);
          if (ts - lastBubbleSync >= BUBBLE_SYNC_MS) {
            lastBubbleSync = ts;
            const views: BubbleView[] = [];
            for (const b of bubbles) {
              const agent = agents.find((a) => a.def.id === b.agentId);
              if (!agent) continue;
              const charH = OFFICE_CHARACTERS[agent.def.spriteIndex].h;
              views.push({
                key: b.id,
                text: b.text[lang],
                x: Math.round(agent.x),
                y: Math.round(agent.y) - charH - 10,
                accent: accentById.get(b.agentId) ?? '#00ff9c',
                fading: b.expiresAt - ts < FADE_OUT_MS,
              });
            }
            const signature = views.map((v) => `${v.key}:${v.x}:${v.y}:${v.fading}`).join('|');
            if (signature !== lastBubbleSignature) {
              lastBubbleSignature = signature;
              setBubbleViews(views);
            }
          }
        } catch (error) {
          // dialogue broke — mute bubbles, keep the office alive
          console.warn('[TileOffice] dialogue failed, muting bubbles:', error);
          dialogueAlive = false;
          setBubbleViews([]);
        }
      }

      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, lang]);

  return (
    <div className="relative" style={{ width: `${OFFICE_CANVAS_W}px`, height: `${OFFICE_CANVAS_H}px` }}>
      <canvas
        ref={canvasRef}
        width={OFFICE_CANVAS_W}
        height={OFFICE_CANVAS_H}
        className="block absolute inset-0"
        style={{ imageRendering: 'pixelated', cursor: onRoomClick ? 'pointer' : 'default' }}
        onClick={(e) => {
          if (!onRoomClick) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const x = (e.clientX - rect.left) * (OFFICE_CANVAS_W / rect.width);
          const y = (e.clientY - rect.top) * (OFFICE_CANVAS_H / rect.height);
          const z = hitZone(x, y);
          if (z) onRoomClick(ZONE_TO_ROOM[z]);
        }}
      />
      {bubbleViews.map((b) => (
        <DialogueBubble key={b.key} text={b.text} x={b.x} y={b.y} accent={b.accent} fading={b.fading} />
      ))}
      {sheet && <OfficeStatusBar state={officeState} agentCount={AGENT_DEFINITIONS.length} />}
      {!sheet && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          loading office assets…
        </div>
      )}
    </div>
  );
}
