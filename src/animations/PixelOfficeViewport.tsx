import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useContainerSize } from '@animations/fitToViewport';

interface Props {
  internalWidth: number;
  internalHeight: number;
  children: (scale: number) => ReactNode;
}

export default function PixelOfficeViewport({ internalWidth, internalHeight, children }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const container = useContainerSize(wrapRef);
  const [zoomLevel, setZoomLevel] = useState(1.0);

  const baseScale =
    container.width > 0 && container.height > 0
      ? Math.max(1, Math.min(container.width / internalWidth, container.height / internalHeight))
      : 1;

  const scale = baseScale * zoomLevel;

  const renderedWidth = internalWidth * scale;
  const renderedHeight = internalHeight * scale;
  const offsetX = Math.max(0, Math.floor((container.width - renderedWidth) / 2));
  const offsetY = Math.max(0, Math.floor((container.height - renderedHeight) / 2));

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-carbon-300">
      {/* Zoom controls */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 1.0))}
          disabled={zoomLevel <= 1.0}
          className="font-mono text-[10px] bg-black/60 border border-zinc-700 text-zinc-400 px-1.5 py-0.5 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          −
        </button>
        <span className="font-mono text-[10px] bg-black/60 border border-zinc-700 text-zinc-500 px-1.5 py-0.5 min-w-[3rem] text-center">
          {(zoomLevel * 100).toFixed(0)}%
        </span>
        <button
          type="button"
          onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 2.0))}
          disabled={zoomLevel >= 2.0}
          className="font-mono text-[10px] bg-black/60 border border-zinc-700 text-zinc-400 px-1.5 py-0.5 hover:text-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          +
        </button>
      </div>

      <div
        className="absolute overflow-auto"
        style={{
          left: offsetX > 0 ? `${offsetX}px` : 0,
          top: offsetY > 0 ? `${offsetY}px` : 0,
          width: renderedWidth > container.width ? `${container.width}px` : `${renderedWidth}px`,
          height: renderedHeight > container.height ? `${container.height}px` : `${renderedHeight}px`,
        }}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            width: `${internalWidth}px`,
            height: `${internalHeight}px`,
            imageRendering: 'pixelated',
          }}
        >
          {children(scale)}
        </div>
      </div>
    </div>
  );
}
