// System events. The bubble layer and the activity feed both read from
// the same event log so visuals can never diverge from logic.

export type EventKind =
  | 'system.boot'
  | 'agent.hired'
  | 'agent.onboarding.start'
  | 'agent.onboarding.end'
  | 'agent.fired'
  | 'agent.promoted'
  | 'agent.suspended'
  | 'agent.retraining'
  | 'agent.warning'
  | 'agent.moving'
  | 'agent.arrived'
  | 'agent.says'           // pure voice line (no business event)
  | 'task.created'
  | 'task.assigned'
  | 'task.moving'
  | 'task.started'
  | 'task.progress'
  | 'task.blocked'
  | 'task.completed'
  | 'task.failed'
  | 'office.upgrade.requested'
  | 'office.upgrade.in_progress'
  | 'office.upgrade.completed'
  | 'module.unlocked'
  | 'language.changed'
  | 'trade.opened'
  | 'trade.closed'
  | 'trade.profit'
  | 'trade.loss'
  | 'agent.mentoring'
  | 'agent.auto_fired'
  | 'agent.auto_suspended'
  | 'agent.self_trained';

export type EventSeverity = 'info' | 'warn' | 'critical';

export interface SystemEvent {
  id: string;
  at: string; // ISO timestamp
  kind: EventKind;
  severity: EventSeverity;
  message: { es: string; en: string };
  /** if set, this event will be voiced as a bubble over this agent */
  voicedBy?: string;
  voicedText?: { es: string; en: string };
  agentId?: string;
  taskId?: string;
  upgradeId?: string;
  moduleId?: string;
  /** Hard requirement: every event in the lab is marked. */
  isVisualSeed: boolean;
}
