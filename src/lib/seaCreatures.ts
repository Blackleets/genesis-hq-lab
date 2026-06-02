// seaCreatures — procedural pixel-art sea creatures, redesigned for sharpness,
// personality, and life. Each creature has a crisp dark outline, a role-specific
// prop (originality), an eye-blink, and rises bubbles when active.
// Drawn with fillRect on an offscreen buffer that is outlined automatically, so
// every creature reads cleanly against the office floor.

export type CreatureKind = 'whale' | 'shark' | 'pufferfish' | 'octopus' | 'crab' | 'squid' | 'fish';

export interface CreatureOpts {
  frame: 0 | 1;          // fin/tentacle wiggle
  facingLeft: boolean;   // flip when swimming left
  glow: string | null;   // soft state ring (work/talk/warning/think)
  alpha?: number;        // fired agents render faint
  blink?: boolean;       // eyes closed this tick
  active?: boolean;      // emits rising bubbles
  nowMs?: number;        // animation clock for bubbles
}

// [body, shade, belly/light, accent, prop]
const PALETTE: Record<CreatureKind, [string, string, string, string, string]> = {
  whale:      ['#4a86c5', '#2f5d8f', '#dcebfb', '#16324f', '#ffd24a'],
  shark:      ['#8b97a6', '#5f6c7b', '#eef2f6', '#2f3742', '#1b2230'],
  pufferfish: ['#f0a93f', '#cc7f1f', '#ffe6ac', '#7a4d10', '#ffe066'],
  octopus:    ['#a96bff', '#7d3fe0', '#ecdcff', '#3f1f78', '#ffe066'],
  crab:       ['#ec5a3c', '#bf3c22', '#ffd2c6', '#6f2012', '#f4f4f5'],
  squid:      ['#2ad0bf', '#159185', '#d2faf4', '#0a4f49', '#ffe066'],
  fish:       ['#56a6ec', '#2f77b8', '#dcefff', '#173f63', '#ffe066'],
};

const OUTLINE = '#0a0d13';

// Draw onto a small offscreen buffer so we can stamp a clean 1px outline.
const BUF = 48;
let _buf: HTMLCanvasElement | null = null;
let _bctx: CanvasRenderingContext2D | null = null;
function buffer(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (!_buf) {
    _buf = document.createElement('canvas');
    _buf.width = BUF; _buf.height = BUF;
    _bctx = _buf.getContext('2d');
  }
  return [_buf, _bctx as CanvasRenderingContext2D];
}

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// White eye with pupil; blink draws a closed lash line instead.
function eye(ctx: CanvasRenderingContext2D, x: number, y: number, blink: boolean) {
  if (blink) { px(ctx, x, y + 2, 4, 1, OUTLINE); return; }
  px(ctx, x, y, 4, 4, '#ffffff');
  px(ctx, x + 2, y + 1, 2, 2, OUTLINE);
}

/**
 * Draw a creature anchored at (cx, cy) = floor point (bottom-center).
 * Renders to an offscreen buffer, stamps a dark outline (4-neighbour),
 * then composites — giving every creature a crisp, readable silhouette.
 */
export function drawCreature(
  ctx: CanvasRenderingContext2D,
  kind: CreatureKind,
  cx: number,
  cy: number,
  opts: CreatureOpts,
) {
  const pal = PALETTE[kind];
  const f = opts.frame;
  const blink = !!opts.blink;

  // State glow behind
  if (opts.glow) {
    ctx.save();
    ctx.globalAlpha = (opts.alpha ?? 1) * 0.25;
    const g = ctx.createRadialGradient(cx, cy - 13, 2, cx, cy - 13, 19);
    g.addColorStop(0, opts.glow);
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(cx - 20, cy - 32, 40, 40);
    ctx.restore();
  }

  // Rising bubbles from active creatures
  if (opts.active && opts.nowMs != null) {
    drawBubbles(ctx, cx, cy, opts.nowMs, opts.alpha ?? 1);
  }

  // ── Render creature into the offscreen buffer ──
  const [buf, b] = buffer();
  b.clearRect(0, 0, BUF, BUF);
  b.imageSmoothingEnabled = false;
  const bx = BUF / 2;            // buffer center x
  const by = BUF - 8;           // buffer floor y
  switch (kind) {
    case 'whale':      drawWhale(b, bx, by, pal, f, blink); break;
    case 'shark':      drawShark(b, bx, by, pal, f, blink); break;
    case 'pufferfish': drawPuffer(b, bx, by, pal, f, blink); break;
    case 'octopus':    drawOctopus(b, bx, by, pal, f, blink); break;
    case 'crab':       drawCrab(b, bx, by, pal, f, blink); break;
    case 'squid':      drawSquid(b, bx, by, pal, f, blink); break;
    default:           drawFish(b, bx, by, pal, f, blink); break;
  }

  // ── Composite: outline (4-neighbour stamp) + body ──
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  ctx.imageSmoothingEnabled = false;

  const dx = cx - bx;
  const dy = cy - by;

  if (opts.facingLeft) {
    ctx.translate(cx, 0);
    ctx.scale(-1, 1);
    ctx.translate(-cx, 0);
  }

  // Outline: draw the silhouette tinted dark, offset by 1px in 4 directions.
  ctx.save();
  ctx.globalAlpha = (opts.alpha ?? 1);
  // Build a dark version once
  const [o, octx] = outlineBuffer(buf);
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
    ctx.drawImage(o, dx + ox, dy + oy);
  }
  octx; // (octx retained for clarity)
  ctx.restore();

  // Body on top
  ctx.drawImage(buf, dx, dy);
  ctx.restore();
}

// Cache a dark-tinted copy of the body buffer for outlining.
let _obuf: HTMLCanvasElement | null = null;
let _octx: CanvasRenderingContext2D | null = null;
function outlineBuffer(src: HTMLCanvasElement): [HTMLCanvasElement, CanvasRenderingContext2D] {
  if (!_obuf) {
    _obuf = document.createElement('canvas');
    _obuf.width = BUF; _obuf.height = BUF;
    _octx = _obuf.getContext('2d');
  }
  const octx = _octx as CanvasRenderingContext2D;
  octx.clearRect(0, 0, BUF, BUF);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(src, 0, 0);
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = OUTLINE;
  octx.fillRect(0, 0, BUF, BUF);
  octx.globalCompositeOperation = 'source-over';
  return [_obuf, octx];
}

// ── Ambient rising bubbles (life) ───────────────────────────────────────────
function drawBubbles(ctx: CanvasRenderingContext2D, cx: number, cy: number, now: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillStyle = '#bfe6ff';
  // 3 bubbles on staggered loops rising above the head
  for (let i = 0; i < 3; i++) {
    const period = 1400 + i * 500;
    const t = ((now + i * 700) % period) / period;       // 0..1
    const by = cy - 26 - t * 18;
    const bx = cx + 8 + Math.sin((now / 300) + i) * 2 + i * 2;
    const r = (1 - t) * 2 + 0.5;
    ctx.globalAlpha = alpha * 0.5 * (1 - t);
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ═══ Creatures (drawn into the buffer; outline added by compositor) ═══════════
// All draw facing RIGHT, anchored at (cx,cy)=bottom-center of the buffer.

// 🐋 WHALE — CEO: rounded body, crown, monocle, spout
function drawWhale(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: string[], f: number, blink: boolean) {
  const [body, shade, light, , prop] = p;
  const x = cx - 17, y = cy - 24;
  // spout
  px(ctx, x + 10, y - 5 + (f ? -1 : 0), 2, 5, light);
  px(ctx, x + 8, y - 7 + (f ? -1 : 0), 2, 2, light);
  px(ctx, x + 12, y - 7 + (f ? -1 : 0), 2, 2, light);
  // body
  px(ctx, x + 4, y + 3, 26, 15, body);
  px(ctx, x + 2, y + 6, 30, 9, body);
  px(ctx, x + 7, y + 1, 20, 4, body);
  px(ctx, x + 7, y + 1, 20, 2, shade);
  px(ctx, x + 6, y + 15, 22, 4, light);           // belly
  // belly grooves
  px(ctx, x + 9, y + 17, 16, 1, shade);
  // tail fluke
  px(ctx, x - 3, y + 5 + (f ? 1 : -1), 7, 3, body);
  px(ctx, x - 5, y + 2 + (f ? 1 : -1), 4, 3, shade);
  px(ctx, x - 5, y + 10 + (f ? -1 : 1), 4, 3, shade);
  // side fin
  px(ctx, x + 15, y + 15, 6, 3, shade);
  // crown (prop)
  px(ctx, x + 17, y - 3, 9, 3, prop);
  px(ctx, x + 17, y - 5, 2, 2, prop); px(ctx, x + 21, y - 6, 2, 3, prop); px(ctx, x + 24, y - 5, 2, 2, prop);
  // eye + monocle
  eye(ctx, x + 22, y + 6, blink);
  px(ctx, x + 21, y + 5, 6, 1, prop); px(ctx, x + 21, y + 10, 6, 1, prop);
  px(ctx, x + 20, y + 6, 1, 4, prop); px(ctx, x + 27, y + 6, 1, 4, prop);
  // smile
  px(ctx, x + 22, y + 13, 5, 1, shade);
}

// 🦈 SHARK — Trader: sleek body, necktie, sunglasses
function drawShark(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: string[], f: number, blink: boolean) {
  const [body, shade, light, accent] = p;
  const x = cx - 17, y = cy - 20;
  // dorsal fin
  px(ctx, x + 12, y - 5, 6, 6, shade);
  px(ctx, x + 14, y - 8, 3, 3, shade);
  // body
  px(ctx, x + 4, y + 3, 22, 10, body);
  px(ctx, x + 8, y + 1, 15, 3, body);
  px(ctx, x + 7, y + 11, 18, 3, body);
  px(ctx, x + 24, y + 5, 5, 6, body);             // snout
  px(ctx, x + 7, y + 11, 18, 2, light);           // belly
  // tail
  px(ctx, x - 2, y + 2 + (f ? 1 : 0), 6, 5, body);
  px(ctx, x - 4, y + (f ? 1 : 0), 4, 3, shade);
  px(ctx, x - 4, y + 8 + (f ? -1 : 0), 4, 4, shade);
  // pectoral fin
  px(ctx, x + 11, y + 12, 6, 4, shade);
  // gills
  px(ctx, x + 19, y + 4, 1, 6, shade); px(ctx, x + 21, y + 4, 1, 6, shade);
  // necktie (prop)
  px(ctx, x + 16, y + 11, 2, 2, accent === '#2f3742' ? '#e0533a' : '#e0533a');
  px(ctx, x + 15, y + 13, 4, 3, '#c43a24');
  // sunglasses (prop)
  px(ctx, x + 20, y + 4, 8, 3, OUTLINE);
  px(ctx, x + 21, y + 5, 2, 1, '#3da9fc'); px(ctx, x + 25, y + 5, 2, 1, '#3da9fc');
  // mouth (toothy)
  px(ctx, x + 21, y + 10, 6, 1, light);
  if (!blink) { /* sunglasses cover eyes; no blink */ }
}

// 🐡 PUFFERFISH — Risk: round, spiky, holds a shield
function drawPuffer(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: string[], f: number, blink: boolean) {
  const [body, shade, light, , prop] = p;
  const x = cx - 14, y = cy - 22;
  const s = f ? 1 : 0;
  const spikes = [[12, -3 - s, 2, 4], [12, 17 + s, 2, 4], [-3 - s, 9, 4, 2], [25 + s, 9, 4, 2],
                  [2 - s, 1 - s, 3, 3], [21 + s, 1 - s, 3, 3], [2 - s, 16 + s, 3, 3], [21 + s, 16 + s, 3, 3]];
  for (const [sx, sy, sw, sh] of spikes) px(ctx, x + sx, y + sy, sw, sh, shade);
  // round body
  px(ctx, x + 4, y + 2, 18, 16, body);
  px(ctx, x + 2, y + 6, 22, 9, body);
  px(ctx, x + 7, y, 12, 3, body);
  px(ctx, x + 7, y + 16, 12, 3, body);
  px(ctx, x + 7, y, 12, 2, shade);
  px(ctx, x + 5, y + 14, 16, 4, light);           // belly
  // dot pattern
  px(ctx, x + 9, y + 4, 1, 1, shade); px(ctx, x + 15, y + 5, 1, 1, shade); px(ctx, x + 12, y + 8, 1, 1, shade);
  // fins
  px(ctx, x, y + 9, 3, 4, shade); px(ctx, x + 21, y + 9, 3, 4, shade);
  // shield (prop)
  px(ctx, x - 3, y + 6, 5, 7, prop); px(ctx, x - 2, y + 7, 3, 5, '#cc7f1f');
  px(ctx, x - 1, y + 8, 1, 3, prop);
  // worried eyes + mouth
  eye(ctx, x + 7, y + 6, blink); eye(ctx, x + 14, y + 6, blink);
  px(ctx, x + 10, y + 12, 4, 2, shade);
}

// 🐙 OCTOPUS — Memory: domed mantle, glasses, holds a scroll
function drawOctopus(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: string[], f: number, blink: boolean) {
  const [body, shade, light, , prop] = p;
  const x = cx - 13, y = cy - 22;
  // mantle
  px(ctx, x + 4, y + 2, 18, 11, body);
  px(ctx, x + 2, y + 6, 22, 7, body);
  px(ctx, x + 7, y, 12, 3, body);
  px(ctx, x + 7, y, 12, 2, shade);
  px(ctx, x + 8, y + 3, 5, 2, light);             // highlight
  // tentacles (wiggle)
  const t = f ? 1 : -1;
  px(ctx, x + 2, y + 12, 3, 8, body);  px(ctx, x + 2, y + 18, 3, 2 + t, shade);
  px(ctx, x + 7, y + 13, 3, 9, body);  px(ctx, x + 7, y + 19, 3 + t, 2, shade);
  px(ctx, x + 12, y + 13, 3, 9, body); px(ctx, x + 12 - t, y + 19, 3, 2, shade);
  px(ctx, x + 17, y + 12, 3, 8, body); px(ctx, x + 17, y + 18, 3, 2 - t, shade);
  px(ctx, x + 4, y + 14, 1, 1, light); px(ctx, x + 19, y + 14, 1, 1, light);  // suckers
  // scroll (prop) held by a tentacle
  px(ctx, x + 14, y + 16, 6, 4, '#f0e9d6'); px(ctx, x + 14, y + 16, 6, 1, prop); px(ctx, x + 14, y + 19, 6, 1, prop);
  // glasses + eyes
  eye(ctx, x + 6, y + 6, blink); eye(ctx, x + 13, y + 6, blink);
  px(ctx, x + 5, y + 5, 6, 1, OUTLINE); px(ctx, x + 12, y + 5, 6, 1, OUTLINE); px(ctx, x + 11, y + 6, 2, 1, OUTLINE);
}

// 🦀 CRAB — HR: wide shell, clipboard, stalk eyes
function drawCrab(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: string[], f: number, blink: boolean) {
  const [body, shade, light, , prop] = p;
  const x = cx - 16, y = cy - 15;
  // shell
  px(ctx, x + 6, y + 4, 20, 9, body);
  px(ctx, x + 4, y + 6, 24, 6, body);
  px(ctx, x + 9, y + 2, 14, 3, body);
  px(ctx, x + 9, y + 2, 14, 2, shade);
  px(ctx, x + 8, y + 10, 16, 2, light);
  // stalk eyes
  px(ctx, x + 11, y - 2, 2, 4, body); eye(ctx, x + 10, y - 5, blink);
  px(ctx, x + 18, y - 2, 2, 4, body); eye(ctx, x + 17, y - 5, blink);
  // legs
  for (let i = 0; i < 3; i++) {
    px(ctx, x + 7 + i * 4, y + 12, 2, 3 + (f && i % 2 ? 1 : 0), shade);
    px(ctx, x + 18 + i * 3, y + 12, 2, 3 + (!f && i % 2 ? 1 : 0), shade);
  }
  // claws
  px(ctx, x + 1, y + 6, 5, 4, body); px(ctx, x - 1, y + 4, 3, 2, shade); px(ctx, x - 1, y + 8 + (f ? 0 : 1), 3, 2, shade);
  px(ctx, x + 25, y + 6, 5, 4, body); px(ctx, x + 29, y + 4, 3, 2, shade); px(ctx, x + 29, y + 8 + (f ? 1 : 0), 3, 2, shade);
  // clipboard (prop) in right claw
  px(ctx, x + 26, y + 1, 6, 8, prop); px(ctx, x + 27, y + 2, 4, 6, '#c9c9cf'); px(ctx, x + 28, y + 3, 2, 1, OUTLINE); px(ctx, x + 28, y + 5, 2, 1, OUTLINE);
}

// 🦑 SQUID — Research: upright mantle, magnifying glass
function drawSquid(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: string[], f: number, blink: boolean) {
  const [body, shade, light, , prop] = p;
  const x = cx - 10, y = cy - 24;
  // pointed mantle
  px(ctx, x + 7, y, 4, 3, body);
  px(ctx, x + 5, y + 2, 8, 5, body);
  px(ctx, x + 3, y + 6, 12, 8, body);
  px(ctx, x + 6, y + 1, 4, 2, shade);
  px(ctx, x + 4, y + 11, 10, 2, light);
  // fins
  px(ctx, x + 1, y + 4, 3, 3, shade); px(ctx, x + 13, y + 4, 3, 3, shade);
  // arms (wiggle)
  const t = f ? 1 : -1;
  px(ctx, x + 4, y + 14, 2, 9, body);  px(ctx, x + 4, y + 21, 2, 2 + t, shade);
  px(ctx, x + 7, y + 14, 2, 10, body);
  px(ctx, x + 10, y + 14, 2, 9, body); px(ctx, x + 10, y + 21, 2, 2 - t, shade);
  // magnifying glass (prop)
  px(ctx, x + 12, y + 13, 5, 5, prop); px(ctx, x + 13, y + 14, 3, 3, '#bfe6ff'); px(ctx, x + 16, y + 17, 3, 3, prop);
  // eyes
  eye(ctx, x + 4, y + 6, blink); eye(ctx, x + 9, y + 6, blink);
}

// 🐟 FISH — Worker: oval body, little fin
function drawFish(ctx: CanvasRenderingContext2D, cx: number, cy: number, p: string[], f: number, blink: boolean) {
  const [body, shade, light, accent] = p;
  const x = cx - 13, y = cy - 15;
  px(ctx, x + 5, y + 3, 16, 9, body);
  px(ctx, x + 9, y + 1, 10, 3, body);
  px(ctx, x + 8, y + 11, 12, 2, light);
  px(ctx, x + 9, y + 1, 10, 1, shade);
  // tail
  px(ctx, x + 1, y + 3 + (f ? 1 : 0), 5, 5, body);
  px(ctx, x - 1, y + 1 + (f ? 1 : 0), 3, 3, shade);
  px(ctx, x - 1, y + 7 + (f ? -1 : 0), 3, 3, shade);
  // fins
  px(ctx, x + 11, y - 1, 6, 2, shade);
  px(ctx, x + 10, y + 11, 4, 2, shade);
  // stripe
  px(ctx, x + 12, y + 4, 1, 7, shade);
  // eye + mouth
  eye(ctx, x + 16, y + 4, blink);
  px(ctx, x + 19, y + 8, 2, 1, accent);
}
