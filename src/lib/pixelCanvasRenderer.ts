import { PIXEL_CANVAS_HEIGHT, PIXEL_CANVAS_WIDTH, PIXEL_DOORS, PIXEL_FURNITURE, PIXEL_WALLS, PIXEL_ZONES } from '../data/pixelOfficeMap';
import { pixelSpriteMap } from '../data/pixelSpriteMap';
import { drawCreature, type CreatureKind } from './seaCreatures';
import type { ActiveBubble } from './conversationEngine';
import type { VisualAgentState } from './agentMovement';
import type { Agent } from '../types/genesis';
import type { Lang } from '../i18n/translations';

export interface PixelOfficeHitbox {
  kind: 'agent' | 'room';
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LoadedSpriteMap {
  [path: string]: HTMLImageElement;
}

export interface PixelRenderAgent {
  visual: VisualAgentState;
  agent: Agent;
  spritePath: string;
  frame?: { sx: number; sy: number; sw: number; sh: number };
  selected: boolean;
}

const FLOOR_LINE = '#2a1f15';
const WALL = '#1b1f29';
const WALL_EDGE = '#2c3442';
const BUBBLE_BG = '#f0e9d6';
const BUBBLE_TEXT = '#16181d';
const SELECTION = '#ffd24a';

export function getPixelRendererConfig() {
  return {
    width: PIXEL_CANVAS_WIDTH,
    height: PIXEL_CANVAS_HEIGHT,
  };
}

export function flattenSpritePaths(): string[] {
  return [
    ...Object.values(pixelSpriteMap.characters),
    ...Object.values(pixelSpriteMap.furniture),
  ];
}

export async function loadPixelSprites(): Promise<LoadedSpriteMap> {
  const paths = flattenSpritePaths();
  const entries = await Promise.all(paths.map(async (path) => {
    const image = await loadImage(path);
    return [path, image] as const;
  }));
  return Object.fromEntries(entries);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${src}`));
    image.src = src;
  });
}

export function buildRenderAgents(
  agents: Agent[],
  visualAgents: VisualAgentState[],
  selectedAgentId: string | null,
): PixelRenderAgent[] {
  const renderAgents: PixelRenderAgent[] = [];

  for (const visual of visualAgents) {
    const agent = agents.find((entry) => entry.id === visual.agentId);
    if (!agent) continue;
    const sprite = spriteForAgent(agent, visual);
    renderAgents.push({
      visual,
      agent,
      spritePath: sprite.path,
      frame: sprite.frame,
      selected: selectedAgentId === agent.id,
    });
  }

  return renderAgents;
}

function spriteForAgent(agent: Agent, visual: VisualAgentState): { path: string; frame?: { sx: number; sy: number; sw: number; sh: number } } {
  if (agent.id === 'visual-genesis-core') return { path: pixelSpriteMap.characters.boss };
  if (agent.id === 'visual-market-scanner') return { path: pixelSpriteMap.characters.worker1 };
  if (agent.id === 'visual-risk-guardian') return { path: pixelSpriteMap.characters.worker2 };
  if (agent.id === 'visual-memory-curator') {
    if (visual.animation === 'walk') {
      return {
        path: pixelSpriteMap.characters.juliaWalkForward,
        frame: {
          sx: visual.frameIndex === 0 ? 0 : 64,
          sy: 0,
          sw: 64,
          sh: 64,
        },
      };
    }
    return {
      path: pixelSpriteMap.characters.juliaIdle,
      frame: {
        sx: visual.frameIndex === 0 ? 0 : 32,
        sy: 0,
        sw: 32,
        sh: 32,
      },
    };
  }
  if (agent.id === 'visual-hr-evaluator') return { path: pixelSpriteMap.characters.worker4 };
  if (agent.status === 'onboarding') return { path: pixelSpriteMap.characters.worker1 };
  if (agent.department === 'Genesis HR') return { path: pixelSpriteMap.characters.worker4 };
  if (agent.department === 'Risk Office') return { path: pixelSpriteMap.characters.worker2 };
  return { path: pixelSpriteMap.characters.worker1 };
}

export function drawPixelOfficeScene(
  ctx: CanvasRenderingContext2D,
  sprites: LoadedSpriteMap,
  renderAgents: PixelRenderAgent[],
  bubbles: ActiveBubble[],
  hoveredAgentId: string | null,
  lang: Lang = 'en',
  taskProgressMap: Record<string, number> = {},
  devMode: boolean = false,
  blockedRoomIds: Set<string> = new Set(),
) {
  ctx.clearRect(0, 0, PIXEL_CANVAS_WIDTH, PIXEL_CANVAS_HEIGHT);
  ctx.imageSmoothingEnabled = false;

  drawFloor(ctx);
  drawRugs(ctx);
  drawTaskAlertGlow(ctx, blockedRoomIds);
  drawWalls(ctx);
  drawFurniture(ctx, sprites);
  // Room labels are static chrome → draw before agents so bubbles sit on top.
  drawLabels(ctx, lang);
  drawRoomOccupancyBadges(ctx, renderAgents);
  const hitboxes = drawAgents(ctx, sprites, renderAgents);
  drawSelectionHighlights(ctx, renderAgents, hoveredAgentId);
  drawIndicators(ctx, renderAgents);
  drawTaskProgressArcs(ctx, renderAgents, taskProgressMap);
  drawAgentLabels(ctx, renderAgents);
  drawAgentWorkPanels(ctx, renderAgents, taskProgressMap);
  // Speech bubbles are dynamic → always render on top of everything.
  drawSpeechBubbles(ctx, renderAgents, bubbles);
  if (devMode) drawDevModeOverlays(ctx, renderAgents);
  drawClock(ctx);
  drawMinimap(ctx, renderAgents);

  hitboxes.push(...PIXEL_ZONES.map((zone) => ({
    kind: 'room' as const,
    id: zone.id,
    x: zone.x,
    y: zone.y,
    width: zone.width,
    height: zone.height,
  })));

  return hitboxes;
}

function drawTaskProgressArcs(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
  taskProgressMap: Record<string, number>,
) {
  for (const renderAgent of agents) {
    const pct = taskProgressMap[renderAgent.agent.id];
    if (renderAgent.visual.animation !== 'work' || !pct || pct <= 0) continue;
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const cx = renderAgent.visual.x + 10;
    const cy = renderAgent.visual.y - 22;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + 2 * Math.PI * Math.min(pct, 1);
    ctx.arc(cx, cy, 6, startAngle, endAngle, false);
    ctx.stroke();
    ctx.restore();
  }
}

function drawDevModeOverlays(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
) {
  ctx.save();
  ctx.font = '7px monospace';
  ctx.fillStyle = '#00ff9c';
  ctx.globalAlpha = 0.85;
  for (const renderAgent of agents) {
    const name = renderAgent.agent.name;
    const short = name.length > 10 ? name.slice(0, 9) + '…' : name;
    ctx.fillText(short, renderAgent.visual.x - 14, renderAgent.visual.y - 28);
  }
  ctx.restore();
}

function drawFloor(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#4b341f';
  ctx.fillRect(0, 0, PIXEL_CANVAS_WIDTH, PIXEL_CANVAS_HEIGHT);

  for (let y = 0; y < PIXEL_CANVAS_HEIGHT; y += 16) {
    ctx.fillStyle = FLOOR_LINE;
    ctx.fillRect(0, y, PIXEL_CANVAS_WIDTH, 1);
  }

  for (let x = 20; x < PIXEL_CANVAS_WIDTH; x += 56) {
    ctx.fillStyle = '#5a4029';
    ctx.fillRect(x, 0, 1, PIXEL_CANVAS_HEIGHT);
  }
}

function drawRugs(ctx: CanvasRenderingContext2D) {
  for (const zone of PIXEL_ZONES) {
    ctx.fillStyle = zone.rugColor;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#0f1218';
    ctx.fillRect(zone.x + 4, zone.y + 4, zone.width - 8, zone.height - 8);
    ctx.globalAlpha = 1;
  }
}

function drawWalls(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = WALL;
  for (const wall of PIXEL_WALLS) {
    ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
    ctx.fillStyle = WALL_EDGE;
    ctx.fillRect(wall.x, wall.y, wall.width, 2);
    ctx.fillStyle = WALL;
  }

  for (const door of PIXEL_DOORS) {
    ctx.fillStyle = door.color;
    ctx.globalAlpha = 0.8;
    ctx.fillRect(door.x, door.y, door.width, door.height);
    ctx.globalAlpha = 1;
  }
}

function drawFurniture(ctx: CanvasRenderingContext2D, sprites: LoadedSpriteMap) {
  for (const placement of PIXEL_FURNITURE) {
    const path = pixelSpriteMap.furniture[placement.sprite];
    const image = sprites[path];
    if (!image) continue;

    ctx.save();
    ctx.globalAlpha = placement.alpha ?? 1;
    if (placement.flipX) {
      ctx.translate(placement.x + placement.width, placement.y);
      ctx.scale(-1, 1);
      ctx.drawImage(image, 0, 0, placement.width, placement.height);
    } else {
      ctx.drawImage(image, placement.x, placement.y, placement.width, placement.height);
    }
    ctx.restore();
  }
}

// Map an agent to its sea creature. CEO=whale, trader=shark, risk=pufferfish,
// memory=octopus, HR=crab, research/analyst=squid, generic=fish.
function creatureForAgent(agent: Agent): CreatureKind {
  switch (agent.id) {
    case 'visual-genesis-core':   return 'whale';
    case 'visual-market-scanner': return 'shark';
    case 'visual-risk-guardian':  return 'pufferfish';
    case 'visual-memory-curator': return 'octopus';
    case 'visual-hr-evaluator':   return 'crab';
  }
  const dept = (agent.department ?? '').toLowerCase();
  if (dept.includes('board'))  return 'whale';
  if (dept.includes('market') || dept.includes('trad') || dept.includes('execution')) return 'shark';
  if (dept.includes('risk'))   return 'pufferfish';
  if (dept.includes('memory')) return 'octopus';
  if (dept.includes('hr') || dept.includes('people')) return 'crab';
  if (dept.includes('research') || dept.includes('strategy') || dept.includes('market room')) return 'squid';
  return 'fish';
}

function glowForState(animation: VisualAgentState['animation']): string | null {
  switch (animation) {
    case 'work':    return '#00ff9c';
    case 'talk':    return '#22d3ee';
    case 'warning': return '#ff4757';
    case 'think':   return '#a855f7';
    default:        return null;
  }
}

function drawAgents(
  ctx: CanvasRenderingContext2D,
  _sprites: LoadedSpriteMap,
  agents: PixelRenderAgent[],
) {
  const hitboxes: PixelOfficeHitbox[] = [];

  for (const renderAgent of agents) {
    const { visual, agent } = renderAgent;
    const isFired = visual.animation === 'fired';

    // Floor point (bottom-center) with bob applied
    const cx = visual.x;
    const cy = visual.y - visual.bobOffset;

    // Shadow on the floor
    ctx.save();
    ctx.globalAlpha = isFired ? 0.2 : 0.4;
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.ellipse(visual.x, visual.y + 1, 11, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Per-agent blink: a short blink every ~3.2s, phase-offset by agent id.
    const now = Date.now();
    const seed = agent.id.charCodeAt(agent.id.length - 1) * 137;
    const blink = ((now + seed) % 3200) < 140;
    const active = visual.animation === 'work' || visual.animation === 'talk';

    // The creature
    drawCreature(ctx, creatureForAgent(agent), cx, cy, {
      frame: visual.frameIndex,
      facingLeft: visual.facing === 'west',
      glow: glowForState(visual.animation),
      alpha: isFired ? 0.4 : 1,
      blink,
      active,
      nowMs: now,
    });

    // Onboarding badge
    if (agent.status === 'onboarding') {
      ctx.fillStyle = '#ffb547';
      ctx.fillRect(cx + 8, cy - 24, 6, 6);
    }

    // Hitbox: a box around the creature footprint
    const drawX = visual.x - Math.round(visual.width / 2);
    const drawY = cy - Math.round(visual.height * 0.95);
    hitboxes.push({
      kind: 'agent',
      id: agent.id,
      x: drawX,
      y: drawY,
      width: visual.width,
      height: visual.height,
    });
  }

  return hitboxes;
}

// Map room IDs to 2-letter codes shown in the work panel
const ROOM_CODE: Record<string, string> = {
  'market-desk':    'MK',
  'risk-bunker':    'RK',
  'memory-archive': 'MA',
  'hr-pod':         'HR',
  'board-room':     'BD',
  'debate-room':    'DB',
  'strategy-lab':   'ST',
  'execution-desk': 'EX',
  'open-workspace': 'WS',
};

function drawAgentLabels(ctx: CanvasRenderingContext2D, agents: PixelRenderAgent[]) {
  ctx.save();
  ctx.font = '7px monospace';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  for (const ra of agents) {
    if (ra.visual.animation === 'fired') continue;

    const firstName = ra.agent.name.split(' ')[0].slice(0, 9);
    const textW = Math.round(firstName.length * 4.0) + 2;
    const lx = ra.visual.x;
    const ly = ra.visual.y + 9;

    // Dark backing for readability
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(lx - textW / 2 - 3, ly - 7, textW + 6, 9);
    ctx.globalAlpha = 1;

    // Status dot (4×4) to the left of the name
    ctx.fillStyle = statusColor(ra.visual.animation);
    ctx.fillRect(lx - textW / 2 - 2, ly - 5, 3, 3);

    // Name text
    const isActive = ra.visual.animation === 'work' || ra.visual.animation === 'talk';
    ctx.fillStyle = isActive ? '#e4e4e7' : '#71717a';
    ctx.fillText(firstName, lx + 1, ly);
  }

  ctx.textAlign = 'left';
  ctx.restore();
}

function drawAgentWorkPanels(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
  taskProgressMap: Record<string, number>,
) {
  ctx.save();
  const PW = 56; // panel width
  const PH = 18; // panel height

  for (const ra of agents) {
    if (ra.visual.animation !== 'work' && ra.visual.animation !== 'talk') continue;

    const px = Math.max(2, Math.min(PIXEL_CANVAS_WIDTH - PW - 2, ra.visual.x - PW / 2));
    const py = Math.max(2, ra.visual.y - 54);

    // Panel background
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#0f1420';
    ctx.fillRect(px, py, PW, PH);
    ctx.globalAlpha = 1;

    // Accent border (blue/green depending on state)
    ctx.strokeStyle = ra.visual.animation === 'work' ? '#00ff9c66' : '#3da9fc66';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, PW - 1, PH - 1);

    // Room code badge
    const code = ROOM_CODE[ra.agent.currentRoom ?? ''] ?? '??';
    ctx.font = '6px monospace';
    ctx.fillStyle = ra.visual.animation === 'work' ? '#00ff9c' : '#3da9fc';
    ctx.fillText(code, px + 3, py + 8);

    // Progress bar or pulsing dots
    const pct = taskProgressMap[ra.agent.id];
    const barX = px + 17;
    const barY = py + 4;
    const barW = PW - 20;

    ctx.fillStyle = '#1e2535';
    ctx.fillRect(barX, barY, barW, 5);

    if (pct !== undefined && pct > 0) {
      ctx.fillStyle = '#00ff9c';
      ctx.fillRect(barX, barY, Math.round(barW * Math.min(pct, 1)), 5);
    } else {
      // Pulsing dots when no progress data — alternate with frameIndex
      const dotColor = ra.visual.frameIndex === 0 ? '#3da9fc' : '#1e4a6e';
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = i === ra.visual.frameIndex ? '#3da9fc' : dotColor;
        ctx.fillRect(barX + i * 7 + 2, barY + 1, 3, 3);
      }
    }

    // Task percentage text
    if (pct !== undefined && pct > 0) {
      ctx.font = '5px monospace';
      ctx.fillStyle = '#6b7280';
      ctx.fillText(`${Math.round(pct * 100)}%`, px + 3, py + 17);
    }
  }

  ctx.restore();
}

const BUBBLE_CHAR_PX = 4.4;   // approx width of one 8px-monospace glyph
const BUBBLE_MAX_WIDTH = 132; // px — caps how wide a bubble can grow
const BUBBLE_MAX_VISIBLE = 4; // only the freshest N bubbles render at once

function truncateToWidth(text: string, maxWidth: number): string {
  const maxChars = Math.floor((maxWidth - 12) / BUBBLE_CHAR_PX);
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return '…';
  return text.slice(0, maxChars - 1).trimEnd() + '…';
}

function drawSpeechBubbles(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
  bubbles: ActiveBubble[],
) {
  // Show only the freshest few bubbles so the floor never fills with text.
  const visible = [...bubbles]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, BUBBLE_MAX_VISIBLE);

  // Track occupied label/bubble bands to avoid stacking text on the same row.
  const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];

  for (const bubble of visible) {
    const agent = agents.find((entry) => entry.agent.id === bubble.agentId);
    if (!agent) continue;

    const text = truncateToWidth(bubble.text, BUBBLE_MAX_WIDTH);
    const bubbleWidth = Math.min(BUBBLE_MAX_WIDTH, Math.max(48, Math.round(text.length * BUBBLE_CHAR_PX) + 12));
    const bubbleX = Math.max(6, Math.min(PIXEL_CANVAS_WIDTH - bubbleWidth - 6, agent.visual.x - bubbleWidth / 2));
    let bubbleY = Math.max(6, agent.visual.y - 42);

    // Nudge bubble up if it collides with an already-placed bubble.
    for (let guard = 0; guard < 4; guard++) {
      const clash = occupied.some(
        (o) => bubbleY < o.y + o.h && bubbleY + 16 > o.y && bubbleX < o.x + o.w && bubbleX + bubbleWidth > o.x,
      );
      if (!clash) break;
      bubbleY = Math.max(4, bubbleY - 18);
    }
    occupied.push({ x: bubbleX, y: bubbleY, w: bubbleWidth, h: 16 });

    // Drop shadow for separation from the floor/labels.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(bubbleX + 1, bubbleY + 1, bubbleWidth, 16);
    // Bubble body + border.
    ctx.fillStyle = BUBBLE_BG;
    ctx.fillRect(bubbleX, bubbleY, bubbleWidth, 16);
    ctx.strokeStyle = '#b9ad8e';
    ctx.lineWidth = 1;
    ctx.strokeRect(bubbleX + 0.5, bubbleY + 0.5, bubbleWidth - 1, 15);
    // Tail.
    ctx.fillStyle = BUBBLE_BG;
    ctx.fillRect(bubbleX + 8, bubbleY + 16, 6, 4);
    // Text.
    ctx.fillStyle = BUBBLE_TEXT;
    ctx.font = '8px monospace';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, bubbleX + 5, bubbleY + 11);
  }
}

function drawSelectionHighlights(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
  hoveredAgentId: string | null,
) {
  for (const renderAgent of agents) {
    if (!renderAgent.selected && hoveredAgentId !== renderAgent.agent.id) continue;
    const cy = renderAgent.visual.y - renderAgent.visual.bobOffset;
    const drawX = renderAgent.visual.x - Math.round(renderAgent.visual.width / 2);
    const drawY = cy - Math.round(renderAgent.visual.height * 0.95);
    ctx.strokeStyle = renderAgent.selected ? SELECTION : '#ffffff';
    ctx.lineWidth = 2;
    ctx.strokeRect(drawX - 2, drawY - 2, renderAgent.visual.width + 4, renderAgent.visual.height + 4);
  }
}

function drawIndicators(ctx: CanvasRenderingContext2D, agents: PixelRenderAgent[]) {
  for (const renderAgent of agents) {
    ctx.fillStyle = statusColor(renderAgent.visual.animation);
    ctx.fillRect(renderAgent.visual.x + 10, renderAgent.visual.y - 22, 6, 6);
    if (renderAgent.visual.animation === 'warning') {
      ctx.fillStyle = '#16181d';
      ctx.fillRect(renderAgent.visual.x + 12, renderAgent.visual.y - 20, 2, 4);
    }
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, lang: Lang) {
  ctx.font = '8px monospace';
  ctx.textBaseline = 'alphabetic';
  for (const zone of PIXEL_ZONES) {
    const label = zone.label[lang].toUpperCase();
    const w = Math.round(label.length * 4.4) + 8;
    // Dark backing pill keeps the label readable under bubbles/furniture.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = '#0d1016';
    ctx.fillRect(zone.labelX - 3, zone.labelY - 8, w, 11);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#d7dee6';
    ctx.fillText(label, zone.labelX, zone.labelY);
  }
}

function statusColor(animation: VisualAgentState['animation']) {
  switch (animation) {
    case 'walk':
      return '#3da9fc';
    case 'work':
      return '#00ff9c';
    case 'warning':
      return '#ffb547';
    case 'talk':
      return '#22d3ee';
    case 'think':
      return '#a855f7';
    case 'onboarding':
      return '#ffb547';
    case 'fired':
      return '#ff4757';
    default:
      return '#b7bec7';
  }
}

function drawTaskAlertGlow(ctx: CanvasRenderingContext2D, blockedRoomIds: Set<string>) {
  if (blockedRoomIds.size === 0) return;
  ctx.save();
  for (const zone of PIXEL_ZONES) {
    if (!blockedRoomIds.has(zone.id)) continue;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = 'rgba(255,71,87,0.08)';
    ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = '#ff4757';
    ctx.lineWidth = 1;
    ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);
  }
  ctx.restore();
}

function agentStatusDotColor(animation: VisualAgentState['animation']): string {
  switch (animation) {
    case 'work':       return '#00ff9c';
    case 'walk':       return '#3da9fc';
    case 'onboarding': return '#ffd24a';
    case 'warning':    return '#ff4757';
    case 'fired':      return '#ff4757';
    default:           return '#4a5568';
  }
}

function drawRoomOccupancyBadges(ctx: CanvasRenderingContext2D, agents: PixelRenderAgent[]) {
  ctx.save();
  for (const zone of PIXEL_ZONES) {
    const zoneAgents = agents.filter((a) => a.agent.currentRoom === zone.id);
    if (zoneAgents.length === 0) continue;
    const allWorking = zoneAgents.every((a) => a.visual.animation === 'work');
    const anyWorking = zoneAgents.some((a) => a.visual.animation === 'work');
    const color = allWorking ? '#00ff9c' : anyWorking ? '#3da9fc' : '#4a5568';
    const bx = zone.x + zone.width - 12;
    const by = zone.y + 10;
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.font = '7px monospace';
    ctx.fillStyle = '#16181d';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(zoneAgents.length), bx, by + 0.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  ctx.restore();
}

function drawClock(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.font = '7px monospace';
  ctx.fillStyle = '#4a5568';
  ctx.globalAlpha = 0.8;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  ctx.fillText(time, PIXEL_CANVAS_WIDTH - 52, 11);
  ctx.restore();
}

function drawMinimap(ctx: CanvasRenderingContext2D, agents: PixelRenderAgent[]) {
  const MW = 128;
  const MH = 72;
  const MX = PIXEL_CANVAS_WIDTH - MW - 6;
  const MY = PIXEL_CANVAS_HEIGHT - MH - 6;
  const scaleX = MW / PIXEL_CANVAS_WIDTH;
  const scaleY = MH / PIXEL_CANVAS_HEIGHT;

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = '#0e1117';
  ctx.fillRect(MX, MY, MW, MH);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = '#27272a';
  ctx.lineWidth = 1;
  ctx.strokeRect(MX, MY, MW, MH);

  // Draw zones
  ctx.globalAlpha = 0.4;
  for (const zone of PIXEL_ZONES) {
    ctx.fillStyle = zone.rugColor;
    ctx.fillRect(
      MX + zone.x * scaleX,
      MY + zone.y * scaleY,
      zone.width * scaleX,
      zone.height * scaleY,
    );
  }

  // Draw agent dots
  ctx.globalAlpha = 1;
  for (const ra of agents) {
    ctx.fillStyle = agentStatusDotColor(ra.visual.animation);
    ctx.fillRect(
      MX + ra.visual.x * scaleX - 1,
      MY + ra.visual.y * scaleY - 1,
      2,
      2,
    );
  }

  // Label
  ctx.globalAlpha = 0.5;
  ctx.font = '5px monospace';
  ctx.fillStyle = '#6b7280';
  ctx.fillText('MAP', MX + 3, MY + 7);
  ctx.restore();
}

export function pickHitbox(hitboxes: PixelOfficeHitbox[], x: number, y: number) {
  return hitboxes.find((hitbox) =>
    x >= hitbox.x &&
    x <= hitbox.x + hitbox.width &&
    y >= hitbox.y &&
    y <= hitbox.y + hitbox.height
  ) ?? null;
}
