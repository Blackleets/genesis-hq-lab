// Kenney RPG Urban Pack atlas (CC0).
// https://kenney.nl/assets/rpg-urban-pack
// Single sprite sheet: 432×288 (27 cols × 18 rows of 16×16 tiles).
//
// This module exposes:
//   - <KenneyAtlasDefs />  → SVG <defs> with reusable <symbol>s + <pattern>s
//   - <KenneyTile />       → <use> wrapper for non-character tiles
//   - CHARACTERS           → mapping of archetype → character sprite tile
//   - ARCHETYPE_TO_TILE    → quick lookup for KenneyCharacter
//
// Tile coordinates were identified by sampling individual tile_NNNN.png
// files. If a sprite looks wrong, adjust the (col, row) here only.

import type { JSX } from 'react';
import type { Archetype } from '../types/genesis';

export const KENNEY_ATLAS = '/assets/kenney-rpg-urban/Tilemap/tilemap_packed.png';
export const KENNEY_ATLAS_W = 432;
export const KENNEY_ATLAS_H = 288;
export const KENNEY_TILE = 16;

// Non-character tiles used by environment (extend as needed).
export const TILES = {
  floorWood:    { col: 9,  row: 3 },   // warm beige hardwood
  floorWoodAlt: { col: 8,  row: 3 },
  floorStone:   { col: 13, row: 2 },
  plantSmall:   { col: 17, row: 9 },
} as const;

// Character sprites identified by visual sampling. Cols 23-26 contain
// many character variants. Each is a 16×16 head-and-shoulders sprite.
export const CHARACTERS = {
  charBrown:    { col: 23, row: 0 },   // brown shirt
  charGreen:    { col: 24, row: 0 },   // green shirt
  charYellow:   { col: 25, row: 0 },   // yellow / hooded
  charTanHat:   { col: 26, row: 0 },   // brown with hat
  charFormalRed:{ col: 23, row: 2 },   // red shirt + white collar (executive)
  charPinkHood: { col: 23, row: 3 },   // pink hood
  charRed:      { col: 23, row: 4 },   // red shirt
  charRedHood:  { col: 23, row: 5 },   // red hood
  charBlue:     { col: 23, row: 7 },   // blue shirt
  charYellowHat:{ col: 23, row: 9 },   // yellow + hat
} as const;

export type CharacterTileId = keyof typeof CHARACTERS;
export type EnvTileId = keyof typeof TILES;

// Each archetype maps to one base sprite. KenneyCharacter still applies a
// per-agent color tint on top, so the same base looks different for two
// agents of the same archetype with different primary colors.
export const ARCHETYPE_TO_TILE: Record<Archetype, CharacterTileId> = {
  commander:   'charFormalRed',
  sentinel:    'charRedHood',
  guardian:    'charYellowHat',
  analyst:     'charBlue',
  scientist:   'charPinkHood',
  listener:    'charGreen',
  mediator:    'charYellow',
  archivist:   'charRed',
  reviewer:    'charTanHat',
  engineer:    'charBrown',
  designer:    'charYellow',
  broadcaster: 'charGreen',
  operator:    'charBrown',
  intern:      'charGreen',
};

function AtlasImage({ title }: { title: string }): JSX.Element {
  return (
    <image
      href={KENNEY_ATLAS}
      x={0}
      y={0}
      width={KENNEY_ATLAS_W}
      height={KENNEY_ATLAS_H}
      imageRendering="pixelated"
      preserveAspectRatio="none"
    >
      <title>{title}</title>
    </image>
  );
}

export function KenneyAtlasDefs(): JSX.Element {
  const allTiles: Array<[string, { col: number; row: number }]> = [
    ...Object.entries(TILES),
    ...Object.entries(CHARACTERS),
  ];
  return (
    <>
      {allTiles.map(([id, { col, row }]) => (
        <symbol
          key={id}
          id={`t-${id}`}
          viewBox={`${col * KENNEY_TILE} ${row * KENNEY_TILE} ${KENNEY_TILE} ${KENNEY_TILE}`}
        >
          <AtlasImage title={`Kenney RPG Urban Pack tile ${id}`} />
        </symbol>
      ))}

      {/* floor pattern (tiled) */}
      <pattern
        id="floor-wood"
        patternUnits="userSpaceOnUse"
        width={KENNEY_TILE}
        height={KENNEY_TILE}
        viewBox={`${TILES.floorWood.col * KENNEY_TILE} ${TILES.floorWood.row * KENNEY_TILE} ${KENNEY_TILE} ${KENNEY_TILE}`}
      >
        <AtlasImage title="Kenney RPG Urban Pack wood floor pattern" />
      </pattern>
    </>
  );
}

interface KenneyTileProps {
  tile: EnvTileId | CharacterTileId;
  x: number;
  y: number;
  size?: number;
}

export function KenneyTile({ tile, x, y, size = KENNEY_TILE }: KenneyTileProps): JSX.Element {
  return <use href={`#t-${tile}`} x={x} y={y} width={size} height={size} />;
}
