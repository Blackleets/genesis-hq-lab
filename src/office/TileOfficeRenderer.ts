// TileOfficeRenderer — canvas 2D renderer for the live tile office.
//
// Phase 1: floors/walls/furniture + station nameplates.
// Phase 2: live agents drawn z-sorted with the furniture, with breathing/
// walking animation and per-state markers. Dialogue and real system events
// arrive in Phase 3 (officeEvents / agentDialogue).

import {
  FLOOR_TILES,
  FLOOR_ZONES,
  FURNITURE,
  OFFICE_CANVAS_H,
  OFFICE_CANVAS_W,
  OFFICE_CHARACTERS,
  OFFICE_SPRITES,
  STATIONS,
  TILE_SIZE,
  TILESHEET_URL,
  WALL_BASE_Y,
  WALL_SEQUENCE,
  type FurniturePlacement,
} from './officeLayout';
import type { LiveOfficeAgent } from './officeTypes';

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

function drawStationNameplates(ctx: CanvasRenderingContext2D) {
  for (const st of STATIONS) {
    const s = OFFICE_SPRITES[st.desk.sprite];
    drawNameplate(ctx, st.label, st.desk.x + s.w / 2, st.desk.y - 13);
  }
}

/** Paints the static parts that never change: ceiling, floors, walls. */
export function drawOfficeBase(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = CEILING_COLOR;
  ctx.fillRect(0, 0, OFFICE_CANVAS_W, OFFICE_CANVAS_H);
  drawFloors(ctx, sheet);
  drawWalls(ctx, sheet);
}

const ALL_PLACEMENTS: FurniturePlacement[] = [...FURNITURE, ...STATIONS.map((st) => st.desk)];

/**
 * Static scene (Phase 1 look, no agents). Kept as the degraded path if the
 * agent loop ever fails.
 */
export function drawTileOffice(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement) {
  drawOfficeBase(ctx, sheet);
  const placements = [...ALL_PLACEMENTS]
    .sort((a, b) => (a.y + OFFICE_SPRITES[a.sprite].h) - (b.y + OFFICE_SPRITES[b.sprite].h));
  for (const f of placements) drawSprite(ctx, sheet, f);
  drawStationNameplates(ctx);
}

// --- Phase 2: live agents -------------------------------------------------

function agentBob(agent: LiveOfficeAgent, now: number): number {
  if (agent.state === 'walking') {
    return Math.round(Math.abs(Math.sin(now / 110 + agent.bobPhase)) * 2);
  }
  // subtle 1px breathing
  return Math.round(Math.sin(now / 650 + agent.bobPhase) * 0.8);
}

function drawAgentSprite(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  agent: LiveOfficeAgent,
  now: number,
) {
  const rect = OFFICE_CHARACTERS[agent.def.spriteIndex];
  const feetX = Math.round(agent.x);
  const feetY = Math.round(agent.y);

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.beginPath();
  ctx.ellipse(feetX, feetY, Math.round(rect.w * 0.34), 3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const dx = feetX - Math.round(rect.w / 2);
  const dy = feetY - rect.h - agentBob(agent, now);
  if (agent.facing === -1) {
    ctx.save();
    ctx.translate(dx + rect.w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sheet, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
    ctx.restore();
  } else {
    ctx.drawImage(sheet, rect.x, rect.y, rect.w, rect.h, dx, dy, rect.w, rect.h);
  }
}

function drawStateMarker(ctx: CanvasRenderingContext2D, agent: LiveOfficeAgent, now: number) {
  const rect = OFFICE_CHARACTERS[agent.def.spriteIndex];
  const cx = Math.round(agent.x);
  const top = Math.round(agent.y) - rect.h - 6;
  ctx.save();
  switch (agent.state) {
    case 'thinking': {
      const visible = Math.floor(now / 400) % 4;
      ctx.fillStyle = 'rgba(228, 228, 240, 0.9)';
      for (let i = 0; i < Math.min(visible, 3); i++) {
        ctx.fillRect(cx - 6 + i * 5, top - (i === 1 ? 1 : 0), 2, 2);
      }
      break;
    }
    case 'scanning': {
      const alpha = 0.45 + 0.45 * Math.abs(Math.sin(now / 280));
      ctx.fillStyle = `rgba(56, 189, 248, ${alpha.toFixed(2)})`;
      ctx.fillRect(cx - 6, top, 12, 2);
      break;
    }
    case 'monitoring': {
      const alpha = 0.5 + 0.4 * Math.abs(Math.sin(now / 700));
      ctx.fillStyle = `rgba(52, 211, 153, ${alpha.toFixed(2)})`;
      ctx.fillRect(cx - 1, top, 3, 3);
      break;
    }
    case 'executing': {
      const r = 4 + Math.abs(Math.sin(now / 160)) * 3;
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.85)';
      ctx.beginPath();
      ctx.arc(cx, top, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'warning': {
      const alpha = 0.5 + 0.5 * Math.abs(Math.sin(now / 180));
      ctx.fillStyle = `rgba(248, 113, 113, ${alpha.toFixed(2)})`;
      ctx.beginPath();
      ctx.moveTo(cx, top - 5);
      ctx.lineTo(cx + 5, top + 3);
      ctx.lineTo(cx - 5, top + 3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function drawAgentLabel(ctx: CanvasRenderingContext2D, agent: LiveOfficeAgent) {
  ctx.save();
  ctx.font = '7px monospace';
  ctx.textBaseline = 'top';
  const text = agent.def.name;
  const w = ctx.measureText(text).width + 4;
  const x = Math.round(agent.x - w / 2);
  const y = Math.round(agent.y) + 4;
  ctx.fillStyle = 'rgba(10, 10, 20, 0.6)';
  ctx.fillRect(x, y, w, 9);
  ctx.fillStyle = agent.def.accent;
  ctx.fillText(text, x + 2, y + 1);
  ctx.restore();
}

/**
 * Full animated frame: prerendered base + furniture and agents z-sorted by
 * their bottom edge (painter's algorithm), then nameplates and markers.
 */
export function renderOfficeFrame(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  sheet: HTMLImageElement,
  agents: LiveOfficeAgent[],
  now: number,
) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(base, 0, 0);

  type Drawable = { bottom: number; draw: () => void };
  const items: Drawable[] = ALL_PLACEMENTS.map((f) => ({
    bottom: f.y + OFFICE_SPRITES[f.sprite].h,
    draw: () => drawSprite(ctx, sheet, f),
  }));
  for (const agent of agents) {
    items.push({ bottom: agent.y, draw: () => drawAgentSprite(ctx, sheet, agent, now) });
  }
  items.sort((a, b) => a.bottom - b.bottom);
  for (const item of items) item.draw();

  drawStationNameplates(ctx);
  for (const agent of agents) {
    drawStateMarker(ctx, agent, now);
    drawAgentLabel(ctx, agent);
  }
}
