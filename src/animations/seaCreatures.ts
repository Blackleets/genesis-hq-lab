// Genesis Workers — vivid pixel-art agents: arms, mouth expressions, eye states,
// and work sparks so it's instantly clear what each agent is doing.

import type { EvolutionSprite } from '@animations/agentEvolution';

export type CreatureKind =
  | 'ceo' | 'trader' | 'risk' | 'marketing'
  | 'research' | 'memory' | 'security' | 'analyst' | 'worker';

/** Tier refinement for one agent's own sprite (presence, crispness, lighting,
 *  tactical detail). Identity is preserved — this only refines, never redesigns. */
export interface EvolutionRender {
  sprite: EvolutionSprite;
  accent: string;
}

export interface CreatureOpts {
  frame: 0 | 1;
  facingLeft: boolean;
  glow: string | null;
  alpha?: number;
  blink?: boolean;
  active?: boolean;
  nowMs?: number;
  pulse?: boolean;
  thinking?: boolean;
  animation?: string; // drives arms, mouth, eye expression
  /** optional per-tier refinement; absent = native sprite, no refinement */
  evolution?: EvolutionRender;
}

// [body, shade, light] — exact reference palette.
const ROLE: Record<CreatureKind, [string, string, string]> = {
  ceo: ['#FFD700', '#C9A400', '#FFEC8A'],
  trader: ['#4CAF50', '#357A38', '#8CE090'],
  risk: ['#FF5252', '#C43535', '#FF9A9A'],
  marketing: ['#9C27B0', '#6D1B7B', '#D57AE6'],
  research: ['#FF9800', '#C47600', '#FFC266'],
  memory: ['#2196F3', '#1567B8', '#83C2FF'],
  security: ['#607D8B', '#43545D', '#9BB0BB'],
  analyst: ['#00BCD4', '#0089A0', '#6CE6F5'],
  worker: ['#56A6EC', '#2F77B8', '#A9D4FF'],
};

const OUTLINE = '#0a0d13';
const EYE = '#0c1018';

function px(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

// ── offscreen buffers (body, outline, accent rim, pixelate temp) ─────────────
const BUF = 48;
let _buf: HTMLCanvasElement | null = null, _bctx: CanvasRenderingContext2D | null = null;
let _obuf: HTMLCanvasElement | null = null, _octx: CanvasRenderingContext2D | null = null;
let _rbuf: HTMLCanvasElement | null = null, _rctx: CanvasRenderingContext2D | null = null;
let _tbuf: HTMLCanvasElement | null = null, _tctx: CanvasRenderingContext2D | null = null;
function buffers() {
  if (!_buf) {
    _buf = document.createElement('canvas'); _buf.width = BUF; _buf.height = BUF; _bctx = _buf.getContext('2d');
    _obuf = document.createElement('canvas'); _obuf.width = BUF; _obuf.height = BUF; _octx = _obuf.getContext('2d');
    _rbuf = document.createElement('canvas'); _rbuf.width = BUF; _rbuf.height = BUF; _rctx = _rbuf.getContext('2d');
    _tbuf = document.createElement('canvas'); _tbuf.width = BUF; _tbuf.height = BUF; _tctx = _tbuf.getContext('2d');
  }
  return { buf: _buf!, b: _bctx!, obuf: _obuf!, octx: _octx!, rbuf: _rbuf!, rctx: _rctx!, tbuf: _tbuf!, tctx: _tctx! };
}

/** hex (#rgb/#rrggbb) + alpha → rgba(); passes through non-hex colors. */
function rgbaFrom(hex: string, a: number): string {
  if (hex[0] !== '#') return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  const cl = Math.max(0, Math.min(1, a));
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${cl})`;
}

export function drawCreature(
  ctx: CanvasRenderingContext2D,
  kind: CreatureKind,
  cx: number,
  cy: number,
  opts: CreatureOpts,
) {
  const pal = ROLE[kind] ?? ROLE.worker;
  const anim = opts.animation ?? 'idle';

  // ── state glow ──
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

  // ── thought dots "..." ──
  if (opts.thinking && opts.nowMs != null) {
    ctx.save();
    const t = (opts.nowMs % 1250) / 1250;
    for (let i = 0; i < 3; i++) {
      const phase = t + i * (1 / 3);
      const wrapped = phase % 1;
      const dotAlpha = (opts.alpha ?? 1) * Math.max(0, 0.4 + Math.sin(wrapped * Math.PI * 2) * 0.4);
      const dotY = cy - 38 - Math.sin(wrapped * Math.PI) * 3;
      ctx.globalAlpha = dotAlpha;
      ctx.fillStyle = '#a855f7';
      ctx.beginPath();
      ctx.arc(cx - 5 + i * 5, dotY, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  if (opts.active && opts.nowMs != null) drawBubbles(ctx, cx, cy, opts.nowMs, opts.alpha ?? 1);

  // ── work sparks when typing ──
  if (anim === 'work' && opts.nowMs != null) {
    drawWorkSparks(ctx, cx, cy, opts.nowMs, opts.alpha ?? 1);
  }

  // ── evolution refinement (defaults = native sprite, no refinement) ──
  const sp = opts.evolution?.sprite;
  const accent = opts.evolution?.accent ?? null;
  const scale = sp?.scale ?? 1;
  const pixelate = sp?.pixelate ?? 1;
  const outlineAlpha = sp?.outlineAlpha ?? 1;
  const rim = sp?.rim ?? 0;
  const aura = sp?.aura ?? 'none';
  const accessory = sp?.accessory ?? 0;
  const posture = sp?.posture ?? 0;
  const idleDamp = sp?.idleDamp ?? 1;

  // ── tier ambient aura behind the body (premium lighting) ──
  if (accent && aura !== 'none') {
    const now = opts.nowMs ?? 0;
    const base = aura === 'faint' ? 0.05 : aura === 'soft' ? 0.11 : 0.10;
    const pulse = aura === 'breathing' ? (0.5 + 0.5 * Math.sin(now / 1400)) * 0.07 : 0;
    const r = (aura === 'breathing' ? 22 + 2.5 * Math.sin(now / 1400) : 20) * scale;
    const ay = cy - 15 * scale;
    ctx.save();
    ctx.globalAlpha = opts.alpha ?? 1;
    const g = ctx.createRadialGradient(cx, ay, 2, cx, ay, r);
    g.addColorStop(0, rgbaFrom(accent, base + pulse));
    g.addColorStop(1, rgbaFrom(accent, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, ay, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ── render body into buffer ──
  const { buf, b, obuf, octx, rbuf, rctx, tbuf, tctx } = buffers();
  b.clearRect(0, 0, BUF, BUF);
  b.imageSmoothingEnabled = false;
  const bx = BUF / 2, by = BUF - 7;
  drawWorker(b, kind, bx, by, pal, opts.frame, !!opts.blink, anim, opts.nowMs ?? 0, accessory, accent, posture, idleDamp);

  // pixelate (rookie chunkier): downsample then upsample nearest-neighbour
  if (pixelate < 1) {
    const s = Math.max(10, Math.round(BUF * pixelate));
    tctx.clearRect(0, 0, BUF, BUF);
    tctx.imageSmoothingEnabled = false;
    tctx.drawImage(buf, 0, 0, BUF, BUF, 0, 0, s, s);
    b.clearRect(0, 0, BUF, BUF);
    b.imageSmoothingEnabled = false;
    b.drawImage(tbuf, 0, 0, s, s, 0, 0, BUF, BUF);
  }

  // outline = dark silhouette stamped 4-neighbour
  octx.clearRect(0, 0, BUF, BUF);
  octx.imageSmoothingEnabled = false;
  octx.globalCompositeOperation = 'source-over';
  octx.drawImage(buf, 0, 0);
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = OUTLINE; octx.fillRect(0, 0, BUF, BUF);
  octx.globalCompositeOperation = 'source-over';

  // accent rim-light silhouette (elite+) — a lit edge tinted with the accent
  if (rim > 0 && accent) {
    rctx.clearRect(0, 0, BUF, BUF);
    rctx.imageSmoothingEnabled = false;
    rctx.globalCompositeOperation = 'source-over';
    rctx.drawImage(buf, 0, 0);
    rctx.globalCompositeOperation = 'source-in';
    rctx.fillStyle = accent; rctx.fillRect(0, 0, BUF, BUF);
    rctx.globalCompositeOperation = 'source-over';
  }

  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha = opts.alpha;
  ctx.imageSmoothingEnabled = false;
  if (opts.facingLeft) { ctx.translate(cx, 0); ctx.scale(-1, 1); ctx.translate(-cx, 0); }
  // scale around the foot point so feet stay planted while presence grows
  if (scale !== 1) { ctx.translate(cx, cy); ctx.scale(scale, scale); ctx.translate(-cx, -cy); }
  const dx = cx - bx, dy = cy - by;
  // dark outline (rookie softer via outlineAlpha)
  ctx.save();
  ctx.globalAlpha = (opts.alpha ?? 1) * outlineAlpha;
  for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) ctx.drawImage(obuf, dx + ox, dy + oy);
  ctx.restore();
  // accent rim-light just inside the top-left (lit) edge
  if (rim > 0 && accent) {
    ctx.save();
    ctx.globalAlpha = (opts.alpha ?? 1) * rim;
    ctx.drawImage(rbuf, dx - 1, dy - 1);
    ctx.restore();
  }
  // body
  ctx.drawImage(buf, dx, dy);
  ctx.restore();
}

// ── the unified blob with arms, expression, and mouth ────────────────────────
function drawWorker(
  ctx: CanvasRenderingContext2D,
  kind: CreatureKind,
  bx: number,
  by: number,
  pal: string[],
  f: number,
  blink: boolean,
  animation: string,
  nowMs: number,
  accessory: number = 0,
  accent: string | null = null,
  posture: number = 0,
  idleDamp: number = 1,
) {
  const [body, shade, light] = pal;
  const x = bx - 11;           // left edge
  const top = by - 26 - posture; // body top (posture lifts the stance)
  const wob = f ? 1 : 0;       // idle wobble
  const armY = top + 14;       // arm attach height (mid-body)
  const AW = 5, AH = 4;        // arm width / height

  // ── ARMS (drawn before body so body edge overlaps arm root) ──────────────
  switch (animation) {
    case 'work': {
      // Alternating L/R typing rhythm
      const tb = Math.floor(nowMs / 175) % 2;
      const lOff = tb ? 1 : 0;
      const rOff = tb ? 0 : 1;
      px(ctx, x - AW, armY + lOff, AW, AH, body);
      px(ctx, x - AW, armY + lOff + AH - 1, AW, 1, shade);
      px(ctx, x + 22, armY + rOff, AW, AH, body);
      px(ctx, x + 22, armY + rOff + AH - 1, AW, 1, shade);
      break;
    }
    case 'think': {
      // Left arm hangs down, right arm raised to head
      px(ctx, x - AW + 1, armY + 4, AW, AH, body);
      px(ctx, x - AW + 1, armY + 7, AW, 1, shade);
      px(ctx, x + 22, armY - 5, AW, AH + 5, body);  // tall upward arm
      px(ctx, x + 22, armY - 1, AW, 1, shade);
      break;
    }
    case 'warning': {
      // Both arms raised with oscillation
      const wt = Math.round(Math.sin(nowMs / 190) * 2);
      px(ctx, x - AW, armY - 4 + wt, AW, AH + 2, body);
      px(ctx, x - AW, armY - 4 + wt + AH + 1, AW, 1, shade);
      px(ctx, x + 22, armY - 4 - wt, AW, AH + 2, body);
      px(ctx, x + 22, armY - 4 - wt + AH + 1, AW, 1, shade);
      break;
    }
    case 'talk': {
      // Left arm raised gesturing, right arm resting
      const tw = Math.round(Math.sin(nowMs / 240) * 1.5);
      px(ctx, x - AW, armY - 3 + tw, AW, AH + 2, body);
      px(ctx, x - AW, armY - 3 + tw + AH + 1, AW, 1, shade);
      px(ctx, x + 22, armY + 2, AW, AH, body);
      px(ctx, x + 22, armY + AH + 1, AW, 1, shade);
      break;
    }
    case 'walk': {
      // Arms swing opposite to legs
      const sw = f ? 3 : 0;
      px(ctx, x - AW + 1, armY + sw, AW - 1, AH, body);
      px(ctx, x - AW + 1, armY + sw + AH - 1, AW - 1, 1, shade);
      px(ctx, x + 22, armY + (f ? 0 : 3), AW - 1, AH, body);
      px(ctx, x + 22, armY + (f ? AH - 1 : 2), AW - 1, 1, shade);
      break;
    }
    case 'onboarding': {
      // One arm waving hello
      const ow = (nowMs % 600) < 300 ? -3 : -1;
      px(ctx, x - AW, armY + ow, AW, AH, body);
      px(ctx, x - AW, armY + ow + AH - 1, AW, 1, shade);
      px(ctx, x + 22, armY + 2, AW, AH, body);
      px(ctx, x + 22, armY + AH + 1, AW, 1, shade);
      break;
    }
    case 'retraining': {
      // Both arms slightly forward holding book
      px(ctx, x - AW + 1, armY + 2, AW, AH, body);
      px(ctx, x - AW + 1, armY + AH + 1, AW, 1, shade);
      px(ctx, x + 22, armY + 2, AW, AH, body);
      px(ctx, x + 22, armY + AH + 1, AW, 1, shade);
      break;
    }
    default: {
      // Idle: arms relaxed at sides with gentle bob (calmer at higher tiers)
      const ib = Math.round(Math.sin(nowMs / 1800) * 0.5 * idleDamp);
      px(ctx, x - AW + 1, armY + 2 + ib, AW - 1, AH, body);
      px(ctx, x - AW + 1, armY + AH + 1 + ib, AW - 1, 1, shade);
      px(ctx, x + 22, armY + 2 + ib, AW - 1, AH, body);
      px(ctx, x + 22, armY + AH + 1 + ib, AW - 1, 1, shade);
    }
  }

  // ── LEGS (3 nubs, alternate step with frame) ──────────────────────────────
  px(ctx, x + 2, by - 3, 4, 3, shade);
  px(ctx, x + 9, by - 3 - wob, 4, 3 + wob, shade);
  px(ctx, x + 16, by - 3, 4, 3, shade);

  // ── BODY — rounded dome ───────────────────────────────────────────────────
  px(ctx, x + 5, top, 12, 2, body);
  px(ctx, x + 3, top + 2, 16, 2, body);
  px(ctx, x + 1, top + 4, 20, 3, body);
  px(ctx, x, top + 7, 22, 14, body);
  px(ctx, x + 1, top + 21, 20, 2, body);

  // form shading
  px(ctx, x + 18, top + 5, 3, 16, shade);
  px(ctx, x + 2, top + 20, 18, 2, shade);
  // belly + sheen highlight
  px(ctx, x + 3, top + 13, 9, 4, light);
  px(ctx, x + 3, top + 4, 4, 4, light);

  // ── EYES — expression variants ────────────────────────────────────────────
  if (blink) {
    px(ctx, x + 5, top + 11, 4, 1, EYE);
    px(ctx, x + 13, top + 11, 4, 1, EYE);
  } else {
    switch (animation) {
      case 'warning': {
        // Wide, alarmed eyes
        px(ctx, x + 4, top + 7, 5, 6, EYE);
        px(ctx, x + 13, top + 7, 5, 6, EYE);
        px(ctx, x + 5, top + 8, 1, 2, '#ffffff');
        px(ctx, x + 14, top + 8, 1, 2, '#ffffff');
        break;
      }
      case 'work': {
        // Focused/squinted eyes + brows
        px(ctx, x + 5, top + 9, 4, 3, EYE);
        px(ctx, x + 13, top + 9, 4, 3, EYE);
        px(ctx, x + 6, top + 9, 1, 1, '#ffffff');
        px(ctx, x + 14, top + 9, 1, 1, '#ffffff');
        px(ctx, x + 4, top + 7, 7, 1, shade);  // left brow down
        px(ctx, x + 12, top + 7, 7, 1, shade);  // right brow down
        break;
      }
      case 'think': {
        // Normal eyes + right brow raised
        px(ctx, x + 5, top + 8, 4, 5, EYE);
        px(ctx, x + 13, top + 8, 4, 5, EYE);
        px(ctx, x + 6, top + 9, 1, 1, '#ffffff');
        px(ctx, x + 14, top + 9, 1, 1, '#ffffff');
        px(ctx, x + 13, top + 6, 5, 1, EYE);    // raised right brow
        break;
      }
      case 'talk': {
        // Lively eyes with slight squint
        px(ctx, x + 5, top + 8, 4, 4, EYE);
        px(ctx, x + 13, top + 8, 4, 4, EYE);
        px(ctx, x + 6, top + 9, 1, 1, '#ffffff');
        px(ctx, x + 14, top + 9, 1, 1, '#ffffff');
        break;
      }
      case 'fired': {
        // Downcast eyes — narrowed and sad
        px(ctx, x + 5, top + 10, 4, 2, EYE);
        px(ctx, x + 13, top + 10, 4, 2, EYE);
        break;
      }
      default: {
        // Normal eyes with catchlights
        px(ctx, x + 5, top + 8, 4, 5, EYE);
        px(ctx, x + 13, top + 8, 4, 5, EYE);
        px(ctx, x + 6, top + 9, 1, 1, '#ffffff');
        px(ctx, x + 14, top + 9, 1, 1, '#ffffff');
      }
    }
  }

  // ── MOUTH — expression per state ─────────────────────────────────────────
  const mouthX = x + 10;
  const mouthY = top + 17;

  switch (animation) {
    case 'work': {
      // Focused "O" — set, concentrating
      px(ctx, mouthX, mouthY, 3, 2, EYE);
      break;
    }
    case 'think': {
      // Pursed / tilted pondering
      px(ctx, mouthX - 1, mouthY + 1, 2, 1, EYE);
      px(ctx, mouthX + 1, mouthY, 2, 1, EYE);
      break;
    }
    case 'warning': {
      // Open alarmed mouth with red inner
      px(ctx, mouthX - 2, mouthY - 1, 5, 3, EYE);
      px(ctx, mouthX - 1, mouthY, 3, 2, '#cc0000');
      break;
    }
    case 'talk': {
      // Talking mouth — animates open/close
      const to = (nowMs % 300) < 150 ? 3 : 2;
      px(ctx, mouthX - 2, mouthY, 5, to, EYE);
      px(ctx, mouthX - 1, mouthY + 1, 3, 1, '#cc4444');
      break;
    }
    case 'fired': {
      // Sad inverted arc
      px(ctx, mouthX - 2, mouthY + 2, 1, 1, EYE);
      px(ctx, mouthX - 1, mouthY + 3, 4, 1, EYE);
      px(ctx, mouthX + 3, mouthY + 2, 1, 1, EYE);
      break;
    }
    case 'onboarding': {
      // Big happy smile
      px(ctx, mouthX - 3, mouthY + 1, 1, 1, EYE);
      px(ctx, mouthX - 2, mouthY + 2, 6, 1, EYE);
      px(ctx, mouthX + 3, mouthY + 1, 1, 1, EYE);
      break;
    }
    default: {
      // Small neutral/content smile
      px(ctx, mouthX - 1, mouthY + 1, 3, 1, EYE);
    }
  }

  // ── ROLE PROPS ────────────────────────────────────────────────────────────
  switch (kind) {
    case 'ceo': {
      // Crown — taller and more visible
      const cy0 = top - 5;
      px(ctx, x + 5, cy0 + 3, 12, 3, '#ffe14a');
      px(ctx, x + 5, cy0, 2, 4, '#ffe14a');
      px(ctx, x + 10, cy0 - 1, 2, 5, '#ffe14a');
      px(ctx, x + 15, cy0, 2, 4, '#ffe14a');
      px(ctx, x + 10, cy0 + 1, 2, 2, '#ff5252'); // jewel
      // Crown sheen
      px(ctx, x + 6, cy0 + 3, 3, 1, '#fff4a0');
      break;
    }
    case 'security': {
      // Robot visor + antenna
      px(ctx, x + 4, top + 7, 14, 4, '#1c2530');
      px(ctx, x + 5, top + 8, 3, 2, '#3da9fc');
      px(ctx, x + 13, top + 8, 3, 2, '#3da9fc');
      px(ctx, x + 10, top - 3, 2, 4, shade);
      px(ctx, x + 10, top - 5, 2, 2, '#ff5252');
      break;
    }
    case 'analyst': {
      // Glasses
      px(ctx, x + 4, top + 7, 6, 1, OUTLINE); px(ctx, x + 12, top + 7, 6, 1, OUTLINE);
      px(ctx, x + 4, top + 13, 6, 1, OUTLINE); px(ctx, x + 12, top + 13, 6, 1, OUTLINE);
      px(ctx, x + 4, top + 8, 1, 5, OUTLINE); px(ctx, x + 9, top + 8, 1, 5, OUTLINE);
      px(ctx, x + 12, top + 8, 1, 5, OUTLINE); px(ctx, x + 17, top + 8, 1, 5, OUTLINE);
      px(ctx, x + 10, top + 9, 2, 1, OUTLINE); // bridge
      break;
    }
    case 'trader': px(ctx, x + 9, top + 22, 4, 3, '#FFD700'); break;  // gold tie
    case 'risk': px(ctx, x - 2, top + 9, 4, 6, '#ffd24a'); px(ctx, x - 1, top + 10, 2, 4, shade); break; // shield
    case 'marketing': px(ctx, x + 18, top + 4, 5, 3, '#FFD700'); px(ctx, x + 21, top + 3, 2, 5, '#FFD700'); break; // megaphone
    case 'research': px(ctx, x + 18, top + 11, 4, 4, '#bfe6ff'); px(ctx, x + 21, top + 14, 3, 3, shade); break; // magnifier
    case 'memory': px(ctx, x + 18, top + 12, 5, 9, shade); px(ctx, x + 19, top + 14, 3, 1, light); px(ctx, x + 19, top + 17, 3, 1, light); break; // cabinet
    default: break;
  }

  // ── TIER ACCESSORIES (accent-tinted, cumulative) ──────────────────────────
  // Placed on torso/shoulders, clear of head props and the face, so they read
  // as a refined uniform — premium and tactical, never childish.
  if (accent && accessory >= 1) {
    px(ctx, x + 1, top + 18, 20, 1, accent);                          // uniform hem line
  }
  if (accent && accessory >= 2) {
    px(ctx, x, top + 5, 3, 2, accent);                                 // left epaulet
    px(ctx, x + 19, top + 5, 3, 2, accent);                            // right epaulet
  }
  if (accent && accessory >= 3) {
    px(ctx, x + 10, top + 8, 1, 10, accent);                           // center placket trim
  }
}

// ── work sparks — tiny pixels near hands when typing ─────────────────────────
function drawWorkSparks(ctx: CanvasRenderingContext2D, cx: number, cy: number, now: number, alpha: number) {
  const phase = (now % 350) / 350;
  if (phase > 0.45) return;
  const a = alpha * (1 - phase / 0.45) * 0.85;
  const tb = Math.floor(now / 175) % 2; // sync with typing arms
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#00ff9c';
  if (tb === 0) {
    // left hand sparks
    ctx.fillRect(cx - 16, cy - 10, 1, 1);
    ctx.fillRect(cx - 14, cy - 13, 1, 1);
    ctx.fillStyle = '#a3f7d4';
    ctx.fillRect(cx - 17, cy - 12, 1, 1);
  } else {
    // right hand sparks
    ctx.fillRect(cx + 15, cy - 10, 1, 1);
    ctx.fillRect(cx + 13, cy - 13, 1, 1);
    ctx.fillStyle = '#a3f7d4';
    ctx.fillRect(cx + 16, cy - 12, 1, 1);
  }
  ctx.restore();
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
