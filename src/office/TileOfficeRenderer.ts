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
  SERVER_RACK_LEDS,
  STATIONS,
  TILE_SIZE,
  TILESHEET_URL,
  WALL_BASE_Y,
  WALL_SEQUENCE,
  type FurniturePlacement,
} from './officeLayout';
import { OFFICE_ZONES } from './officeZones';
import type { EngineStatus, LiveOfficeAgent } from './officeTypes';

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

/** Subtle per-zone floor tints + identity borders (Phase 5, static). */
function drawZoneTints(ctx: CanvasRenderingContext2D) {
  ctx.save();
  for (const zone of Object.values(OFFICE_ZONES)) {
    if (!zone.tint) continue;
    const t = zone.tint;
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = zone.accent;
    ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = zone.accent;
    ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1);
    // corner notch so zones read even with low color vision
    ctx.globalAlpha = 0.55;
    ctx.fillRect(t.x, t.y, 5, 2);
    ctx.fillRect(t.x, t.y, 2, 5);
  }
  // serverRack has no station nameplate — give it a dim zone label
  const server = OFFICE_ZONES.serverRack;
  if (server.tint) {
    ctx.globalAlpha = 0.8;
    ctx.font = '7px monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.fillText(server.label, server.tint.x + 4, server.tint.y + 4);
  }
  ctx.restore();
}

/** Paints the static parts that never change: ceiling, floors, walls. */
export function drawOfficeBase(ctx: CanvasRenderingContext2D, sheet: HTMLImageElement) {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = CEILING_COLOR;
  ctx.fillRect(0, 0, OFFICE_CANVAS_W, OFFICE_CANVAS_H);
  drawFloors(ctx, sheet);
  drawZoneTints(ctx);
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

// --- Phase 5: animated screens & server lights ----------------------------

/** Deterministic 0..1 hash so terminal lines vary without RNG per frame. */
function hash01(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

type ScreenMode = 'online' | 'scanning' | 'warning' | 'offline';

function screenModeFor(
  engineStatus: EngineStatus,
  stationAgent: LiveOfficeAgent | undefined,
): ScreenMode {
  if (engineStatus === 'offline' || engineStatus === 'unknown') return 'offline';
  if (engineStatus === 'degraded') return 'warning';
  const s = stationAgent?.state;
  const atScreen = stationAgent && stationAgent.zone === stationAgent.def.homeZone;
  if (atScreen && (s === 'scanning' || s === 'monitoring' || s === 'executing')) return 'scanning';
  return 'online';
}

function drawScreen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  mode: ScreenMode,
  now: number,
  seed: number,
) {
  ctx.save();
  if (mode === 'offline') {
    ctx.fillStyle = 'rgba(4, 6, 10, 0.92)';
    ctx.fillRect(x, y, w, h);
    // dim standby dot so "off" is a shape, not just a color
    if (Math.floor(now / 1100) % 2 === 0) {
      ctx.fillStyle = 'rgba(148, 60, 60, 0.55)';
      ctx.fillRect(x + w - 3, y + h - 3, 2, 2);
    }
    ctx.restore();
    return;
  }

  ctx.fillStyle = 'rgba(6, 14, 20, 0.88)';
  ctx.fillRect(x, y, w, h);

  // terminal lines: widths re-roll every ~650ms, one line occasionally blank
  const step = Math.floor(now / 650);
  const lines = Math.max(2, Math.floor((h - 4) / 4));
  for (let i = 0; i < lines; i++) {
    if (hash01(seed * 31 + step + i * 7) < 0.16) continue; // flicker gap
    const lw = Math.max(3, Math.floor((w - 6) * (0.3 + 0.6 * hash01(seed * 17 + step * 3 + i))));
    const warn = mode === 'warning';
    ctx.fillStyle = warn
      ? 'rgba(251, 191, 36, 0.55)'
      : i % 3 === 2
        ? 'rgba(56, 189, 248, 0.45)'
        : 'rgba(74, 222, 128, 0.45)';
    ctx.fillRect(x + 2, y + 2 + i * 4, lw, 2);
  }

  if (mode === 'scanning') {
    // sweep line moving across the screen
    const t = (now % 1600) / 1600;
    ctx.fillStyle = 'rgba(226, 232, 240, 0.30)';
    ctx.fillRect(x + 1 + Math.floor((w - 3) * t), y + 1, 1, h - 2);
  } else if (mode === 'warning') {
    const pulse = 0.10 + 0.10 * Math.abs(Math.sin(now / 420));
    ctx.fillStyle = `rgba(251, 191, 36, ${pulse.toFixed(2)})`;
    ctx.fillRect(x, y, w, h);
  }
  ctx.restore();
}

function drawScreens(
  ctx: CanvasRenderingContext2D,
  agents: LiveOfficeAgent[],
  now: number,
  engineStatus: EngineStatus,
) {
  for (let i = 0; i < STATIONS.length; i++) {
    const st = STATIONS[i];
    const agent = agents.find((a) => a.def.id === st.role);
    const mode = screenModeFor(engineStatus, agent);
    drawScreen(
      ctx,
      st.desk.x + st.screen.x,
      st.desk.y + st.screen.y,
      st.screen.w,
      st.screen.h,
      mode,
      now,
      i + 1,
    );
  }
}

function drawServerLeds(ctx: CanvasRenderingContext2D, now: number, engineStatus: EngineStatus) {
  const { x, y, count, spacing } = SERVER_RACK_LEDS;
  ctx.save();
  for (let i = 0; i < count; i++) {
    const ly = y + i * spacing;
    if (engineStatus === 'online') {
      const pulse = 0.45 + 0.55 * Math.abs(Math.sin(now / 900 + i * 1.3));
      ctx.fillStyle = `rgba(74, 222, 128, ${pulse.toFixed(2)})`;
      ctx.fillRect(x, ly, 2, 2);
    } else if (engineStatus === 'degraded') {
      if (i === count - 1) {
        ctx.fillStyle = 'rgba(40, 46, 60, 0.9)'; // one bank down
      } else {
        const pulse = 0.4 + 0.5 * Math.abs(Math.sin(now / 500 + i));
        ctx.fillStyle = `rgba(251, 191, 36, ${pulse.toFixed(2)})`;
      }
      ctx.fillRect(x, ly, 2, 2);
    } else {
      // offline/unknown: lights down, single dim standby on top
      ctx.fillStyle = i === 0 ? 'rgba(148, 60, 60, 0.5)' : 'rgba(40, 46, 60, 0.9)';
      ctx.fillRect(x, ly, 2, 2);
    }
  }
  ctx.restore();
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
  engineStatus: EngineStatus = 'unknown',
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

  drawScreens(ctx, agents, now, engineStatus);
  drawServerLeds(ctx, now, engineStatus);
  drawStationNameplates(ctx);
  for (const agent of agents) {
    drawStateMarker(ctx, agent, now);
    drawAgentLabel(ctx, agent);
  }
}
