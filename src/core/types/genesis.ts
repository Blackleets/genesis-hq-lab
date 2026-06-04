// Core domain types for Genesis HQ Lab.
// Agents have BOTH visual position and live movement state because the
// office is the visual representation of the live system.

export type AgentStatus =
  | 'onboarding'
  | 'idle'
  | 'moving'
  | 'working'
  | 'thinking'
  | 'debating'
  | 'learning'
  | 'waiting_review'
  | 'warning'
  | 'failed'
  | 'suspended'
  | 'fired'
  | 'promoted'
  | 'retraining';

export type AgentRank = 'intern' | 'junior' | 'operator' | 'senior' | 'lead' | 'executive';

export type Department =
  | 'Market Room'
  | 'Risk Office'
  | 'Debate Room'
  | 'Strategy Lab'
  | 'Memory Archive'
  | 'Execution Desk'
  | 'Genesis HR'
  | 'Board Room'
  | 'Audit Office'
  | 'Design Studio'
  | 'Growth Room'
  | 'Operations Room'
  | 'Special Ops';

export type Archetype =
  | 'commander' | 'analyst' | 'sentinel' | 'scientist' | 'listener'
  | 'mediator' | 'archivist' | 'guardian' | 'reviewer'
  | 'engineer' | 'designer' | 'broadcaster' | 'operator' | 'intern';

export interface VisualProfile {
  archetype: Archetype;
  primary: string;
  accent: string;
  hair?: string;
  pants?: string;
  accessory?: 'shield' | 'lock' | 'glasses' | 'crown' | 'clipboard' | 'flask' | 'headset' | 'book' | 'mic' | 'wrench' | 'palette' | 'none';
}

export type Pose = 'seated' | 'standing';
export type Facing = 'north' | 'south' | 'east' | 'west';
export type MovementState = 'still' | 'moving' | 'arrived';

import type { RoomId } from '@core/types/office';
import type { TaskType } from '@core/types/task';

export interface AgentPosition {
  x: number;
  y: number;
  facing?: Facing;
  pose?: Pose;
}

/** A live Agent — entity in the store, not a static seed. */
export interface Agent {
  id: string;
  name: string;
  role: { es: string; en: string } | string;
  department: Department;
  rank: AgentRank;
  status: AgentStatus;
  /** present when status is working/waiting_review */
  currentTaskId: string | null;
  /** bilingual snapshot of current task title (for tooltips/quick display) */
  currentTask: { es: string; en: string } | null;
  mistakeCount?: number;
  trustScore: number;
  learningScore: number;
  visualProfile: VisualProfile;
  position: AgentPosition;
  targetPosition?: { x: number; y: number };
  currentRoom: RoomId;
  targetRoom?: RoomId;
  movementState: MovementState;
  /** Onboarding fields (24h flow). Both timestamps stored as ISO strings. */
  onboardingStartedAt?: string;
  onboardingEndsAt?: string;
  hiredAt?: string;
  isVisualSeed: boolean;
  emoji?: string | null;
  /** the kinds of tasks this agent can handle — used for auto-assignment */
  capabilities: TaskType[];
  totalPnL?: number;
  tradeCount?: number;
  winRate?: number;
  specialization?: 'quant' | 'risk' | 'analyst' | 'mentor';
  /** consecutive idle ticks without a task (used for auto-training trigger) */
  idleTicks?: number;
}
