import { useRef } from 'react';
import type { ReactNode } from 'react';
import { fitScale, useContainerSize, WORLD_HEIGHT, WORLD_WIDTH } from '@animations/fitToViewport';

interface Props {
  children: ReactNode;
  onMouseMoveWorld?: (worldX: number, worldY: number, screenX: number, screenY: number) => void;
  onMouseLeave?: () => void;
}

export default function OfficeViewport({ children, onMouseMoveWorld, onMouseLeave }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const container = useContainerSize(wrapRef);

  const scale = fitScale(container);
  const renderedWidth = WORLD_WIDTH * scale;
  const renderedHeight = WORLD_HEIGHT * scale;
  const offsetX = Math.max(0, (container.width - renderedWidth) / 2);
  const offsetY = Math.max(8, Math.min(28, (container.height - renderedHeight) / 2));

  function handleMouseMove(event: React.MouseEvent<SVGSVGElement>) {
    if (!onMouseMoveWorld || !svgRef.current || scale <= 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const worldX = (event.clientX - rect.left) / scale;
    const worldY = (event.clientY - rect.top) / scale;
    onMouseMoveWorld(worldX, worldY, event.clientX, event.clientY);
  }

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-carbon-300">
      <div
        className="absolute"
        style={{
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT,
          transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`}
          width={WORLD_WIDTH}
          height={WORLD_HEIGHT}
          className="block select-none"
          style={{ imageRendering: 'pixelated', shapeRendering: 'crispEdges' }}
          onMouseMove={handleMouseMove}
          onMouseLeave={onMouseLeave}
        >
          {children}
        </svg>
      </div>
    </div>
  );
}
