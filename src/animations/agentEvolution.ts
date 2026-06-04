// agentEvolution — real, data-driven visual evolution for Genesis agents.
//
// Philosophy: an agent's BASE sprite never changes (identity is sacred).
// Evolution only ADDS refinement layers around it — a ground signature below
// and a crest above — that grow richer with the agent's real level.
// Progression is cumulative and premium: each tier layers on the previous one.
// No redesign, no cartoon morph. Color always comes from the agent's own
// visualProfile.accent, so identity is preserved while presence intensifies.

import type { Agent, AgentRank } from '@core/types/genesis';
import type { PixelRenderAgent } from '@animations/pixelCanvasRenderer';

// ─── Real level derivation ────────────────────────────────────────────────────
// Level is a deterministic function of REAL agent fields — never invented.
// It rises as the agent learns (learningScore ↑ on task completion), gets
// promoted (rank ↑), and accumulates real trading experience (tradeCount ↑).
// Mistakes pull it back down. No persistence needed — pure derivation.

const RANK_ORDINAL: Record<AgentRank, number> = {
  intern: 0, junior: 1, operator: 2, senior: 3, lead: 4, executive: 5,
};

/** Derive an agent's level (1..~60) from real fields. Pure + deterministic. */
export function agentLevel(agent: Agent): number {
  const learning = clamp01(agent.learningScore ?? 0);
  const rank = RANK_ORDINAL[agent.rank] ?? 0;
  const trades = Math.min(agent.tradeCount ?? 0, 24);
  const mistakes = agent.mistakeCount ?? 0;

  const raw =
    learning * 28 +   // learning is the primary engine (0..28)
    rank * 4 +        // promotions give step jumps (0..20)
    trades * 0.5 -    // real trading experience (0..12)
    mistakes * 1;     // errors set you back

  return Math.max(1, Math.floor(raw));
}

// ─── Tiers ────────────────────────────────────────────────────────────────────

export type EvolutionTierId = 'rookie' | 'professional' | 'elite' | 'legendary';

/**
 * Per-tier refinement applied to the agent's OWN sprite (never a redesign).
 * Identity is preserved — body, palette, eyes/mouth and role prop are constant.
 * These knobs only refine: presence (scale), crispness (pixelate), edge quality
 * (outlineAlpha + rim), lighting (aura), tactical detail (accessory) and bearing
 * (posture + idleDamp). Progression is cumulative and premium, not cartoonish.
 */
export interface EvolutionSprite {
  /** overall size around the foot point — presence */
  scale: number;
  /** <1 renders chunkier (rookie looks slightly pixelated); 1 = native crisp */
  pixelate: number;
  /** dark silhouette outline opacity — rookie softer, higher tiers crisp */
  outlineAlpha: number;
  /** accent rim-light strength on the lit (top-left) edge, 0 = off */
  rim: number;
  /** ambient accent aura behind the body */
  aura: 'none' | 'faint' | 'soft' | 'breathing';
  /** cumulative tactical accessories tinted with the agent accent: 0..3 */
  accessory: 0 | 1 | 2 | 3;
  /** px the stance lifts — straighter, more confident posture */
  posture: number;
  /** 0..1 multiplier damping idle motion — calmer, cleaner animation */
  idleDamp: number;
}

export interface EvolutionTier {
  id: EvolutionTierId;
  name: { es: string; en: string };
  minLevel: number;
  maxLevel: number;     // inclusive; Infinity for legendary
  /** which refinement layers are active (cumulative) */
  ground: boolean;      // base ring under the feet
  glow: boolean;        // soft accent aura
  orbit: boolean;       // rotating orbital ring + particles
  crest: 'none' | 'tick' | 'chevron' | 'icon';
  /** overall intensity multiplier for the accent color (0..1) */
  intensity: number;
  /** refinement applied to the agent's own sprite */
  sprite: EvolutionSprite;
}

export const EVOLUTION_TIERS: EvolutionTier[] = [
  {
    id: 'rookie',
    name: { es: 'Novato', en: 'Rookie' },
    minLevel: 1, maxLevel: 5,
    ground: false, glow: false, orbit: false, crest: 'none',
    intensity: 0.0,
    sprite: { scale: 0.90, pixelate: 0.86, outlineAlpha: 0.6, rim: 0, aura: 'none', accessory: 0, posture: 0, idleDamp: 1.0 },
  },
  {
    id: 'professional',
    name: { es: 'Profesional', en: 'Professional' },
    minLevel: 6, maxLevel: 15,
    ground: true, glow: false, orbit: false, crest: 'tick',
    intensity: 0.4,
    sprite: { scale: 1.00, pixelate: 1.0, outlineAlpha: 1.0, rim: 0, aura: 'faint', accessory: 1, posture: 0, idleDamp: 0.7 },
  },
  {
    id: 'elite',
    name: { es: 'Élite', en: 'Elite' },
    minLevel: 16, maxLevel: 30,
    ground: true, glow: true, orbit: false, crest: 'chevron',
    intensity: 0.7,
    sprite: { scale: 1.08, pixelate: 1.0, outlineAlpha: 1.0, rim: 0.55, aura: 'soft', accessory: 2, posture: 1, idleDamp: 0.45 },
  },
  {
    id: 'legendary',
    name: { es: 'Legendario', en: 'Legendary' },
    minLevel: 31, maxLevel: Infinity,
    ground: true, glow: true, orbit: true, crest: 'icon',
    intensity: 1.0,
    sprite: { scale: 1.15, pixelate: 1.0, outlineAlpha: 1.0, rim: 0.9, aura: 'breathing', accessory: 3, posture: 1, idleDamp: 0.22 },
  },
];

export function tierForLevel(level: number): EvolutionTier {
  for (const tier of EVOLUTION_TIERS) {
    if (level >= tier.minLevel && level <= tier.maxLevel) return tier;
  }
  return EVOLUTION_TIERS[0];
}

export interface AgentEvolution {
  level: number;
  tier: EvolutionTier;
  /** progress 0..1 toward the next tier (1 at legendary cap) */
  tierProgress: number;
}

/** Full evolution snapshot for an agent — used by canvas + inspector + tooltip. */
export function agentEvolution(agent: Agent): AgentEvolution {
  const level = agentLevel(agent);
  const tier = tierForLevel(level);
  const span = tier.maxLevel === Infinity ? 1 : (tier.maxLevel - tier.minLevel + 1);
  const tierProgress = tier.maxLevel === Infinity
    ? 1
    : clamp01((level - tier.minLevel + 1) / span);
  return { level, tier, tierProgress };
}

// ─── Canvas drawing — GROUND layer (drawn BEFORE the sprite) ───────────────────
// Sits on the floor under the agent's feet. Reads as a refined platform that
// gets more defined and luminous with tier. Never overlaps the sprite body.

export function drawEvolutionGround(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
  nowMs: number = Date.now(),
) {
  for (const ra of agents) {
    if (ra.visual.animation === 'fired') continue;
    const ev = agentEvolution(ra.agent);
    if (!ev.tier.ground) continue;

    const accent = ra.agent.visualProfile?.accent ?? '#3da9fc';
    const fx = ra.visual.x;
    const fy = ra.visual.y + 1.5; // just under the existing foot shadow
    const k = ev.tier.intensity;

    ctx.save();

    // Soft accent aura on the floor (Elite+) — premium glow, low and wide
    if (ev.tier.glow) {
      const grad = ctx.createRadialGradient(fx, fy, 1, fx, fy, 16);
      grad.addColorStop(0, hexA(accent, 0.22 * k));
      grad.addColorStop(1, hexA(accent, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(fx, fy, 16, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Base ring — a clean elliptical signature (Professional+)
    ctx.lineWidth = 1;
    ctx.strokeStyle = hexA(accent, 0.35 + 0.4 * k);
    ctx.beginPath();
    ctx.ellipse(fx, fy, 11, 3.4, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Inner accent ring for Elite+ (stronger presence, double-line refinement)
    if (ev.tier.glow) {
      ctx.strokeStyle = hexA(accent, 0.25 + 0.35 * k);
      ctx.beginPath();
      ctx.ellipse(fx, fy, 7.5, 2.2, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Legendary: slow rotating orbital nodes around the base — elegant, minimal
    if (ev.tier.orbit) {
      const t = nowMs / 2600;
      for (let i = 0; i < 3; i++) {
        const a = t + (i * (Math.PI * 2)) / 3;
        const ox = fx + Math.cos(a) * 12.5;
        const oy = fy + Math.sin(a) * 3.8;
        ctx.fillStyle = hexA(accent, 0.9);
        ctx.beginPath();
        ctx.arc(ox, oy, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

// ─── Canvas drawing — CREST layer (drawn AFTER the sprite) ─────────────────────
// A small, refined mark above the head. Grows from a clean tick → chevron →
// iconic crown. Plus a faint breathing halo for Legendary (futuristic presence).

export function drawEvolutionCrest(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
  nowMs: number = Date.now(),
) {
  for (const ra of agents) {
    if (ra.visual.animation === 'fired' || ra.agent.status === 'onboarding') continue;
    const ev = agentEvolution(ra.agent);
    if (ev.tier.crest === 'none') continue;

    const accent = ra.agent.visualProfile?.accent ?? '#3da9fc';
    const cx = ra.visual.x;
    // Crest sits above the head; sprite is ~30px tall from the foot point.
    const headY = ra.visual.y - ra.visual.bobOffset - 30;
    const k = ev.tier.intensity;

    ctx.save();

    // Legendary breathing halo behind the crest — slow, elegant
    if (ev.tier.orbit) {
      const pulse = 0.5 + 0.5 * Math.sin(nowMs / 1400);
      const r = 4 + pulse * 1.6;
      const grad = ctx.createRadialGradient(cx, headY, 0, cx, headY, r + 3);
      grad.addColorStop(0, hexA(accent, 0.5));
      grad.addColorStop(1, hexA(accent, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, headY, r + 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = hexA(accent, 0.7 + 0.3 * k);
    ctx.strokeStyle = hexA(accent, 0.85);
    ctx.lineWidth = 1;

    if (ev.tier.crest === 'tick') {
      // Professional: a single clean rank tick
      ctx.fillRect(cx - 0.5, headY - 1, 1.5, 3);
    } else if (ev.tier.crest === 'chevron') {
      // Elite: a refined chevron (galón)
      ctx.beginPath();
      ctx.moveTo(cx - 3, headY + 1);
      ctx.lineTo(cx, headY - 2);
      ctx.lineTo(cx + 3, headY + 1);
      ctx.stroke();
    } else if (ev.tier.crest === 'icon') {
      // Legendary: an iconic 5-point mini crown
      drawCrown(ctx, cx, headY, accent);
    }

    ctx.restore();
  }
}

function drawCrown(ctx: CanvasRenderingContext2D, cx: number, cy: number, accent: string) {
  ctx.fillStyle = hexA(accent, 0.95);
  ctx.beginPath();
  // Crown silhouette: base + three spikes
  ctx.moveTo(cx - 4, cy + 2);
  ctx.lineTo(cx - 4, cy);
  ctx.lineTo(cx - 2, cy + 0.5);
  ctx.lineTo(cx, cy - 2.5);
  ctx.lineTo(cx + 2, cy + 0.5);
  ctx.lineTo(cx + 4, cy);
  ctx.lineTo(cx + 4, cy + 2);
  ctx.closePath();
  ctx.fill();
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** hex (#rrggbb) + alpha (0..1) → rgba() string */
function hexA(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgba(${r},${g},${b},${clamp01(alpha)})`;
}
