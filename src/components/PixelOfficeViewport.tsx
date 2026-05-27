import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useContainerSize } from '../lib/fitToViewport';

interface Props {
  internalWidth: number;
  internalHeight: number;
  children: (scale: number) => ReactNode;
}

export default function PixelOfficeViewport({ internalWidth, internalHeight, children }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const container = useContainerSize(wrapRef);

  const scale =
    container.width > 0 && container.height > 0
      ? Math.max(1, Math.floor(Math.min(container.width / internalWidth, container.height / internalHeight)))
      : 1;

  const renderedWidth = internalWidth * scale;
  const renderedHeight = internalHeight * scale;
  const offsetX = Math.max(0, Math.floor((container.width - renderedWidth) / 2));
  const offsetY = Math.max(0, Math.floor((container.height - renderedHeight) / 2));

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-carbon-300">
      <div
        className="absolute"
        style={{
          left: `${offsetX}px`,
          top: `${offsetY}px`,
          width: `${renderedWidth}px`,
          height: `${renderedHeight}px`,
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
