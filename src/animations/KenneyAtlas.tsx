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
import {
  CHARACTERS,
  KENNEY_ATLAS,
  KENNEY_ATLAS_H,
  KENNEY_ATLAS_W,
  KENNEY_TILE,
  TILES,
  type CharacterTileId,
  type EnvTileId,
} from '@animations/KenneyAtlasData';

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
