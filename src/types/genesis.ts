// Trimmed subset of shared/types.ts from the main genesis project.
// Only the fields the lab UI consumes. Do not extend without updating
// docs/AI_HANDOFF.md.

export type AgentStatus =
  | 'idle'
  | 'working'
  | 'thinking'
  | 'debating'
  | 'learning'
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
  | 'commander'
  | 'analyst'
  | 'sentinel'
  | 'scientist'
  | 'listener'
  | 'mediator'
  | 'archivist'
  | 'guardian'
  | 'reviewer'
  | 'engineer'
  | 'designer'
  | 'broadcaster'
  | 'operator';

export interface VisualProfile {
  archetype: Archetype;
  primary: string;
  accent: string;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  department: Department;
  status: AgentStatus;
  currentTask: string | null;
  rank: AgentRank;
  visualProfile: VisualProfile;
  emoji: string | null;
}
