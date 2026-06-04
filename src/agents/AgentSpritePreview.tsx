// AgentSpritePreview — renders an agent's OWN creature sprite, refined by its
// real evolution tier, in a small animated canvas. Reuses the exact same
// drawing path as the office world (drawCreature) so the preview is always a
// faithful, 1:1 reflection of how the agent looks in-world — just larger.

import { useEffect, useRef } from 'react';
import { drawCreature } from '@animations/seaCreatures';
import { agentEvolution } from '@animations/agentEvolution';
import { creatureForAgent } from '@animations/pixelCanvasRenderer';
import type { Agent } from '@core/types/genesis';

interface Props {
  agent: Agent;
  /** CSS width in px; height is derived (×1.1). Default 92. */
  size?: number;
}

export default function AgentSpritePreview({ agent, size = 92 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  // Keep the latest agent visible to the animation loop without restarting it.
  const agentRef = useRef(agent);
  agentRef.current = agent;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssH = Math.round(size * 1.1);
    canvas.width = size * dpr;
    canvas.height = cssH * dpr;
    const PS = 2.6 * dpr; // crisp nearest-neighbour upscale for a large preview

    let raf = 0;
    const loop = () => {
      const a = agentRef.current;
      const ev = agentEvolution(a);
      const accent = a.visualProfile?.accent ?? '#3da9fc';

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.scale(PS, PS);

      const cw = canvas.width / PS;
      const ch = canvas.height / PS;
      const cx = cw / 2;
      const cy = ch - 6; // plant the feet near the bottom

      const now = performance.now();
      const frame = (Math.floor(now / 600) % 2) as 0 | 1;
      const blink = (now % 3400) < 150;

      drawCreature(ctx, creatureForAgent(a), cx, cy, {
        frame,
        facingLeft: false,
        glow: null,
        blink,
        active: false,
        nowMs: now,
        animation: 'idle',
        evolution: { sprite: ev.tier.sprite, accent },
      });

      ctx.restore();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <canvas
      ref={ref}
      style={{ width: size, height: Math.round(size * 1.1), imageRendering: 'pixelated' }}
      aria-hidden
    />
  );
}
