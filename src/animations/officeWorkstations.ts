import type { RoomId } from '@core/types/office';

export interface WorkstationPoint {
  id: string;
  room: RoomId | 'fired-archive';
  x: number;
  y: number;
  kind:
    | 'desk'
    | 'onboarding'
    | 'hr'
    | 'fired'
    | 'manager'
    | 'debate'
    | 'board'
    | 'locked'
    | 'archive';
}

export const OFFICE_WORKSTATIONS: Record<WorkstationPoint['room'], WorkstationPoint[]> = {
  'market-desk': [
    { id: 'market-1', room: 'market-desk', x: 78, y: 110, kind: 'desk' },
    { id: 'market-2', room: 'market-desk', x: 124, y: 110, kind: 'desk' },
    { id: 'market-3', room: 'market-desk', x: 170, y: 110, kind: 'desk' },
  ],
  'strategy-lab': [
    { id: 'strategy-1', room: 'strategy-lab', x: 286, y: 128, kind: 'desk' },
    { id: 'strategy-2', room: 'strategy-lab', x: 354, y: 128, kind: 'desk' },
  ],
  'risk-bunker': [
    { id: 'risk-1', room: 'risk-bunker', x: 474, y: 130, kind: 'desk' },
    { id: 'risk-2', room: 'risk-bunker', x: 546, y: 130, kind: 'desk' },
  ],
  'open-workspace': [
    { id: 'open-1', room: 'open-workspace', x: 152, y: 252, kind: 'desk' },
    { id: 'open-2', room: 'open-workspace', x: 244, y: 224, kind: 'desk' },
    { id: 'open-3', room: 'open-workspace', x: 320, y: 240, kind: 'desk' },
  ],
  'memory-archive': [
    { id: 'memory-1', room: 'memory-archive', x: 574, y: 224, kind: 'archive' },
    { id: 'memory-2', room: 'memory-archive', x: 632, y: 238, kind: 'archive' },
  ],
  'debate-room': [
    { id: 'debate-1', room: 'debate-room', x: 94, y: 394, kind: 'debate' },
    { id: 'debate-2', room: 'debate-room', x: 122, y: 394, kind: 'debate' },
  ],
  'board-room': [
    { id: 'board-1', room: 'board-room', x: 300, y: 390, kind: 'board' },
    { id: 'board-2', room: 'board-room', x: 334, y: 390, kind: 'manager' },
  ],
  'hr-pod': [
    { id: 'hr-1', room: 'hr-pod', x: 520, y: 394, kind: 'hr' },
    { id: 'onboarding-1', room: 'hr-pod', x: 548, y: 382, kind: 'onboarding' },
    { id: 'onboarding-2', room: 'hr-pod', x: 548, y: 414, kind: 'onboarding' },
  ],
  'execution-desk': [
    { id: 'execution-1', room: 'execution-desk', x: 730, y: 406, kind: 'locked' },
  ],
  'fired-archive': [
    { id: 'fired-1', room: 'fired-archive', x: 458, y: 398, kind: 'fired' },
    { id: 'fired-2', room: 'fired-archive', x: 486, y: 398, kind: 'fired' },
  ],
};

export function workstationsForRoom(room: WorkstationPoint['room']): WorkstationPoint[] {
  return OFFICE_WORKSTATIONS[room] ?? [];
}
