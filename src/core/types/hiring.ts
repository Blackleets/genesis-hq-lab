// Hiring candidates for the Hiring Queue.

import type { Archetype, Department } from '@core/types/genesis';

export type UnlockCondition =
  | 'tasks-pending-many'
  | 'decisions-5-recorded'
  | 'module-unlocked-decisions'
  | 'module-unlocked-markets'
  | 'learning-level-up'
  | 'office-needs-upgrade'
  | 'errors-keep-happening'
  | 'role-gap-detected'
  | 'manual';

export type HiringState = 'pending' | 'unlockable' | 'in-progress' | 'visual-seed';

export interface HiringCandidate {
  id: string;
  name: { es: string; en: string };
  role: { es: string; en: string };
  department: Department;
  archetype: Archetype;
  unlockReason: { es: string; en: string };
  unlockCondition: UnlockCondition;
  state: HiringState;
  /** when did this candidate become unlockable */
  unlockedAt?: string;
}
