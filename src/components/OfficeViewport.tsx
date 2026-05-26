// OfficeViewport — wraps GenesisOfficeWorld in a single <svg> sized to the
// available container. preserveAspectRatio="xMidYMid meet" auto-fits the
// 1600×900 world into whatever space the parent grants, with no internal
// scroll. image-rendering="pixelated" keeps pixel art crisp at any scale.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../lib/fitToViewport';

interface Props {
  children: ReactNode;
  /** Called with mouse coords (in world units) when the user moves over the SVG. */
  onMouseMoveWorld?: (worldX: number, worldY: number, screenX: number, screenY: number) => void;
  onMouseLeave?: () => void;
}

export default function OfficeViewport({ children, onMouseMoveWorld, onMouseLeave }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [renderTick, setRenderTick] = useState(0);

  // Trigger one re-render after mount so refs are populated for child usage if needed.
  useEffect(() => {
    setRenderTick(1);
  }, []);

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!onMouseMoveWorld || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    // Map screen → world using viewBox + actual SVG box
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // The SVG fits 1600×900 inside rect via meet; compute the actual fit scale.
    const scale = Math.min(rect.width / WORLD_WIDTH, rect.height / WORLD_HEIGHT);
    const renderedW = WORLD_WIDTH * scale;
    const renderedH = WORLD_HEIGHT * scale;
    const offsetX = (rect.width - renderedW) / 2;
    const offsetY = (rect.height - renderedH) / 2;
    const worldX = (sx - offsetX) / scale;
    const worldY = (sy - offsetY) / scale;
    onMouseMoveWorld(worldX, worldY, e.clientX, e.clientY);
  }

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full overflow-hidden bg-carbon-300"
      data-render-tick={renderTick}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full block select-none"
        style={{ imageRendering: 'pixelated' }}
        shapeRendering="crispEdges"
        onMouseMove={handleMouseMove}
        onMouseLeave={onMouseLeave}
      >
        {children}
      </svg>
    </div>
  );
}
