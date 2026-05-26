// Static metadata for every room in the office. The store uses these as
// movement targets and the WorkScreen uses them for breadcrumbs / colors.

import type { Room, RoomId } from '../types/office';

export const OFFICE_ROOMS: Record<RoomId, Room> = {
  'market-desk': {
    id: 'market-desk',
    label: { es: 'Escritorio de Mercado', en: 'Market Desk' },
    entryPoint: { x: 220, y: 200 },
    color: '#3da9fc',
  },
  'strategy-lab': {
    id: 'strategy-lab',
    label: { es: 'Laboratorio de Estrategia', en: 'Strategy Lab' },
    entryPoint: { x: 700, y: 200 },
    color: '#22d3ee',
  },
  'risk-bunker': {
    id: 'risk-bunker',
    label: { es: 'Búnker de Riesgo', en: 'Risk Bunker' },
    entryPoint: { x: 1330, y: 200 },
    color: '#ff4757',
  },
  'open-workspace': {
    id: 'open-workspace',
    label: { es: 'Espacio Abierto', en: 'Open Workspace' },
    entryPoint: { x: 800, y: 470 },
    color: '#7c5cff',
  },
  'memory-archive': {
    id: 'memory-archive',
    label: { es: 'Archivo de Memoria', en: 'Memory Archive' },
    entryPoint: { x: 1330, y: 470 },
    color: '#1f6fb0',
  },
  'debate-room': {
    id: 'debate-room',
    label: { es: 'Sala de Debate', en: 'Debate Room' },
    entryPoint: { x: 220, y: 740 },
    color: '#a855f7',
  },
  'board-room': {
    id: 'board-room',
    label: { es: 'Sala de Juntas', en: 'Board Room' },
    entryPoint: { x: 620, y: 740 },
    color: '#ffd24a',
  },
  'hr-pod': {
    id: 'hr-pod',
    label: { es: 'Génesis HR', en: 'Genesis HR' },
    entryPoint: { x: 1080, y: 740 },
    color: '#ffb547',
  },
  'execution-desk': {
    id: 'execution-desk',
    label: { es: 'Mesa de Ejecución', en: 'Execution Desk' },
    entryPoint: { x: 1400, y: 740 },
    color: '#00ff9c',
  },
};

export const ROOM_IDS = Object.keys(OFFICE_ROOMS) as RoomId[];
