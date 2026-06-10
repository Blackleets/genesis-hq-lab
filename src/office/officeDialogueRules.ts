// officeDialogueRules — the allowed dialogue catalog and pacing rules
// for the live tile office (Phase 3).
//
// Honesty contract: without real system data the agents may only speak
// generic status lines (scanning / waiting / monitoring / analyzing /
// no confirmed edge). Result-sounding language is structurally banned
// via FORBIDDEN_PATTERNS, which generateAgentDialogue enforces at
// runtime on every candidate message — including future Phase 4 ones.

import type {
  AgentDialogueMessage,
  AgentState,
  OfficeAgentId,
} from './officeTypes';

/** Screen budget: never more than this many bubbles at once. */
export const MAX_VISIBLE_BUBBLES = 2;

/** How long a bubble stays up (random within range). */
export const BUBBLE_MIN_MS = 3000;
export const BUBBLE_MAX_MS = 5000;

/** Per-agent silence between their own bubbles (random within range). */
export const AGENT_COOLDOWN_MIN_MS = 14_000;
export const AGENT_COOLDOWN_MAX_MS = 26_000;

/** Minimum gap between any two bubble starts, office-wide. */
export const GLOBAL_BUBBLE_GAP_MS = 2_500;

/**
 * Claims that may never appear unless they come from a verified real
 * event (Phase 4 will attach provenance; until then nothing passes).
 */
export const FORBIDDEN_PATTERNS: RegExp[] = [
  /profit/i,
  /pnl/i,
  /trade\s+(opened|closed|filled)/i,
  /position\s+opened/i,
  /alpha/i,
  /tp\s+hit/i,
  /sl\s+hit/i,
  /take\s+profit/i,
  /stop\s+loss\s+hit/i,
  /\bwin(ner|ning)?\b/i,
  /signal\s+(found|confirmed)/i,
  /\+\d+(\.\d+)?\s*%/,
];

export function isMessageAllowed(text: string): boolean {
  return !FORBIDDEN_PATTERNS.some((re) => re.test(text));
}

const msg = (text: string): AgentDialogueMessage => ({ text, priority: 'routine' });

/**
 * Generic honest lines, by agent and visual state. States missing here
 * (walking, warning, executing) produce silence on purpose: warning and
 * executing may only speak when driven by a real event in Phase 4.
 */
export const BASE_MESSAGES: Record<OfficeAgentId, Partial<Record<AgentState, AgentDialogueMessage[]>>> = {
  scout: {
    scanning: [msg('Scanning market structure.'), msg('No clean signal yet.')],
    thinking: [msg('Waiting for valid setup.'), msg('No clean signal yet.')],
    idle:     [msg('Waiting for valid setup.')],
  },
  risk: {
    thinking: [msg('Risk check active.'), msg('Waiting for clean conditions.')],
    idle:     [msg('No forced entries.')],
  },
  execution: {
    monitoring: [msg('Execution desk ready.'), msg('No active order confirmed.')],
    idle:       [msg('Standing by.')],
  },
  analyst: {
    scanning: [msg('Analyzing setup quality.'), msg('Market context under review.')],
    thinking: [msg('No confirmed edge yet.')],
    idle:     [msg('Market context under review.')],
  },
  portfolio: {
    monitoring: [msg('Monitoring exposure.'), msg('Portfolio check active.')],
    thinking:   [msg('Waiting for confirmed data.')],
    idle:       [msg('Portfolio check active.')],
  },
};
