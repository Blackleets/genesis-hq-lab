import type { RoomId } from '@core/types/office';

export const PIXEL_CANVAS_WIDTH = 800;
export const PIXEL_CANVAS_HEIGHT = 450;
export const PIXEL_TILE = 16;

export type PixelSpriteKey =
  | 'desk'
  | 'deskWithPc'
  | 'chair'
  | 'pc1'
  | 'pc2'
  | 'plant'
  | 'cabinet'
  | 'coffeeMaker'
  | 'waterCooler'
  | 'partitions1'
  | 'partitions2'
  | 'printer'
  | 'trash'
  | 'writingTable';

export interface PixelZone {
  id: RoomId | 'genesis-core' | 'coffee-lounge';
  label: { es: string; en: string };
  x: number;
  y: number;
  width: number;
  height: number;
  rugColor: string;
  labelX: number;
  labelY: number;
  anchor: { x: number; y: number };
}

export interface FurniturePlacement {
  id: string;
  sprite: PixelSpriteKey;
  x: number;
  y: number;
  width: number;
  height: number;
  flipX?: boolean;
  alpha?: number;
}

export interface WallSegment {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const PIXEL_ZONES: PixelZone[] = [
  {
    id: 'market-desk',
    label: { es: 'Escritorio de Mercado', en: 'Market Desk' },
    x: 28, y: 44, width: 196, height: 118,
    rugColor: '#274055',
    labelX: 34, labelY: 40,
    anchor: { x: 112, y: 98 },
  },
  {
    id: 'strategy-lab',
    label: { es: 'Lab. de Estrategia', en: 'Strategy Lab' },
    x: 238, y: 44, width: 170, height: 118,
    rugColor: '#374638',
    labelX: 246, labelY: 40,
    anchor: { x: 314, y: 98 },
  },
  {
    id: 'risk-bunker',
    label: { es: 'Búnker de Riesgo', en: 'Risk Bunker' },
    x: 432, y: 32, width: 344, height: 132,
    rugColor: '#553325',
    labelX: 440, labelY: 28,
    anchor: { x: 596, y: 104 },
  },
  {
    id: 'open-workspace',
    label: { es: 'Espacio Abierto', en: 'Open Workspace' },
    x: 30, y: 184, width: 398, height: 126,
    rugColor: '#47363e',
    labelX: 36, labelY: 180,
    anchor: { x: 274, y: 244 },
  },
  {
    id: 'memory-archive',
    label: { es: 'Archivo de Memoria', en: 'Memory Archive' },
    x: 432, y: 166, width: 344, height: 138,
    rugColor: '#40382d',
    labelX: 440, labelY: 162,
    anchor: { x: 598, y: 240 },
  },
  {
    id: 'debate-room',
    label: { es: 'Sala de Debate', en: 'Debate Area' },
    x: 30, y: 330, width: 184, height: 112,
    rugColor: '#4c343f',
    labelX: 36, labelY: 326,
    anchor: { x: 120, y: 386 },
  },
  {
    id: 'board-room',
    label: { es: 'Sala de Juntas', en: 'Board Room' },
    x: 224, y: 330, width: 168, height: 112,
    rugColor: '#594528',
    labelX: 232, labelY: 326,
    anchor: { x: 302, y: 386 },
  },
  {
    id: 'hr-pod',
    label: { es: 'Génesis HR', en: 'Genesis HR' },
    x: 408, y: 330, width: 172, height: 112,
    rugColor: '#55412c',
    labelX: 416, labelY: 326,
    anchor: { x: 492, y: 388 },
  },
  {
    id: 'execution-desk',
    label: { es: 'Mesa de Ejecución', en: 'Execution Desk' },
    x: 594, y: 330, width: 182, height: 112,
    rugColor: '#334528',
    labelX: 602, labelY: 326,
    anchor: { x: 684, y: 388 },
  },
  {
    id: 'coffee-lounge',
    label: { es: 'Zona de Café', en: 'Coffee Lounge' },
    x: 34, y: 184, width: 108, height: 58,
    rugColor: '#48342b',
    labelX: 40, labelY: 202,
    anchor: { x: 88, y: 214 },
  },
  {
    id: 'genesis-core',
    label: { es: 'Núcleo Génesis', en: 'Genesis Core' },
    x: 442, y: 330, width: 120, height: 60,
    rugColor: '#4a3d2f',
    labelX: 448, labelY: 352,
    anchor: { x: 502, y: 360 },
  },
];

export const PIXEL_WALLS: WallSegment[] = [
  { x: 0, y: 0, width: 800, height: 8 },
  { x: 0, y: 442, width: 800, height: 8 },
  { x: 0, y: 0, width: 8, height: 450 },
  { x: 792, y: 0, width: 8, height: 450 },
  { x: 424, y: 20, width: 8, height: 76 },
  { x: 424, y: 120, width: 8, height: 44 },
  { x: 424, y: 20, width: 352, height: 8 },
  { x: 424, y: 156, width: 352, height: 8 },
  { x: 424, y: 168, width: 8, height: 40 },
  { x: 424, y: 236, width: 8, height: 68 },
  { x: 424, y: 304, width: 352, height: 8 },
];

export const PIXEL_DOORS = [
  { x: 424, y: 96, width: 8, height: 24, color: '#ff4757' },
  { x: 424, y: 208, width: 8, height: 28, color: '#3da9fc' },
] as const;

export const PIXEL_FURNITURE: FurniturePlacement[] = [
  { id: 'market-desk-1', sprite: 'deskWithPc', x: 60, y: 78, width: 44, height: 44 },
  { id: 'market-desk-2', sprite: 'deskWithPc', x: 106, y: 78, width: 44, height: 44 },
  { id: 'market-desk-3', sprite: 'deskWithPc', x: 152, y: 78, width: 44, height: 44 },
  { id: 'market-chair-1', sprite: 'chair', x: 76, y: 116, width: 18, height: 18 },
  { id: 'market-chair-2', sprite: 'chair', x: 122, y: 116, width: 18, height: 18 },
  { id: 'market-chair-3', sprite: 'chair', x: 168, y: 116, width: 18, height: 18 },
  { id: 'market-plant', sprite: 'plant', x: 196, y: 64, width: 20, height: 20 },

  { id: 'strategy-board', sprite: 'writingTable', x: 268, y: 56, width: 52, height: 52 },
  { id: 'strategy-pc', sprite: 'pc2', x: 281, y: 70, width: 18, height: 18 },
  { id: 'strategy-desk-1', sprite: 'deskWithPc', x: 264, y: 94, width: 44, height: 44 },
  { id: 'strategy-desk-2', sprite: 'deskWithPc', x: 332, y: 94, width: 44, height: 44 },
  { id: 'strategy-chair-1', sprite: 'chair', x: 278, y: 132, width: 18, height: 18 },
  { id: 'strategy-chair-2', sprite: 'chair', x: 346, y: 132, width: 18, height: 18 },
  { id: 'strategy-plant', sprite: 'plant', x: 382, y: 118, width: 18, height: 18 },

  { id: 'risk-rack-left', sprite: 'partitions2', x: 452, y: 50, width: 34, height: 34 },
  { id: 'risk-rack-right', sprite: 'partitions2', x: 690, y: 50, width: 34, height: 34 },
  { id: 'risk-core-desk', sprite: 'deskWithPc', x: 458, y: 108, width: 44, height: 44 },
  { id: 'risk-side-desk', sprite: 'deskWithPc', x: 530, y: 108, width: 44, height: 44 },
  { id: 'risk-chair-1', sprite: 'chair', x: 472, y: 146, width: 18, height: 18 },
  { id: 'risk-chair-2', sprite: 'chair', x: 544, y: 146, width: 18, height: 18 },
  { id: 'risk-divider', sprite: 'partitions1', x: 620, y: 96, width: 36, height: 36 },

  { id: 'coffee-table', sprite: 'writingTable', x: 46, y: 198, width: 34, height: 34 },
  { id: 'coffee-maker', sprite: 'coffeeMaker', x: 48, y: 194, width: 18, height: 18 },
  { id: 'coffee-water', sprite: 'waterCooler', x: 86, y: 192, width: 12, height: 24 },
  { id: 'coffee-trash', sprite: 'trash', x: 76, y: 214, width: 10, height: 10 },
  { id: 'open-sofa-table', sprite: 'writingTable', x: 260, y: 226, width: 40, height: 40 },
  { id: 'open-intern-desk', sprite: 'deskWithPc', x: 304, y: 210, width: 44, height: 44 },
  { id: 'open-chair', sprite: 'chair', x: 318, y: 248, width: 18, height: 18 },
  { id: 'open-divider-1', sprite: 'partitions1', x: 188, y: 210, width: 30, height: 30 },
  { id: 'open-divider-2', sprite: 'partitions2', x: 352, y: 210, width: 30, height: 30 },
  { id: 'open-plant-1', sprite: 'plant', x: 150, y: 202, width: 18, height: 18 },
  { id: 'open-plant-2', sprite: 'plant', x: 380, y: 270, width: 18, height: 18 },

  { id: 'memory-cab-1', sprite: 'cabinet', x: 440, y: 180, width: 28, height: 28 },
  { id: 'memory-cab-2', sprite: 'cabinet', x: 468, y: 180, width: 28, height: 28 },
  { id: 'memory-cab-3', sprite: 'cabinet', x: 496, y: 180, width: 28, height: 28 },
  { id: 'memory-cab-4', sprite: 'cabinet', x: 440, y: 270, width: 28, height: 28 },
  { id: 'memory-cab-5', sprite: 'cabinet', x: 468, y: 270, width: 28, height: 28 },
  { id: 'memory-printer', sprite: 'printer', x: 534, y: 226, width: 24, height: 12 },
  { id: 'memory-desk', sprite: 'deskWithPc', x: 614, y: 220, width: 44, height: 44 },
  { id: 'memory-chair', sprite: 'chair', x: 628, y: 258, width: 18, height: 18 },

  { id: 'debate-table', sprite: 'writingTable', x: 68, y: 354, width: 56, height: 56 },
  { id: 'debate-chair-1', sprite: 'chair', x: 56, y: 370, width: 18, height: 18 },
  { id: 'debate-chair-2', sprite: 'chair', x: 124, y: 370, width: 18, height: 18 },
  { id: 'debate-chair-3', sprite: 'chair', x: 90, y: 404, width: 18, height: 18 },

  { id: 'board-table', sprite: 'writingTable', x: 258, y: 354, width: 60, height: 60 },
  { id: 'board-chair-1', sprite: 'chair', x: 244, y: 370, width: 18, height: 18 },
  { id: 'board-chair-2', sprite: 'chair', x: 320, y: 370, width: 18, height: 18 },
  { id: 'board-chair-3', sprite: 'chair', x: 282, y: 404, width: 18, height: 18 },

  { id: 'hr-cabinet-1', sprite: 'cabinet', x: 424, y: 350, width: 28, height: 28 },
  { id: 'hr-cabinet-2', sprite: 'cabinet', x: 452, y: 350, width: 28, height: 28 },
  { id: 'hr-desk', sprite: 'deskWithPc', x: 500, y: 374, width: 44, height: 44 },
  { id: 'hr-chair', sprite: 'chair', x: 514, y: 412, width: 18, height: 18 },
  { id: 'hr-onboarding', sprite: 'partitions1', x: 548, y: 358, width: 28, height: 28 },

  { id: 'exec-rack-1', sprite: 'partitions2', x: 610, y: 352, width: 28, height: 28 },
  { id: 'exec-rack-2', sprite: 'partitions2', x: 640, y: 352, width: 28, height: 28 },
  { id: 'exec-rack-3', sprite: 'partitions2', x: 670, y: 352, width: 28, height: 28 },
  { id: 'exec-desk', sprite: 'deskWithPc', x: 712, y: 382, width: 44, height: 44 },
  { id: 'exec-chair', sprite: 'chair', x: 726, y: 420, width: 18, height: 18 },
  { id: 'exec-terminal', sprite: 'pc2', x: 744, y: 360, width: 18, height: 18 },
];
