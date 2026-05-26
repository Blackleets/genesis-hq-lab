// Thin task helpers used by UI to author tasks correctly.
// Heavy state mutation happens inside genesisStore.actions.

import type { TaskType } from '../types/task';
import type { RoomId } from '../types/office';

export function defaultRoomForTaskType(type: TaskType): RoomId {
  switch (type) {
    case 'market_scan':           return 'market-desk';
    case 'risk_review':           return 'risk-bunker';
    case 'memory_archive':        return 'memory-archive';
    case 'hr_review':
    case 'agent_onboarding':
    case 'agent_training':        return 'hr-pod';
    case 'decision_review':
    case 'module_unlock_review':  return 'board-room';
    case 'office_upgrade':
    case 'maintenance':           return 'open-workspace';
    case 'system_check':
    case 'language_update':
    default:                       return 'open-workspace';
  }
}

export function defaultEstimateMs(type: TaskType): number {
  switch (type) {
    case 'market_scan':           return 1000 * 60 * 6;
    case 'risk_review':           return 1000 * 60 * 5;
    case 'memory_archive':        return 1000 * 60 * 4;
    case 'hr_review':             return 1000 * 60 * 5;
    case 'agent_onboarding':      return 1000 * 60 * 60 * 24;
    case 'office_upgrade':        return 1000 * 60 * 8;
    case 'decision_review':       return 1000 * 60 * 10;
    case 'module_unlock_review':  return 1000 * 60 * 12;
    default:                       return 1000 * 60 * 5;
  }
}
