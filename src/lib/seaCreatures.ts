// seaCreatures — procedural pixel-art sea creatures drawn directly on the canvas.
// Replaces the human agent sprites with themed creatures:
//   whale = CEO, shark = trader, pufferfish = risk, octopus = memory,
//   crab = HR, squid = research/worker, fish = generic worker.
// No image assets — everything is fillRect pixel work, so it scales crisply and
// tints by agent state for free.

export type CreatureKind = 'whale' | 'shark' | 'pufferfish' | 'octopus' | 'crab' | 'squid' | 'fish';

export interface CreatureOpts {
  frame: 0 | 1;          // animation frame (fin/tentacle wiggle)
  facingLeft: boolean;   // flip horizontally when swimming left
  glow: string | null;   // soft ring color for active states (work/talk/warning)
  alpha?: number;        // fired agents render faint
}

// Palette per creature: [body, shade, belly/light, accent]
const PALETTE: Record<CreatureKind, [string, string, string, string]> = {
  whale:      ['#3b6ea5', '#2b527c', '#cfe3f5', '#1d3a5c'],
  shark:      ['#7c8a99', '#5a6776', '#e8edf2', '#3a4450'],
  pufferfish: ['#e8a13c', '#c47e22', '#ffe0a3', '#7a4d10'],
  octopus:    ['#9c5cff', '#7a3fd6', '#e6d4ff', '#4a2585'],
  crab:       ['#e0533a', '#b83a24', '#ffd0c4', '#7a2414'],
  squid:      ['#26c2b3', '#179187', '#c7f5ef', '#0c5a53'],
  fish:       ['#4d9be0', '#2f74b5', '#d4ecff', '#1d4d7c'],
};

// Tiny pixel helper: draws a block on an integer grid.
function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/**
 * Draw a creature anchored at (cx, cy) = bottom-center floor point.
 * Creatures are ~26px wide. Facing right by default; caller-independent flip.
 */
export function drawCreature(
  ctx: CanvasRenderingContext2D,
  kind: CreatureKind,
  cx: number,
  cy: number,
  opts: CreatureOpts,
) {
  const [body, shade, light, accent] = PALETTE[kind];
  const f = opts.frame;

  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;

  // Soft state glow behind the creature
  if (opts.glow) {
    ctx.save();
    ctx.globalAlpha = (opts.alpha ?? 1) * 0.22;
    ctx.fillStyle = opts.glow;
    ctx.beginPath();
    ctx.arc(cx, cy - 11, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Flip around the anchor for left-facing swim
  if (opts.facingLeft) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  switch (kind) {
    case 'whale':      drawWhale(ctx, cx, cy, body, shade, light, accent, f); break;
    case 'shark':      drawShark(ctx, cx, cy, body, shade, light, accent, f); break;
    case 'pufferfish': drawPuffer(ctx, cx, cy, body, shade, light, accent, f); break;
    case 'octopus':    drawOctopus(ctx, cx, cy, body, shade, light, accent, f); break;
    case 'crab':       drawCrab(ctx, cx, cy, body, shade, light, accent, f); break;
    case 'squid':      drawSquid(ctx, cx, cy, body, shade, light, accent, f); break;
    default:           drawFish(ctx, cx, cy, body, shade, light, accent, f); break;
  }

  ctx.restore();
}

// ── eye helper (white + dark pupil) ─────────────────────────────────────────
function eye(ctx: CanvasRenderingContext2D, x: number, y: number) {
  px(ctx, x, y, 4, 4, '#ffffff');
  px(ctx, x + 2, y + 1, 2, 2, '#10131a');
}

// ── WHALE (CEO) — biggest, rounded, spout + fluke ───────────────────────────
function drawWhale(ctx: CanvasRenderingContext2D, cx: number, cy: number, body: string, shade: string, light: string, accent: string, f: number) {
  const x = cx - 15, y = cy - 22;
  // spout
  px(ctx, x + 9, y - 3 + (f ? -1 : 0), 2, 4, '#cfe3f5');
  px(ctx, x + 7, y - 5 + (f ? -1 : 0), 2, 2, '#cfe3f5');
  px(ctx, x + 11, y - 5 + (f ? -1 : 0), 2, 2, '#cfe3f5');
  // body (rounded blob)
  px(ctx, x + 4, y + 2, 22, 14, body);
  px(ctx, x + 2, y + 5, 26, 8, body);
  px(ctx, x + 6, y, 18, 4, body);
  // top shading
  px(ctx, x + 6, y, 18, 2, shade);
  // belly
  px(ctx, x + 5, y + 13, 20, 4, light);
  // tail fluke (wiggles)
  px(ctx, x - 2, y + 4 + (f ? 1 : -1), 6, 3, body);
  px(ctx, x - 4, y + 2 + (f ? 1 : -1), 4, 2, shade);
  px(ctx, x - 4, y + 9 + (f ? -1 : 1), 4, 2, shade);
  // side fin
  px(ctx, x + 14, y + 14, 5, 3, shade);
  // eye + smile
  eye(ctx, x + 20, y + 5);
  px(ctx, x + 21, y + 11, 4, 1, accent);
}

// ── SHARK (trader) — sleek torpedo, dorsal fin, gills ───────────────────────
function drawShark(ctx: CanvasRenderingContext2D, cx: number, cy: number, body: string, shade: string, light: string, accent: string, f: number) {
  const x = cx - 15, y = cy - 18;
  // dorsal fin
  px(ctx, x + 11, y - 4, 5, 5, shade);
  px(ctx, x + 13, y - 6, 3, 2, shade);
  // body
  px(ctx, x + 4, y + 2, 20, 9, body);
  px(ctx, x + 7, y, 14, 3, body);
  px(ctx, x + 6, y + 9, 16, 3, body);
  // snout
  px(ctx, x + 22, y + 4, 4, 5, body);
  // belly
  px(ctx, x + 6, y + 9, 16, 2, light);
  // tail (wiggle)
  px(ctx, x - 1, y + 1 + (f ? 1 : 0), 5, 4, body);
  px(ctx, x - 3, y - 1 + (f ? 1 : 0), 4, 3, shade);
  px(ctx, x - 3, y + 7 + (f ? -1 : 0), 4, 4, shade);
  // pectoral fin
  px(ctx, x + 10, y + 10, 5, 3, shade);
  // gills
  px(ctx, x + 18, y + 3, 1, 5, accent);
  px(ctx, x + 20, y + 3, 1, 5, accent);
  // eye + mouth
  eye(ctx, x + 21, y + 3);
  px(ctx, x + 20, y + 9, 5, 1, accent);
}

// ── PUFFERFISH (risk) — round, spiky, defensive ─────────────────────────────
function drawPuffer(ctx: CanvasRenderingContext2D, cx: number, cy: number, body: string, shade: string, light: string, accent: string, f: number) {
  const x = cx - 12, y = cy - 20;
  const s = f ? 1 : 0; // spikes pulse out
  // spikes (8 directions)
  const spikes = [[11, -2 - s, 2, 3], [11, 15 + s, 2, 3], [-2 - s, 8, 3, 2], [22 + s, 8, 3, 2],
                  [2 - s, 1 - s, 2, 2], [18 + s, 1 - s, 2, 2], [2 - s, 14 + s, 2, 2], [18 + s, 14 + s, 2, 2]];
  for (const [sx, sy, sw, sh] of spikes) px(ctx, x + sx, y + sy, sw, sh, shade);
  // round body
  px(ctx, x + 4, y + 2, 16, 14, body);
  px(ctx, x + 2, y + 5, 20, 8, body);
  px(ctx, x + 6, y, 12, 3, body);
  px(ctx, x + 6, y + 15, 12, 3, body);
  // top shade + belly
  px(ctx, x + 6, y, 12, 2, shade);
  px(ctx, x + 5, y + 13, 14, 3, light);
  // little fins
  px(ctx, x + 1, y + 8, 3, 3, shade);
  px(ctx, x + 19, y + 8, 3, 3, shade);
  // two worried eyes + small mouth
  eye(ctx, x + 7, y + 5);
  eye(ctx, x + 13, y + 5);
  px(ctx, x + 10, y + 11, 3, 2, accent);
}

// ── OCTOPUS (memory) — domed mantle, curling tentacles ──────────────────────
function drawOctopus(ctx: CanvasRenderingContext2D, cx: number, cy: number, body: string, shade: string, light: string, _accent: string, f: number) {
  const x = cx - 12, y = cy - 20;
  // head/mantle dome
  px(ctx, x + 4, y + 2, 16, 10, body);
  px(ctx, x + 2, y + 5, 20, 6, body);
  px(ctx, x + 7, y, 10, 3, body);
  px(ctx, x + 7, y, 10, 2, shade);
  // mantle highlight
  px(ctx, x + 8, y + 3, 4, 2, light);
  // tentacles (4 visible, alternate curl by frame)
  const t = f ? 1 : -1;
  px(ctx, x + 3, y + 11, 3, 7, body);  px(ctx, x + 3, y + 16, 3, 2 + t, shade);
  px(ctx, x + 8, y + 12, 3, 8, body);  px(ctx, x + 8, y + 18, 3 + t, 2, shade);
  px(ctx, x + 13, y + 12, 3, 8, body); px(ctx, x + 13 - t, y + 18, 3, 2, shade);
  px(ctx, x + 18, y + 11, 3, 7, body); px(ctx, x + 18, y + 16, 3, 2 - t, shade);
  // suckers hint
  px(ctx, x + 4, y + 13, 1, 1, light); px(ctx, x + 19, y + 13, 1, 1, light);
  // two big eyes
  eye(ctx, x + 6, y + 5);
  eye(ctx, x + 14, y + 5);
}

// ── CRAB (HR) — wide shell, claws, stalk eyes ───────────────────────────────
function drawCrab(ctx: CanvasRenderingContext2D, cx: number, cy: number, body: string, shade: string, light: string, _accent: string, f: number) {
  const x = cx - 14, y = cy - 14;
  // shell
  px(ctx, x + 6, y + 4, 16, 8, body);
  px(ctx, x + 4, y + 6, 20, 5, body);
  px(ctx, x + 8, y + 2, 12, 3, body);
  px(ctx, x + 8, y + 2, 12, 2, shade);
  px(ctx, x + 7, y + 9, 14, 2, light);
  // stalk eyes
  px(ctx, x + 10, y - 2, 2, 3, body); eye(ctx, x + 9, y - 5);
  px(ctx, x + 16, y - 2, 2, 3, body); eye(ctx, x + 15, y - 5);
  // legs
  for (let i = 0; i < 3; i++) {
    px(ctx, x + 6 + i * 4, y + 11, 2, 3 + (f && i % 2 ? 1 : 0), shade);
    px(ctx, x + 16 + i * 3, y + 11, 2, 3 + (!f && i % 2 ? 1 : 0), shade);
  }
  // claws (open/close by frame)
  px(ctx, x, y + 5, 5, 4, body); px(ctx, x - 2, y + 3, 3, 2, shade); px(ctx, x - 2, y + 7 + (f ? 0 : 1), 3, 2, shade);
  px(ctx, x + 23, y + 5, 5, 4, body); px(ctx, x + 27, y + 3, 3, 2, shade); px(ctx, x + 27, y + 7 + (f ? 1 : 0), 3, 2, shade);
}

// ── SQUID (research/analyst) — upright mantle, arms ─────────────────────────
function drawSquid(ctx: CanvasRenderingContext2D, cx: number, cy: number, body: string, shade: string, light: string, _accent: string, f: number) {
  const x = cx - 9, y = cy - 22;
  // pointed mantle
  px(ctx, x + 6, y, 4, 3, body);
  px(ctx, x + 4, y + 2, 8, 4, body);
  px(ctx, x + 3, y + 5, 10, 7, body);
  px(ctx, x + 5, y + 1, 4, 2, shade);
  px(ctx, x + 4, y + 9, 8, 2, light);
  // fins on the mantle tip
  px(ctx, x + 1, y + 3, 3, 3, shade);
  px(ctx, x + 12, y + 3, 3, 3, shade);
  // arms (wiggle)
  const t = f ? 1 : -1;
  px(ctx, x + 4, y + 12, 2, 8, body);  px(ctx, x + 4, y + 18, 2, 2 + t, shade);
  px(ctx, x + 7, y + 12, 2, 9, body);
  px(ctx, x + 10, y + 12, 2, 8, body); px(ctx, x + 10, y + 18, 2, 2 - t, shade);
  // eyes
  eye(ctx, x + 4, y + 5);
  eye(ctx, x + 9, y + 5);
}

// ── FISH (generic worker) — simple oval + tail ──────────────────────────────
function drawFish(ctx: CanvasRenderingContext2D, cx: number, cy: number, body: string, shade: string, light: string, accent: string, f: number) {
  const x = cx - 12, y = cy - 14;
  // body
  px(ctx, x + 5, y + 3, 14, 8, body);
  px(ctx, x + 8, y + 1, 9, 3, body);
  px(ctx, x + 7, y + 10, 11, 2, light);
  px(ctx, x + 8, y + 1, 9, 1, shade);
  // tail (wiggle)
  px(ctx, x + 1, y + 2 + (f ? 1 : 0), 5, 4, body);
  px(ctx, x - 1, y + (f ? 1 : 0), 3, 3, shade);
  px(ctx, x - 1, y + 6 + (f ? -1 : 0), 3, 3, shade);
  // top fin
  px(ctx, x + 10, y - 1, 5, 2, shade);
  // eye + mouth
  eye(ctx, x + 15, y + 4);
  px(ctx, x + 18, y + 8, 2, 1, accent);
}
