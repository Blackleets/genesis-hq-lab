// TileOfficeRenderer — canvas 2D renderer for the live tile office (Phase 1).
//
// Phase 1 scope: load the tilesheet, paint floors/walls/furniture and the
// five agent-station nameplates. Agents, dialogue and live system events
// arrive in later phases (officeAgents / officeEvents / agentDialogue).

import {
  FLOOR_TILES,
  FLOOR_ZONES,
  FURNITURE,
  OFFICE_CANVAS_H,
  OFFICE_CANVAS_W,
  OFFICE_SPRITES,
  STATIONS,
  TILE_SIZE,
  TILESHEET_URL,
  WALL_BASE_Y,
  WALL_SEQUENCE,
  type FurniturePlacement,
} from './officeLayout';

const CEILING_COLOR = '#181826';
const ASSET_TIMEOUT_MS = 10_000;

/** Loads the office tilesheet; rejects on error or timeout so callers can fall back. */
export function loadOfficeTilesheet(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => {
      img.src = '';
      reject(new Error(`tilesheet load timed out: ${TILESHEET_URL}`));
    }, ASSET_TIMEOUT_MS);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error(`tilesheet failed to load: ${TILESHEET_URL}`));
    };
    img.src = TILESHEET_URL;
  });
}

function drawFloors(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement) {
  for (const zone of FLOOR_ZONES) {
    const src = FLOOR_TILES[zone.tile];
    const x1 = Math.min(zone.x + zone.w, OFFICE_CANVAS_W);
    const y1 = Math.min(zone.y + zone.h, OFFICE_CANVAS_H);
    for (let y = zone.y; y < y1; y += TILE_SIZE) {
      for (let x = zone.x; x < x1; x += TILE_SIZE) {
        ctx.drawImage(sheet, src.x, src.y, TILE_SIZE, TILE_SIZE, x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

function drawWalls(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement) {
  let x = 0;
  for (const id of WALL_SEQUENCE) {
    if (x >= OFFICE_CANVAS_W) break;
    const s = OFFICE_SPRITES[id];
    ctx.drawImage(sheet, s.x, s.y, s.w, s.h, x, WALL_BASE_Y - s.h, s.w, s.h);
    x += s.w;
  }
}

function drawSprite(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement, f: FurniturePlacement) {
  const s = OFFICE_SPRITES[f.sprite];
  ctx.drawImage(sheet, s.x, s.y, s.w, s.h, f.x, f.y, s.w, s.h);
}

function drawNameplate(ctx: CanvasRenderingContext2D, label: string, cx: number, y: number) {
  ctx.save();
  ctx.font = '7px monospace';
  ctx.textBaseline = 'top';
  const w = ctx.measureText(label).width + 8;
  const x = Math.round(cx - w / 2);
  ctx.fillStyle = 'rgba(10, 10, 20, 0.78)';
  ctx.fillRect(x, y, w, 11);
  ctx.strokeStyle = 'rgba(0, 255, 156, 0.35)';
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 10);
  ctx.fillStyle = '#00ff9c';
  ctx.fillText(label, x + 4, y + 2);
  ctx.restore();
}

/**
 * Paints the full office scene. Static in Phase 1 — call once after the
 * tilesheet resolves (and again on demand once agents animate in Phase 2).
 */
export function drawTileOffice(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = CEILING_COLOR;
  ctx.fillRect(0, 0, OFFICE_CANVAS_W, OFFICE_CANVAS_H);

  drawFloors(ctx, sheet);
  drawWalls(ctx, sheet);

  // painter's algorithm: sort everything by bottom edge so closer items overlap
  const placements: FurniturePlacement[] = [
    ...FURNITURE,
    ...STATIONS.map((st) => st.desk),
  ];
  placements.sort((a, b) => (a.y + OFFICE_SPRITES[a.sprite].h) - (b.y + OFFICE_SPRITES[b.sprite].h));
  for (const f of placements) {
    drawSprite(ctx, sheet, f);
  }

  for (const st of STATIONS) {
    const s = OFFICE_SPRITES[st.desk.sprite];
    drawNameplate(ctx, st.label, st.desk.x + s.w / 2, st.desk.y - 13);
  }
}
