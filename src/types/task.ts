// Task — the unit of work in Genesis. Drives agent.status and movement.

import type { RoomId } from './office';
import type { ModuleId } from '../data/moduleRegistry';

export type TaskType =
  | 'market_scan'
  | 'risk_review'
  | 'memory_archive'
  | 'hr_review'
  | 'agent_onboarding'
  | 'agent_training'
  | 'office_upgrade'
  | 'module_unlock_review'
  | 'decision_review'
  | 'maintenance'
  | 'language_update'
  | 'system_check';

export type TaskStatus =
  | 'queued'
  | 'assigned'
  | 'moving'
  | 'working'
  | 'blocked'
  | 'waiting_review'
  | 'completed'
  | 'failed'
  | 'archived';

export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

export interface Task {
  id: string;
  title: { es: string; en: string };
  description: { es: string; en: string };
  type: TaskType;
  assignedAgentIds: string[];
  room: RoomId;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  blockedReason?: { es: string; en: string };
  sourceModule: ModuleId;
  /** estimated work duration in ms (lab seed timer) */
  estimatedMs: number;
  evidence?: string[];
  output?: { es: string; en: string };
  isSeed: boolean;
  isReal: boolean;
  isVisualSeed: boolean;
  /** voiced line that fires when the task starts (drives a bubble) */
  startBubble?: { es: string; en: string };
}
