// Office rooms — fixed metadata for movement targets and click handlers.

export type RoomId =
  | 'market-desk'
  | 'strategy-lab'
  | 'risk-bunker'
  | 'open-workspace'
  | 'memory-archive'
  | 'debate-room'
  | 'board-room'
  | 'hr-pod'
  | 'execution-desk';

export interface Room {
  id: RoomId;
  /** i18n labels for header / breadcrumbs */
  label: { es: string; en: string };
  /** entry point an agent walks to when assigned a task in this room */
  entryPoint: { x: number; y: number };
  /** color used for halos, bubbles, banners */
  color: string;
}

export type UpgradeStatus = 'requested' | 'in-progress' | 'completed';

export interface OfficeUpgrade {
  id: string;
  title: { es: string; en: string };
  room: RoomId;
  reason: { es: string; en: string };
  status: UpgradeStatus;
  /** if a virtual contractor is currently working on it */
  assignedContractorId?: string;
  startedAt?: string;
  completedAt?: string;
  /** human-readable summary of what changes visually when done */
  impact: { es: string; en: string };
}
