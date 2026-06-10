// TileOffice — React wrapper for the live tile office canvas.
// Phase 1: static tiles. Phase 2: live agents stepped on a RAF loop.
// Degrades gracefully: tilesheet failure reports up via onAssetError
// (HQView falls back to the legacy office); an agent-loop failure falls
// back to the static Phase 1 scene.

import { useEffect, useRef, useState } from 'react';
import { OFFICE_CANVAS_H, OFFICE_CANVAS_W } from './officeLayout';
import {
  drawOfficeBase,
  drawTileOffice,
  loadOfficeTilesheet,
  renderOfficeFrame,
} from './TileOfficeRenderer';
import { createLiveOfficeAgents } from './officeAgents';
import { stepOfficeAgents } from './officeAgentMovement';

interface Props {
  onAssetError: (error: Error) => void;
}

export default function TileOffice({ onAssetError }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sheet, setSheet] = useState<HTMLImageElement | null>(null);

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
    let frameId = 0;
    let lastTs = 0;

    const tick = (ts: number) => {
      const dt = lastTs === 0 ? 16 : ts - lastTs;
      lastTs = ts;
      try {
        stepOfficeAgents(agents, ts, dt);
        renderOfficeFrame(ctx, base, sheet, agents, ts);
      } catch (error) {
        // agent loop broke — degrade to the static Phase 1 scene
        console.warn('[TileOffice] agent loop failed, rendering static office:', error);
        drawTileOffice(ctx, sheet);
        return;
      }
      frameId = window.requestAnimationFrame(tick);
    };
    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet]);

  return (
    <div className="relative" style={{ width: `${OFFICE_CANVAS_W}px`, height: `${OFFICE_CANVAS_H}px` }}>
      <canvas
        ref={canvasRef}
        width={OFFICE_CANVAS_W}
        height={OFFICE_CANVAS_H}
        className="block absolute inset-0"
        style={{ imageRendering: 'pixelated' }}
      />
      {!sheet && (
        <div className="absolute inset-0 flex items-center justify-center font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
          loading office assets…
        </div>
      )}
    </div>
  );
}
