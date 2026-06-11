// officeLiveEvents — Phase 3: real system events drive agent states.
//
// officeTypes reserved the 'warning' and 'executing' states for real system
// events ("never self-triggered"). This module is the ONLY place that
// triggers them, and every trigger derives from a real LiveOfficeState
// field polled from /api/crypto/* — never invented:
//
//   · executing  — openPositionsCount CHANGED between polls (a real position
//                  was opened or closed) → the execution agent visibly
//                  executes for a short window at its desk.
//   · warning    — the real trade-autopsy severity (diagnostics) reads as
//                  high/critical → the risk agent stays in alert posture
//                  while the condition holds.
//   · monitoring — the portfolio agent only monitors while there ARE real
//                  open positions; zero positions reads as idle (no theater).
//   · engine down (offline/unknown) — nobody pretends to work: work states
//                  collapse to idle until the backend is live again.
//
// Overrides are applied AFTER stepOfficeAgents each frame and never
// interrupt walking, so pathfinding and the wander loop stay untouched.

import type { LiveOfficeAgent, LiveOfficeState } from './officeTypes';

/** How long the execution agent visibly executes after a real position change. */
const EXECUTING_FLASH_MS = 8_000;

/** Autopsy severities that put the risk agent in alert posture. */
const HIGH_RISK_SEVERITIES = ['critical', 'severe', 'high'];

export interface LiveEventsRuntime {
  /** openPositionsCount seen on the previous frame (null until first real value) */
  prevOpenPositions: number | null;
  /** timestamp (same clock as the RAF loop) until which execution flashes */
  executingUntil: number;
}

export function createLiveEventsRuntime(): LiveEventsRuntime {
  return { prevOpenPositions: null, executingUntil: 0 };
}

function isHighRisk(riskStatus: string | null): boolean {
  if (!riskStatus) return false;
  const normalized = riskStatus.toLowerCase();
  return HIGH_RISK_SEVERITIES.some((s) => normalized.includes(s));
}

/**
 * Applies real-event overrides to the agents for the current frame.
 * Mutates agents in place (same contract as stepOfficeAgents).
 */
export function applyLiveOfficeEvents(
  agents: LiveOfficeAgent[],
  live: LiveOfficeState,
  rt: LiveEventsRuntime,
  now: number,
): void {
  // Detect a real position change between polls (open OR close).
  if (live.openPositionsCount !== null) {
    if (rt.prevOpenPositions !== null && live.openPositionsCount !== rt.prevOpenPositions) {
      rt.executingUntil = now + EXECUTING_FLASH_MS;
    }
    rt.prevOpenPositions = live.openPositionsCount;
  }

  const engineDown = live.engineStatus === 'offline' || live.engineStatus === 'unknown';
  const highRisk = isHighRisk(live.riskStatus);

  for (const agent of agents) {
    if (agent.state === 'walking') continue; // never interrupt movement

    // Anti-fake rule: backend down → no agent pretends to work.
    if (engineDown) {
      if (agent.state !== 'idle' && agent.state !== 'thinking') {
        agent.state = 'idle';
      }
      continue;
    }

    switch (agent.def.id) {
      case 'risk': {
        if (highRisk && agent.def.allowedStates.includes('warning')) {
          agent.state = 'warning';
          // keep the posture at least briefly past the next decide() tick
          agent.stateUntil = Math.max(agent.stateUntil, now + 4_000);
        } else if (agent.state === 'warning') {
          // condition cleared — only this module sets warning, so demote
          agent.state = 'idle';
        }
        break;
      }
      case 'execution': {
        if (now < rt.executingUntil
          && agent.zone === agent.def.homeZone
          && agent.def.allowedStates.includes('executing')) {
          agent.state = 'executing';
        } else if (agent.state === 'executing') {
          agent.state = 'monitoring';
        }
        break;
      }
      case 'portfolio': {
        if (agent.zone !== agent.def.homeZone) break;
        if ((live.openPositionsCount ?? 0) > 0) {
          if (agent.state === 'idle') agent.state = 'monitoring';
        } else if (agent.state === 'monitoring') {
          agent.state = 'idle'; // nothing real to monitor
        }
        break;
      }
      default:
        break;
    }
  }
}
