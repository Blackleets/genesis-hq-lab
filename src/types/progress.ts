// Derived progress metrics. Computed from store state.

export interface GenesisProgress {
  bornAt: string;            // ISO timestamp of first boot
  ageHours: number;          // hours since bornAt
  activeAgents: number;
  onboardingAgents: number;
  firedAgents: number;
  hiringQueue: number;
  tasksQueued: number;
  tasksActive: number;
  tasksCompleted: number;
  tasksFailed: number;
  modulesUnlocked: number;
  officeUpgradesCompleted: number;
  /** 0..1; rough composite for the lab */
  learningLevel: number;
  /** 0..1; lab composite */
  companyHealth: number;
}
