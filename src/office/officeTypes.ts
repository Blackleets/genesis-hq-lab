// officeTypes — shared types for the live tile office agents (Phase 2).

import type { OfficeZoneId } from './officeZones';

export type OfficeAgentId = 'scout' | 'analyst' | 'execution' | 'risk' | 'portfolio';

export type OfficeAgentRoleName =
  | 'market_scanner'
  | 'risk_manager'
  | 'execution_operator'
  | 'analyst'
  | 'portfolio_monitor';

/**
 * Visual states. `warning` and `executing` are never self-triggered by the
 * wander loop — they are driven exclusively by real system events through
 * officeLiveEvents (Phase 3): a real autopsy severity puts Risk in alert,
 * and a real open-positions change makes Execution visibly execute. The
 * office never fakes trading activity.
 */
export type AgentState =
  | 'idle'
  | 'walking'
  | 'scanning'
  | 'thinking'
  | 'warning'
  | 'executing'
  | 'monitoring';

export interface AgentDefinition {
  id: OfficeAgentId;
  name: string;
  role: OfficeAgentRoleName;
  /** accent color for label + state markers */
  accent: string;
  /** index into OFFICE_CHARACTERS on the tilesheet */
  spriteIndex: number;
  homeZone: OfficeZoneId;
  /** full set of states this agent may display */
  allowedStates: AgentState[];
  /** states the agent cycles through while at its home desk (Phase 2) */
  workStates: AgentState[];
}

export interface Waypoint {
  x: number;
  y: number;
}

/** Routine status chatter vs. event-driven alerts (alerts win slots). */
export type DialoguePriority = 'routine' | 'alert';

export interface LocalizedDialogueText {
  es: string;
  en: string;
}

export interface AgentDialogueMessage {
  text: LocalizedDialogueText;
  priority: DialoguePriority;
}

/** A bubble currently shown above an agent's head. */
export interface ActiveDialogueBubble {
  id: number;
  agentId: OfficeAgentId;
  text: LocalizedDialogueText;
  priority: DialoguePriority;
  startedAt: number;
  expiresAt: number;
}

/** Derived from real loop heartbeats; 'unknown' when diagnostics unreachable. */
export type EngineStatus = 'online' | 'degraded' | 'offline' | 'unknown';

/**
 * What the office knows about the real system, read-only from existing
 * /api/crypto/* endpoints (see useLiveOfficeState). Every field is either
 * real data or null — the UI renders nulls as unavailable/waiting and
 * never substitutes invented numbers. While `liveDataConnected` is false,
 * only the generic honest dialogue catalog is ever spoken.
 */
export interface LiveOfficeState {
  liveDataConnected: boolean;
  engineStatus: EngineStatus;
  /** real open positions count, or null when the overview is unreachable */
  openPositionsCount: number | null;
  /** autopsy recommendation severity (real), or null when unavailable */
  riskStatus: string | null;
  /** latest real commentary line, or null when unavailable */
  latestActivity: string | null;
  /** local time of the last successful refresh, or null before one */
  lastUpdateTs: number | null;
}

export const DEFAULT_LIVE_OFFICE_STATE: LiveOfficeState = {
  liveDataConnected: false,
  engineStatus: 'unknown',
  openPositionsCount: null,
  riskStatus: null,
  latestActivity: null,
  lastUpdateTs: null,
};

/** Mutable runtime state. Positions are the agent's feet, in canvas px. */
export interface LiveOfficeAgent {
  def: AgentDefinition;
  x: number;
  y: number;
  state: AgentState;
  facing: 1 | -1;
  /** remaining waypoints when walking */
  path: Waypoint[];
  pathIndex: number;
  zone: OfficeZoneId;
  targetZone: OfficeZoneId | null;
  /** timestamp (ms) after which the agent picks its next action */
  stateUntil: number;
  /** per-agent offset so idle breathing isn't synchronized */
  bobPhase: number;
}
