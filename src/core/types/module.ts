// Re-export the live module entity shape used by the store.
// The static catalogue still lives in src/data/moduleRegistry.ts; this
// type adds the runtime fields the store tracks.

import type { ModuleId, ModuleState } from '@core/data/moduleRegistry';

export interface ModuleEntity {
  id: ModuleId;
  state: ModuleState;
  unlockedAt?: string;
  isImplemented: boolean;
  isLocked: boolean;
}

export type { ModuleId, ModuleState };
