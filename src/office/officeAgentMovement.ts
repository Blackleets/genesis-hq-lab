// officeAgentMovement — walkability grid, pathfinding and the per-agent
// state machine for the live tile office (Phase 2).
//
// Walkability is derived from officeLayout: everything above the wall
// base line is blocked, plus every furniture/desk footprint (chairs are
// kept walkable — that's where agents sit). Paths are BFS over the 16px
// tile grid, so agents can never cross walls or furniture.

import {
  FURNITURE,
  OFFICE_GRID_H,
  OFFICE_GRID_W,
  OFFICE_SPRITES,
  STATIONS,
  TILE_SIZE,
  WALL_BASE_Y,
  type OfficeSpriteId,
} from './officeLayout';
import { OFFICE_ZONES, type OfficeZoneId } from './officeZones';
import type { AgentState, LiveOfficeAgent, Waypoint } from './officeTypes';

const WALK_SPEED_PX_S = 30;
const MAX_STEP_MS = 100;

/** Sprites agents may stand on (chairs are seats, not obstacles). */
const NON_BLOCKING: ReadonlySet<OfficeSpriteId> = new Set(['chairA', 'chairB'] as OfficeSpriteId[]);

let walkGrid: boolean[][] | null = null; // true = blocked

function buildWalkGrid(): boolean[][] {
  const grid: boolean[][] = Array.from({ length: OFFICE_GRID_H }, () => new Array<boolean>(OFFICE_GRID_W).fill(false));
  const wallRows = Math.floor(WALL_BASE_Y / TILE_SIZE);
  for (let r = 0; r < wallRows; r++) grid[r].fill(true);

  const blockRect = (x: number, y: number, w: number, h: number) => {
    const c0 = Math.max(0, Math.floor(x / TILE_SIZE));
    const c1 = Math.min(OFFICE_GRID_W - 1, Math.floor((x + w - 1) / TILE_SIZE));
    const r0 = Math.max(0, Math.floor(y / TILE_SIZE));
    const r1 = Math.min(OFFICE_GRID_H - 1, Math.floor((y + h - 1) / TILE_SIZE));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) grid[r][c] = true;
    }
  };

  const placements = [...FURNITURE, ...STATIONS.map((st) => st.desk)];
  for (const f of placements) {
    if (NON_BLOCKING.has(f.sprite)) continue;
    const s = OFFICE_SPRITES[f.sprite];
    blockRect(f.x, f.y, s.w, s.h);
  }
  return grid;
}

function getWalkGrid(): boolean[][] {
  if (!walkGrid) walkGrid = buildWalkGrid();
  return walkGrid;
}

function isBlocked(col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= OFFICE_GRID_W || row >= OFFICE_GRID_H) return true;
  return getWalkGrid()[row][col];
}

const tileCenter = (col: number, row: number): Waypoint => ({
  x: col * TILE_SIZE + TILE_SIZE / 2,
  y: row * TILE_SIZE + TILE_SIZE / 2,
});

/** BFS over the tile grid; returns pixel waypoints or null if unreachable. */
export function findOfficePath(from: Waypoint, to: Waypoint): Waypoint[] | null {
  const fc = Math.floor(from.x / TILE_SIZE);
  const fr = Math.floor(from.y / TILE_SIZE);
  const tc = Math.floor(to.x / TILE_SIZE);
  const tr = Math.floor(to.y / TILE_SIZE);
  if (isBlocked(tc, tr)) return null;
  if (fc === tc && fr === tr) return [to];

  const key = (c: number, r: number) => r * OFFICE_GRID_W + c;
  const parent = new Map<number, number>();
  parent.set(key(fc, fr), -1);
  const queue: number[] = [key(fc, fr)];
  const goal = key(tc, tr);
  let found = false;

  while (queue.length > 0 && !found) {
    const cur = queue.shift()!;
    const cc = cur % OFFICE_GRID_W;
    const cr = Math.floor(cur / OFFICE_GRID_W);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nc = cc + dc;
      const nr = cr + dr;
      const nk = key(nc, nr);
      if (isBlocked(nc, nr) || parent.has(nk)) continue;
      parent.set(nk, cur);
      if (nk === goal) {
        found = true;
        break;
      }
      queue.push(nk);
    }
  }
  if (!found) return null;

  const tiles: Waypoint[] = [];
  for (let k = goal; k !== -1; k = parent.get(k)!) {
    tiles.push(tileCenter(k % OFFICE_GRID_W, Math.floor(k / OFFICE_GRID_W)));
  }
  tiles.reverse();

  // drop collinear midpoints so agents walk straight runs smoothly
  const path: Waypoint[] = [];
  for (let i = 0; i < tiles.length; i++) {
    const prev = path[path.length - 1];
    const next = tiles[i + 1];
    if (prev && next && Math.sign(next.x - prev.x) === Math.sign(tiles[i].x - prev.x)
      && Math.sign(next.y - prev.y) === Math.sign(tiles[i].y - prev.y)
      && (prev.x === tiles[i].x && tiles[i].x === next.x || prev.y === tiles[i].y && tiles[i].y === next.y)) {
      continue;
    }
    path.push(tiles[i]);
  }
  path[path.length - 1] = to; // land exactly on the requested point
  return path;
}

function randomPointInZone(zoneId: OfficeZoneId): Waypoint {
  const { area, anchor } = OFFICE_ZONES[zoneId];
  for (let i = 0; i < 8; i++) {
    const p = { x: area.x + Math.random() * area.w, y: area.y + Math.random() * area.h };
    if (!isBlocked(Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE))) return p;
  }
  return { ...anchor };
}

function pickState(agent: LiveOfficeAgent, zone: OfficeZoneId): AgentState {
  const { def } = agent;
  if (zone === def.homeZone) {
    return def.workStates[Math.floor(Math.random() * def.workStates.length)];
  }
  const awayStates: AgentState[] = (['thinking', 'idle'] as AgentState[])
    .filter((s) => def.allowedStates.includes(s));
  return awayStates[Math.floor(Math.random() * awayStates.length)] ?? 'idle';
}

function chooseNextZone(agent: LiveOfficeAgent): OfficeZoneId {
  const roll = Math.random();
  const preferred: OfficeZoneId = roll < 0.55 ? agent.def.homeZone : roll < 0.8 ? 'centralFloor' : 'restArea';
  return preferred;
}

function startWalk(agent: LiveOfficeAgent, zone: OfficeZoneId, now: number) {
  const target = zone === agent.zone ? randomPointInZone(zone) : { ...OFFICE_ZONES[zone].anchor };
  const path = findOfficePath({ x: agent.x, y: agent.y }, target);
  if (!path) {
    agent.state = 'idle';
    agent.stateUntil = now + 3000;
    return;
  }
  agent.path = path;
  agent.pathIndex = 0;
  agent.targetZone = zone;
  agent.state = 'walking';
}

function arrive(agent: LiveOfficeAgent, now: number) {
  agent.zone = agent.targetZone ?? agent.zone;
  agent.targetZone = null;
  agent.path = [];
  agent.pathIndex = 0;
  agent.state = pickState(agent, agent.zone);
  agent.stateUntil = now + 6000 + Math.random() * 8000;
}

function decide(agent: LiveOfficeAgent, now: number) {
  if (Math.random() < 0.45) {
    startWalk(agent, chooseNextZone(agent), now);
    return;
  }
  // stay put, rotate the displayed state
  agent.state = pickState(agent, agent.zone);
  agent.stateUntil = now + 5000 + Math.random() * 7000;
}

function stepWalk(agent: LiveOfficeAgent, dtMs: number, now: number) {
  let budget = (WALK_SPEED_PX_S * dtMs) / 1000;
  while (budget > 0) {
    const target = agent.path[agent.pathIndex];
    if (!target) {
      arrive(agent, now);
      return;
    }
    const dx = target.x - agent.x;
    const dy = target.y - agent.y;
    const dist = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.5) agent.facing = dx >= 0 ? 1 : -1;
    if (dist <= budget) {
      agent.x = target.x;
      agent.y = target.y;
      agent.pathIndex += 1;
      budget -= dist;
    } else {
      agent.x += (dx / dist) * budget;
      agent.y += (dy / dist) * budget;
      budget = 0;
    }
  }
}

/** Advances every agent one frame. Mutates the array elements in place. */
export function stepOfficeAgents(agents: LiveOfficeAgent[], now: number, dtMs: number) {
  const dt = Math.min(dtMs, MAX_STEP_MS);
  for (const agent of agents) {
    if (agent.state === 'walking') {
      stepWalk(agent, dt, now);
    } else if (now >= agent.stateUntil) {
      decide(agent, now);
    }
  }
}
