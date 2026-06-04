// ─────────────────────────────────────────────────────────────────────────
// GENESIS WORKER — Reusable Sprite Design Specification (single source of truth)
// ─────────────────────────────────────────────────────────────────────────
//
// Genesis Workers are the ORIGINAL pixel mascots of Genesis HQ. They are drawn
// procedurally from <rect> primitives (see GenesisWorker.tsx) — no external art
// and no third-party brand characters are used. This module is the only place
// that decides:
//   1. Department color coding   (paletteForAgent)
//   2. Animation state mapping   (workerAnimForAgent)
//   3. Accessory accents         (taken from the agent's existing visualProfile)
//
// HARD RULE: only colors already used by Genesis HQ are referenced here, so the
// premium dark HQ aesthetic (#0a0c12 background) is never disturbed.
//
// Worker silhouette rules (cute-tech / cyber-office):
//   • rounded blocky body, 1px dark outline, clean readable silhouette
//   • a darker "visor" face panel with two expressive minimal eyes
//   • subtle department-colored glow
//   • department color = body fill, accent = trim/eye-shine/accessory
// ─────────────────────────────────────────────────────────────────────────

import type { Agent, AgentStatus, Department, MovementState } from '@core/types/genesis';

/** The nine canonical Genesis tokens — identical to the office zone palette. */
export const GENESIS_TOKENS = {
  outline: '#0a0c12',
  gold: '#ffd24a',
  goldSoft: '#fff0b8',
  green: '#00ff9c',
  blue: '#3da9fc',
  deepBlue: '#1f6fb0',
  cyan: '#22d3ee',
  red: '#ff4757',
  amber: '#ffb547',
  purple: '#a855f7',
  violet: '#7c5cff',
  gray: '#5b6678',
} as const;

export interface WorkerPalette {
  /** body fill — the department's identity color */
  primary: string;
  /** trim, eye-shine, accessory highlight */
  accent: string;
  /** soft halo color behind the worker */
  glow: string;
}

/**
 * Department visual system. Each department reads as a distinct color the
 * moment a worker appears, exactly like the brief's color coding:
 *   CEO/Orchestrator gold · Trading green · Risk red · Marketing purple ·
 *   Research orange · Memory blue · Security gray.
 * All hexes already exist elsewhere in the app — nothing new is introduced.
 */
export const DEPARTMENT_PALETTE: Record<Department, WorkerPalette> = {
  // CEO / Orchestrator — calm gold authority
  'Board Room':      { primary: GENESIS_TOKENS.gold,     accent: GENESIS_TOKENS.goldSoft, glow: GENESIS_TOKENS.gold },
  // Trading — fast green
  'Market Room':     { primary: GENESIS_TOKENS.green,    accent: GENESIS_TOKENS.blue,     glow: GENESIS_TOKENS.green },
  'Execution Desk':  { primary: GENESIS_TOKENS.green,    accent: GENESIS_TOKENS.cyan,     glow: GENESIS_TOKENS.green },
  // Risk / Audit — alert red
  'Risk Office':     { primary: GENESIS_TOKENS.red,      accent: GENESIS_TOKENS.amber,    glow: GENESIS_TOKENS.red },
  'Audit Office':    { primary: GENESIS_TOKENS.red,      accent: GENESIS_TOKENS.amber,    glow: GENESIS_TOKENS.red },
  // Marketing / Growth — communicative purple
  'Growth Room':     { primary: GENESIS_TOKENS.purple,   accent: GENESIS_TOKENS.violet,   glow: GENESIS_TOKENS.purple },
  'Debate Room':     { primary: GENESIS_TOKENS.purple,   accent: GENESIS_TOKENS.violet,   glow: GENESIS_TOKENS.purple },
  // Research / Strategy / HR review — orange data work
  'Strategy Lab':    { primary: GENESIS_TOKENS.amber,    accent: GENESIS_TOKENS.blue,     glow: GENESIS_TOKENS.amber },
  'Genesis HR':      { primary: GENESIS_TOKENS.amber,    accent: GENESIS_TOKENS.blue,     glow: GENESIS_TOKENS.amber },
  // Memory — archival blue
  'Memory Archive':  { primary: GENESIS_TOKENS.deepBlue, accent: GENESIS_TOKENS.cyan,     glow: GENESIS_TOKENS.cyan },
  // Design / Operations — supporting cool tones
  'Design Studio':   { primary: GENESIS_TOKENS.cyan,     accent: GENESIS_TOKENS.violet,   glow: GENESIS_TOKENS.cyan },
  'Operations Room': { primary: GENESIS_TOKENS.blue,     accent: GENESIS_TOKENS.cyan,     glow: GENESIS_TOKENS.blue },
  // Security / Watcher — dark gray patrol
  'Special Ops':     { primary: GENESIS_TOKENS.gray,     accent: GENESIS_TOKENS.cyan,     glow: GENESIS_TOKENS.gray },
};

/**
 * Resolve a worker's palette. The department drives identity, but if an agent
 * carries its own visualProfile.primary we respect it as the body color so
 * existing seeded agents keep their established hues (no visual regressions).
 */
export function paletteForAgent(agent: Agent): WorkerPalette {
  const dept = DEPARTMENT_PALETTE[agent.department];
  const base = dept ?? { primary: GENESIS_TOKENS.violet, accent: GENESIS_TOKENS.gold, glow: GENESIS_TOKENS.violet };
  return {
    primary: agent.visualProfile?.primary || base.primary,
    accent: agent.visualProfile?.accent || base.accent,
    glow: base.glow,
  };
}

// ── Animation system ───────────────────────────────────────────────────────
// Nine premium states. Movement always wins (a moving worker walks), otherwise
// the live work status decides the animation. Every state maps to a CSS class
// (.gw-anim-*) defined in index.css.

export type WorkerAnim =
  | 'idle'
  | 'walking'
  | 'working'
  | 'debating'
  | 'thinking'
  | 'alert'
  | 'resting'
  | 'celebrating'
  | 'blocked';

const STATUS_ANIM: Record<AgentStatus, WorkerAnim> = {
  onboarding: 'idle',
  idle: 'idle',
  moving: 'walking',
  working: 'working',
  thinking: 'thinking',
  debating: 'debating',
  learning: 'thinking',
  waiting_review: 'idle',
  warning: 'alert',
  failed: 'blocked',
  suspended: 'resting',
  fired: 'blocked',
  promoted: 'celebrating',
  retraining: 'thinking',
};

/** Live work → animation. Movement state overrides a still status. */
export function workerAnimForAgent(status: AgentStatus, movementState: MovementState): WorkerAnim {
  if (movementState === 'moving') return 'walking';
  return STATUS_ANIM[status] ?? 'idle';
}

/** Eye shape per animation — keeps faces expressive and readable. */
export type EyeShape = 'open' | 'wide' | 'focused' | 'closed' | 'happy';

export function eyeShapeForAnim(anim: WorkerAnim): EyeShape {
  switch (anim) {
    case 'alert': return 'wide';
    case 'working':
    case 'thinking': return 'focused';
    case 'resting': return 'closed';
    case 'celebrating': return 'happy';
    case 'blocked': return 'closed';
    default: return 'open';
  }
}
