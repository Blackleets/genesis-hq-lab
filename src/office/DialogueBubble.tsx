// DialogueBubble — pixel-art speech bubble overlaid on the office canvas.
// Positioned in internal canvas pixels; the viewport transform scales it
// together with the canvas. Fades in on mount and out before expiry.

import { useEffect, useState } from 'react';

interface Props {
  text: string;
  /** anchor point in canvas px: horizontal center, top of the agent's head */
  x: number;
  y: number;
  accent: string;
  fading: boolean;
}

export default function DialogueBubble({ text, x, y, accent, fading }: Props) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const id = window.requestAnimationFrame(() => setMounted(true));
    return () => window.cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: 'translate(-50%, -100%)',
        opacity: mounted && !fading ? 1 : 0,
        transition: 'opacity 380ms ease',
        zIndex: 20,
      }}
    >
      <div
        className="font-mono text-[8px] leading-[10px] text-zinc-100 px-1.5 py-1"
        style={{
          maxWidth: '120px',
          whiteSpace: 'normal',
          backgroundColor: 'rgba(12, 12, 24, 0.86)',
          border: `1px solid ${accent}55`,
          boxShadow: `0 0 0 1px rgba(0, 0, 0, 0.55)`,
        }}
      >
        {text}
      </div>
      {/* pixel tail */}
      <div
        className="mx-auto"
        style={{
          width: 0,
          height: 0,
          borderLeft: '3px solid transparent',
          borderRight: '3px solid transparent',
          borderTop: '4px solid rgba(12, 12, 24, 0.86)',
        }}
      />
    </div>
  );
}
