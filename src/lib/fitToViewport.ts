// Hook + helper for fit-to-viewport scaling.
// We use SVG preserveAspectRatio="xMidYMid meet" for the world itself, so
// the SVG fits automatically inside its container. This hook exposes the
// computed visible width/height of the container if anything (HTML
// overlays like the bubble layer) needs to align with it.

import { useEffect, useState } from 'react';

export const WORLD_WIDTH = 1600;
export const WORLD_HEIGHT = 900;

export interface ContainerSize {
  width: number;
  height: number;
}

/** Tracks the size of a container ref. */
export function useContainerSize(ref: React.RefObject<HTMLElement | null>): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}

/** Compute the scale that fits the WORLD inside `container` preserving aspect ratio. */
export function fitScale(container: ContainerSize): number {
  if (container.width <= 0 || container.height <= 0) return 1;
  return Math.min(container.width / WORLD_WIDTH, container.height / WORLD_HEIGHT);
}
