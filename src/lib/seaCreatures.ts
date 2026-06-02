// Genesis Workers — the unified agent character, matching the official design ref.
// One chunky rounded blob body, recolored per role, with a crisp dark outline,
// expressive eyes, little legs, role props (crown, visor, glasses), eye-blink,
// state glow, and rising bubbles when active.
// (File kept as seaCreatures.ts to avoid import churn; the design is the
//  "Genesis Worker" blob, not literal sea animals.)

export type CreatureKind =
  | 'ceo' | 'trader' | 'risk' | 'marketing'
  | 'research' | 'memory' | 'security' | 'analyst' | 'worker';

export interface CreatureOpts {
  frame: 0 | 1;
  facingLeft: boolean;
  glow: string | null;
  alpha?: number;
  blink?: boolean;
  active?: boolean;
  nowMs?: number;
  pulse?: boolean;
}

// [body, shade, light] — exact reference palette.
const ROLE: Record<CreatureKind, [string, string, string]> = {
  ceo:       ['#FFD700', '#C9A400', '#FFEC8A'],
  trader:    ['#4CAF50', '#357A38', '#8CE090'],
  risk:      ['#FF5252', '#C43535', '#FF9A9A'],
  marketing: ['#9C27B0', '#6D1B7B', '#D57AE6'],
  research:  ['#FF9800', '#C47600', '#FFC266'],
  memory:    ['#2196F3', '#1567B8', '#83C2FF'],
  security:  ['#607D8B', '#43545D', '#9BB0BB'],
  analyst:   ['#00BCD4', '#0089A0', '#6CE6F5'],
  worker:    ['#56A6EC', '#2F77B8', '#A9D4FF'],
};

const OUTLINE = '#0a0d13';
const EYE = '#0c1018';

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// ── offscreen buffers (body + outline) ───────────────────────────────────────
const BUF = 48;
let _buf: HTMLCanvasElement | null = null, _bctx: CanvasRenderingContext2D | null = null;
let _obuf: HTMLCanvasElement | null = null, _octx: CanvasRenderingContext2D | null = null;
function buffers() {
  if (!_buf) {
    _buf = document.createElement('canvas'); _buf.width = BUF; _buf.height = BUF; _bctx = _buf.getContext('2d');
    _obuf = document.createElement('canvas'); _obuf.width = BUF; _obuf.height = BUF; _octx = _obuf.getContext('2d');
  }
  return { buf: _buf!, b: _bctx!, obuf: _obuf!, octx: _octx! };
}

export function drawCreature(
  ctx: CanvasRenderingContext2D,
  kind: CreatureKind,
  cx: number,
  cy: number,
  opts: CreatureOpts,
) {
  const pal = ROLE[kind] ?? ROLE.worker;

  // state glow
  if (opts.glow) {
    ctx.save();
    ctx.globalAlpha = (opts.alpha ?? 1) * 0.26;
    const g = ctx.createRadialGradient(cx, cy - 13, 2, cx, cy - 13, 20);
    g.addColorStop(0, opts.glow); g.addColorStop(1, 'transparent');
    ctx.fillStyle = g; ctx.fillRect(cx - 22, cy - 34, 44, 42);
    ctx.restore();
    if (opts.pulse) {
      ctx.save();
      const t = ((opts.nowMs ?? 0) % 800) / 800;
      const outerR = 20 + Math.sin(t * Math.PI * 2) * 4;
      ctx.globalAlpha = (opts.alpha ?? 1) * (0.3 + Math.sin(t * Math.PI * 2) * 0.2);
      const og = ctx.createRadialGradient(cx, cy - 13, 2, cx, cy - 13, outerR);
      og.addColorStop(0, opts.glow!); og.addColorStop(1, 'transparent');
      ctx.fillStyle = og; ctx.fillRect(cx - 26, cy - 38, 52, 50);
      ctx.restore();
    }
  }
  if (opts.active && opts.nowMs != null) drawBubbles(ctx, cx, cy, opts.nowMs, opts.alpha ?? 1);

  // render body into buffer
  const { buf, b, obuf, octx } = buffers();
  b.clearRect(0, 0, BUF, BUF);
  b.imageSmoothingEnabled = false;
  const bx = BUF / 2, by = BUF - 7;
  drawWorker(b, kind, bx, by, pal, opts.frame, !!opts.blink);

  // outline = dark silhouette stamped 4-neighbour
  octx.clearRect(0, 0, BUF, BUF);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(buf, 0, 0);
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = OUTLINE; octx.fillRect(0, 0, BUF, BUF);
  octx.globalCompositeOperation = 'source-over';

  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  ctx.imageSmoothingEnabled = false;
  if (opts.facingLeft) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
  const dx = cx - bx, dy = cy - by;
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) ctx.drawImage(obuf, dx + ox, dy + oy);
  ctx.drawImage(buf, dx, dy);
  ctx.restore();
}

// ── the unified blob ─────────────────────────────────────────────────────────
function drawWorker(ctx: CanvasRenderingContext2D, kind: CreatureKind, bx: number, by: number, pal: string[], f: number, blink: boolean) {
  const [body, shade, light] = pal;
  const x = bx - 11;            // left edge
  const top = by - 26;          // body top
  const wob = f ? 1 : 0;        // tiny idle wobble

  // legs (3 nubs) — alternate a step with frame
  px(ctx, x + 2,  by - 3, 4, 3, shade);
  px(ctx, x + 9,  by - 3 - wob, 4, 3 + wob, shade);
  px(ctx, x + 16, by - 3, 4, 3, shade);

  // body — rounded dome
  px(ctx, x + 5,  top,      12, 2, body);
  px(ctx, x + 3,  top + 2,  16, 2, body);
  px(ctx, x + 1,  top + 4,  20, 3, body);
  px(ctx, x,      top + 7,  22, 14, body);   // main mass
  px(ctx, x + 1,  top + 21, 20, 2, body);

  // form shading (right + bottom)
  px(ctx, x + 18, top + 5,  3, 16, shade);
  px(ctx, x + 2,  top + 20, 18, 2, shade);
  // belly + sheen highlight (left)
  px(ctx, x + 3,  top + 13, 9, 4, light);
  px(ctx, x + 3,  top + 4,  4, 4, light);

  // eyes — tall dark rounded rectangles (reference look)
  if (blink) {
    px(ctx, x + 5,  top + 11, 4, 1, EYE);
    px(ctx, x + 13, top + 11, 4, 1, EYE);
  } else {
    px(ctx, x + 5,  top + 8, 4, 5, EYE);
    px(ctx, x + 13, top + 8, 4, 5, EYE);
    // tiny catchlights
    px(ctx, x + 6,  top + 9, 1, 1, '#ffffff');
    px(ctx, x + 14, top + 9, 1, 1, '#ffffff');
  }

  // ── role props ──
  switch (kind) {
    case 'ceo': {            // crown
      const cy0 = top - 4;
      px(ctx, x + 5, cy0 + 3, 12, 3, '#ffe14a');
      px(ctx, x + 5, cy0,     2, 4, '#ffe14a');
      px(ctx, x + 10, cy0 - 1, 2, 5, '#ffe14a');
      px(ctx, x + 15, cy0,     2, 4, '#ffe14a');
      px(ctx, x + 10, cy0 + 1, 2, 2, '#ff5252'); // jewel
      break;
    }
    case 'security': {       // robot visor + antenna
      px(ctx, x + 4, top + 7, 14, 4, '#1c2530');     // visor band
      px(ctx, x + 5, top + 8, 3, 2, '#3da9fc');      // scan light
      px(ctx, x + 13, top + 8, 3, 2, '#3da9fc');
      px(ctx, x + 10, top - 3, 2, 4, shade);          // antenna
      px(ctx, x + 10, top - 5, 2, 2, '#ff5252');
      break;
    }
    case 'analyst': {        // glasses
      px(ctx, x + 4, top + 7, 6, 1, OUTLINE); px(ctx, x + 12, top + 7, 6, 1, OUTLINE);
      px(ctx, x + 4, top + 13, 6, 1, OUTLINE); px(ctx, x + 12, top + 13, 6, 1, OUTLINE);
      px(ctx, x + 4, top + 8, 1, 5, OUTLINE); px(ctx, x + 9, top + 8, 1, 5, OUTLINE);
      px(ctx, x + 12, top + 8, 1, 5, OUTLINE); px(ctx, x + 17, top + 8, 1, 5, OUTLINE);
      px(ctx, x + 10, top + 9, 2, 1, OUTLINE); // bridge
      break;
    }
    case 'trader':   px(ctx, x + 9, top + 22, 4, 3, '#FFD700'); break;     // gold tie
    case 'risk':     px(ctx, x - 2, top + 9, 4, 6, '#ffd24a'); px(ctx, x - 1, top + 10, 2, 4, shade); break; // shield
    case 'marketing':px(ctx, x + 18, top + 4, 5, 3, '#FFD700'); px(ctx, x + 21, top + 3, 2, 5, '#FFD700'); break; // megaphone
    case 'research': px(ctx, x + 18, top + 11, 4, 4, '#bfe6ff'); px(ctx, x + 21, top + 14, 3, 3, shade); break; // magnifier
    case 'memory':   px(ctx, x + 18, top + 12, 5, 9, shade); px(ctx, x + 19, top + 14, 3, 1, light); px(ctx, x + 19, top + 17, 3, 1, light); break; // cabinet
    default: break;
  }
}

// ── ambient rising bubbles ───────────────────────────────────────────────────
function drawBubbles(ctx: CanvasRenderingContext2D, cx: number, cy: number, now: number, alpha: number) {
  ctx.save();
  ctx.fillStyle = '#bfe6ff';
  for (let i = 0; i < 3; i++) {
    const period = 1400 + i * 500;
    const t = ((now + i * 700) % period) / period;
    const by = cy - 28 - t * 18;
    const bx = cx + 9 + Math.sin((now / 300) + i) * 2 + i * 2;
    const r = (1 - t) * 2 + 0.5;
    ctx.globalAlpha = alpha * 0.5 * (1 - t);
    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
