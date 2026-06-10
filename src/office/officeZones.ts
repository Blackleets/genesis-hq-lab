// officeZones — fixed work zones inside the tile office (Phase 2).
//
// Each zone has an anchor (canonical standing point) and a small wander
// area agents can pick random spots in. Areas were chosen against the
// furniture footprints in officeLayout so they stay walkable.

export type OfficeZoneId =
  | 'researchDesk'
  | 'executionDesk'
  | 'riskDesk'
  | 'analyticsScreen'
  | 'serverRack'
  | 'portfolioDesk'
  | 'restArea'
  | 'centralFloor';

export interface OfficeZone {
  id: OfficeZoneId;
  label: string;
  /** canonical standing point (feet, canvas px) */
  anchor: { x: number; y: number };
  /** wander rect agents pick random points in */
  area: { x: number; y: number; w: number; h: number };
  /** zone identity color (Phase 5) */
  accent: string;
  /** subtle floor tint covering desk + work area; omitted = no tint */
  tint?: { x: number; y: number; w: number; h: number };
}

export const OFFICE_ZONES: Record<OfficeZoneId, OfficeZone> = {
  researchDesk:    { id: 'researchDesk',    label: 'Research',  anchor: { x: 96,  y: 230 }, area: { x: 70,  y: 228, w: 70, h: 30 },  accent: '#38bdf8', tint: { x: 44,  y: 124, w: 104, h: 140 } },
  analyticsScreen: { id: 'analyticsScreen', label: 'Analytics', anchor: { x: 230, y: 230 }, area: { x: 200, y: 228, w: 70, h: 30 },  accent: '#c084fc', tint: { x: 176, y: 124, w: 112, h: 140 } },
  executionDesk:   { id: 'executionDesk',   label: 'Execution', anchor: { x: 366, y: 214 }, area: { x: 340, y: 210, w: 60, h: 34 },  accent: '#34d399', tint: { x: 326, y: 114, w: 82,  h: 134 } },
  riskDesk:        { id: 'riskDesk',        label: 'Risk',      anchor: { x: 606, y: 222 }, area: { x: 590, y: 210, w: 36, h: 26 },  accent: '#f87171', tint: { x: 556, y: 126, w: 84,  h: 114 } },
  portfolioDesk:   { id: 'portfolioDesk',   label: 'Portfolio', anchor: { x: 610, y: 334 }, area: { x: 590, y: 320, w: 40, h: 28 },  accent: '#fbbf24', tint: { x: 556, y: 236, w: 88,  h: 116 } },
  serverRack:      { id: 'serverRack',      label: 'SERVERS',   anchor: { x: 752, y: 312 }, area: { x: 735, y: 308, w: 50, h: 28 },  accent: '#94a3b8', tint: { x: 732, y: 246, w: 52,  h: 94 } },
  restArea:        { id: 'restArea',        label: 'Break',     anchor: { x: 740, y: 196 }, area: { x: 710, y: 180, w: 70, h: 50 },  accent: '#64748b' },
  centralFloor:    { id: 'centralFloor',    label: 'Floor',     anchor: { x: 430, y: 390 }, area: { x: 380, y: 360, w: 120, h: 60 }, accent: '#71717a' },
};

export const OFFICE_ZONE_IDS = Object.keys(OFFICE_ZONES) as OfficeZoneId[];
