import type { Archetype } from '@core/types/genesis';

export const KENNEY_ATLAS = '/assets/kenney-rpg-urban/Tilemap/tilemap_packed.png';
export const KENNEY_ATLAS_W = 432;
export const KENNEY_ATLAS_H = 288;
export const KENNEY_TILE = 16;

export const TILES = {
    floorWood: { col: 9, row: 3 },
    floorWoodAlt: { col: 8, row: 3 },
    floorStone: { col: 13, row: 2 },
    plantSmall: { col: 17, row: 9 },
} as const;

export const CHARACTERS = {
    charBrown: { col: 23, row: 0 },
    charGreen: { col: 24, row: 0 },
    charYellow: { col: 25, row: 0 },
    charTanHat: { col: 26, row: 0 },
    charFormalRed: { col: 23, row: 2 },
    charPinkHood: { col: 23, row: 3 },
    charRed: { col: 23, row: 4 },
    charRedHood: { col: 23, row: 5 },
    charBlue: { col: 23, row: 7 },
    charYellowHat: { col: 23, row: 9 },
} as const;

export type CharacterTileId = keyof typeof CHARACTERS;
export type EnvTileId = keyof typeof TILES;

export const ARCHETYPE_TO_TILE: Record<Archetype, CharacterTileId> = {
    commander: 'charFormalRed',
    sentinel: 'charRedHood',
    guardian: 'charYellowHat',
    analyst: 'charBlue',
    scientist: 'charPinkHood',
    listener: 'charGreen',
    mediator: 'charYellow',
    archivist: 'charRed',
    reviewer: 'charTanHat',
    engineer: 'charBrown',
    designer: 'charYellow',
    broadcaster: 'charGreen',
    operator: 'charBrown',
    intern: 'charGreen',
};
