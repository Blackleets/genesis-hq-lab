// officeLayout — data for the live tile office (Phase 1).
//
// Source atlas: /assets/office/tilesheet.png ("Office Interiors — Free Demo",
// see /assets/office/LICENSE_NOTE.md — demo/prototype use only for now).
// The sheet is a promo composite, so sprites are addressed by exact pixel
// rects (measured via alpha connected-components), not by a uniform grid.

export const TILE_SIZE = 16;
export const OFFICE_GRID_W = 50;
export const OFFICE_GRID_H = 28;
export const OFFICE_CANVAS_W = OFFICE_GRID_W * TILE_SIZE; // 800
export const OFFICE_CANVAS_H = OFFICE_GRID_H * TILE_SIZE; // 448

export const TILESHEET_URL = '/assets/office/tilesheet.png';

/** Pixel rect inside the tilesheet. */
export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Furniture / wall sprites, keyed by what they look like. */
export const OFFICE_SPRITES = {
  elevator:         { x: 214, y: 51,  w: 68,  h: 66 },
  wallDoorWindow:   { x: 299, y: 51,  w: 137, h: 67 },
  wallA:            { x: 0,   y: 119, w: 61,  h: 75 },
  wallB:            { x: 66,  y: 119, w: 63,  h: 75 },
  wallC:            { x: 138, y: 119, w: 64,  h: 75 },
  wallD:            { x: 214, y: 119, w: 72,  h: 72 },
  wallBigWindow:    { x: 299, y: 119, w: 141, h: 81 },
  deskFrontPc:      { x: 0,   y: 214, w: 73,  h: 86 },
  filingCabinet:    { x: 84,  y: 213, w: 34,  h: 77 },
  waterCooler:      { x: 134, y: 213, w: 30,  h: 82 },
  plantTall:        { x: 177, y: 219, w: 40,  h: 74 },
  workstationA:     { x: 223, y: 222, w: 96,  h: 93 },
  workstationB:     { x: 333, y: 222, w: 103, h: 94 },
  printer:          { x: 0,   y: 313, w: 39,  h: 34 },
  cabinet:          { x: 93,  y: 308, w: 25,  h: 39 },
  conferenceTable:  { x: 157, y: 310, w: 70,  h: 67 },
  chairA:           { x: 230, y: 323, w: 22,  h: 42 },
  deskSideA:        { x: 258, y: 325, w: 75,  h: 61 },
  chairB:           { x: 336, y: 323, w: 21,  h: 42 },
  deskSideB:        { x: 363, y: 325, w: 80,  h: 64 },
  copier:           { x: 0,   y: 362, w: 27,  h: 25 },
  trash:            { x: 40,  y: 362, w: 24,  h: 25 },
  smallCab:         { x: 79,  y: 361, w: 19,  h: 24 },
  cactus:           { x: 116, y: 360, w: 20,  h: 25 },
} satisfies Record<string, SheetRect>;

export type OfficeSpriteId = keyof typeof OFFICE_SPRITES;

/**
 * Character sprites on the sheet (front-facing idle, ~28x47-60 px).
 * Not rendered in Phase 1 — reserved for the live agents in Phase 2.
 */
export const OFFICE_CHARACTERS: SheetRect[] = [
  { x: 5,   y: 401, w: 28, h: 47 },
  { x: 48,  y: 402, w: 24, h: 46 },
  { x: 91,  y: 392, w: 27, h: 56 },
  { x: 137, y: 398, w: 25, h: 48 },
  { x: 181, y: 391, w: 28, h: 57 },
  { x: 235, y: 388, w: 28, h: 60 },
  { x: 293, y: 388, w: 29, h: 60 },
  { x: 348, y: 390, w: 29, h: 58 },
  { x: 403, y: 389, w: 28, h: 59 },
];

/** 16x16 seamless floor samples taken from inside the floor swatches. */
export const FLOOR_TILES = {
  carpet:  { x: 88,  y: 72 },
  glass:   { x: 24,  y: 64 },
  speckle: { x: 152, y: 72 },
} satisfies Record<string, { x: number; y: number }>;

export type FloorTileId = keyof typeof FLOOR_TILES;

/** Y of the wall base line — floor starts above it so wall feet sit on floor. */
export const WALL_BASE_Y = 80;

/** Floor zones painted in order (later zones overwrite earlier ones). */
export interface FloorZone {
  tile: FloorTileId;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const FLOOR_ZONES: FloorZone[] = [
  // base: cool tile floor across the whole office (darkened by the renderer's
  // industrial tint — approved "Pantalla 1" look, 2026-06-10)
  { tile: 'glass', x: 0, y: WALL_BASE_Y - TILE_SIZE, w: OFFICE_CANVAS_W, h: OFFICE_CANVAS_H - WALL_BASE_Y + TILE_SIZE },
  // warm carpet only inside the meeting area (bottom-center)
  { tile: 'carpet', x: 296, y: 256, w: 168, h: 150 },
];

/**
 * Zone tags — green terminal-style labels naming each functional area
 * (approved agent-office visual direction). Positions are canvas px of the
 * tag's center-top.
 */
export interface ZoneTag {
  label: string;
  cx: number;
  y: number;
}

export const ZONE_TAGS: ZoneTag[] = [
  { label: 'RESEARCH ZONE',     cx: 162, y: 96 },
  { label: 'TRADING DESK',      cx: 366, y: 96 },
  { label: 'RISK MANAGEMENT',   cx: 600, y: 96 },
  { label: 'PORTFOLIO MONITOR', cx: 608, y: 310 },
  { label: 'SERVER ROOM',       cx: 758, y: 232 },
  { label: 'COFFEE AREA',       cx: 745, y: 128 },
  { label: 'MEETING ROOM',      cx: 375, y: 252 },
];

/** Wall-mounted market screen (decorative animated candles, no numbers). */
export const MARKET_WATCH = { x: 340, y: 8, w: 160, h: 62 };

/** Dark room patch behind the server rack (industrial server-room read). */
export const SERVER_ROOM_RECT = { x: 728, y: 242, w: 60, h: 102 };

/** Wall panels drawn left→right along the top, bottoms aligned at WALL_BASE_Y. */
export const WALL_SEQUENCE: OfficeSpriteId[] = [
  'wallA',
  'wallBigWindow',
  'wallB',
  'elevator',
  'wallDoorWindow',
  'wallC',
  'wallBigWindow',
  'wallD',
  'wallA',
];

export interface FurniturePlacement {
  sprite: OfficeSpriteId;
  x: number;
  y: number;
}

/** Decoration & shared furniture (z-sorted by bottom edge at draw time). */
export const FURNITURE: FurniturePlacement[] = [
  { sprite: 'conferenceTable', x: 340, y: 280 },
  { sprite: 'waterCooler',     x: 752, y: 86 },
  { sprite: 'filingCabinet',   x: 8,   y: 84 },
  { sprite: 'filingCabinet',   x: 44,  y: 84 },
  { sprite: 'copier',          x: 96,  y: 110 },
  { sprite: 'printer',         x: 170, y: 350 },
  { sprite: 'cabinet',         x: 740, y: 250 },
  { sprite: 'plantTall',       x: 0,   y: 240 },
  { sprite: 'plantTall',       x: 754, y: 366 },
  { sprite: 'plantTall',       x: 300, y: 84 },
  { sprite: 'trash',           x: 130, y: 360 },
  { sprite: 'cactus',          x: 530, y: 350 },
  { sprite: 'smallCab',        x: 480, y: 92 },
  { sprite: 'chairA',          x: 596, y: 192 },
  { sprite: 'chairB',          x: 600, y: 304 },
];

/** Roles of the live agents that will inhabit the office (Phase 2). */
export type OfficeAgentRole = 'scout' | 'analyst' | 'execution' | 'risk' | 'portfolio';

export interface OfficeStation {
  role: OfficeAgentRole;
  label: string;
  desk: FurniturePlacement;
  /** where the agent stands/sits when working at this desk (Phase 2) */
  anchor: { x: number; y: number };
  /** monitor screen face, as offsets inside the desk sprite (Phase 5) */
  screen: SheetRect;
}

/** The five agent desks. Labels are drawn as nameplates in Phase 1. */
export const STATIONS: OfficeStation[] = [
  { role: 'scout',     label: 'SCOUT',     desk: { sprite: 'workstationA', x: 48,  y: 130 }, anchor: { x: 96,  y: 230 }, screen: { x: 31, y: 22, w: 22, h: 13 } },
  { role: 'analyst',   label: 'ANALYST',   desk: { sprite: 'workstationB', x: 180, y: 130 }, anchor: { x: 230, y: 230 }, screen: { x: 33, y: 22, w: 20, h: 14 } },
  { role: 'execution', label: 'EXECUTION', desk: { sprite: 'deskFrontPc',  x: 330, y: 120 }, anchor: { x: 366, y: 214 }, screen: { x: 17, y: 6,  w: 31, h: 17 } },
  { role: 'risk',      label: 'RISK',      desk: { sprite: 'deskSideA',    x: 560, y: 130 }, anchor: { x: 606, y: 222 }, screen: { x: 36, y: 3,  w: 22, h: 13 } },
  { role: 'portfolio', label: 'PORTFOLIO', desk: { sprite: 'deskSideB',    x: 560, y: 240 }, anchor: { x: 610, y: 334 }, screen: { x: 36, y: 2,  w: 23, h: 13 } },
];

/**
 * LED strip on the server cabinet (Phase 5): absolute canvas position of
 * the topmost LED; the rest stack downward with `spacing`.
 */
export const SERVER_RACK_LEDS = { x: 757, y: 258, count: 4, spacing: 7 };
