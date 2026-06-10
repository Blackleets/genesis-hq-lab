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
 * Visual states. `warning` and `executing` are rendered but never
 * self-triggered in Phase 2 — they are reserved for real system events
 * (Phase 3) so the office never fakes trading activity.
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

export interface AgentDialogueMessage {
  text: string;
  priority: DialoguePriority;
}

/** A bubble currently shown above an agent's head. */
export interface ActiveDialogueBubble {
  id: number;
  agentId: OfficeAgentId;
  text: string;
  priority: DialoguePriority;
  startedAt: number;
  expiresAt: number;
}

/**
 * What the office knows about the real system. Phase 3 keeps this minimal
 * and always offline; Phase 4 fills it from /api/crypto/* so dialogue can
 * reference real events. While `liveDataConnected` is false, only the
 * generic honest catalog is ever spoken.
 */
export interface LiveOfficeState {
  liveDataConnected: boolean;
}

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
