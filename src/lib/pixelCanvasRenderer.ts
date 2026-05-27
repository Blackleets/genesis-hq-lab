import { PIXEL_CANVAS_HEIGHT, PIXEL_CANVAS_WIDTH, PIXEL_DOORS, PIXEL_FURNITURE, PIXEL_WALLS, PIXEL_ZONES } from '../data/pixelOfficeMap';
import { pixelSpriteMap } from '../data/pixelSpriteMap';
import type { ActiveBubble } from './conversationEngine';
import type { VisualAgentState } from './agentMovement';
import type { Agent } from '../types/genesis';

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
) {
  ctx.clearRect(0, 0, PIXEL_CANVAS_WIDTH, PIXEL_CANVAS_HEIGHT);
  ctx.imageSmoothingEnabled = false;

  drawFloor(ctx);
  drawRugs(ctx);
  drawWalls(ctx);
  drawFurniture(ctx, sprites);
  const hitboxes = drawAgents(ctx, sprites, renderAgents);
  drawSpeechBubbles(ctx, renderAgents, bubbles);
  drawSelectionHighlights(ctx, renderAgents, hoveredAgentId);
  drawIndicators(ctx, renderAgents);
  drawLabels(ctx);

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

function drawAgents(
  ctx: CanvasRenderingContext2D,
  sprites: LoadedSpriteMap,
  agents: PixelRenderAgent[],
) {
  const hitboxes: PixelOfficeHitbox[] = [];

  for (const renderAgent of agents) {
    const image = sprites[renderAgent.spritePath];
    if (!image) continue;

    const isFired = renderAgent.visual.animation === 'fired';
    if (isFired) ctx.globalAlpha = 0.4;

    const drawX = renderAgent.visual.x - Math.round(renderAgent.visual.width / 2);
    const drawY = renderAgent.visual.y - Math.round(renderAgent.visual.height * 0.85) - renderAgent.visual.bobOffset;

    ctx.fillStyle = '#00000066';
    ctx.fillRect(drawX + 6, renderAgent.visual.y - 2, renderAgent.visual.width - 12, 4);

    if (renderAgent.frame) {
      const { sx, sy, sw, sh } = renderAgent.frame;
      ctx.drawImage(image, sx, sy, sw, sh, drawX, drawY, renderAgent.visual.width, renderAgent.visual.height);
    } else {
      ctx.drawImage(image, drawX, drawY, renderAgent.visual.width, renderAgent.visual.height);
    }

    if (renderAgent.agent.status === 'onboarding') {
      ctx.fillStyle = '#ffb547';
      ctx.fillRect(drawX + renderAgent.visual.width - 8, drawY + 2, 6, 6);
    }

    if (isFired) ctx.globalAlpha = 1;

    hitboxes.push({
      kind: 'agent',
      id: renderAgent.agent.id,
      x: drawX,
      y: drawY,
      width: renderAgent.visual.width,
      height: renderAgent.visual.height,
    });
  }

  return hitboxes;
}

function drawSpeechBubbles(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
  bubbles: ActiveBubble[],
) {
  for (const bubble of bubbles) {
    const agent = agents.find((entry) => entry.agent.id === bubble.agentId);
    if (!agent) continue;

    const text = bubble.text;
    const bubbleWidth = Math.min(104, Math.max(52, text.length * 4 + 12));
    const bubbleX = Math.max(8, Math.min(PIXEL_CANVAS_WIDTH - bubbleWidth - 8, agent.visual.x - bubbleWidth / 2));
    const bubbleY = Math.max(8, agent.visual.y - 40);

    ctx.fillStyle = BUBBLE_BG;
    ctx.fillRect(bubbleX, bubbleY, bubbleWidth, 16);
    ctx.fillStyle = '#8d7d5e';
    ctx.fillRect(bubbleX + 8, bubbleY + 16, 6, 4);
    ctx.fillStyle = BUBBLE_TEXT;
    ctx.font = '8px monospace';
    ctx.fillText(text, bubbleX + 4, bubbleY + 11);
  }
}

function drawSelectionHighlights(
  ctx: CanvasRenderingContext2D,
  agents: PixelRenderAgent[],
  hoveredAgentId: string | null,
) {
  for (const renderAgent of agents) {
    if (!renderAgent.selected && hoveredAgentId !== renderAgent.agent.id) continue;
    const drawX = renderAgent.visual.x - Math.round(renderAgent.visual.width / 2);
    const drawY = renderAgent.visual.y - Math.round(renderAgent.visual.height * 0.85) - renderAgent.visual.bobOffset;
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

function drawLabels(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#c7d1dd';
  ctx.font = '8px monospace';
  for (const zone of PIXEL_ZONES) {
    ctx.globalAlpha = 0.72;
    ctx.fillText(zone.label.en.toUpperCase(), zone.labelX, zone.labelY);
  }
  ctx.globalAlpha = 1;
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

export function pickHitbox(hitboxes: PixelOfficeHitbox[], x: number, y: number) {
  return hitboxes.find((hitbox) =>
    x >= hitbox.x &&
    x <= hitbox.x + hitbox.width &&
    y >= hitbox.y &&
    y <= hitbox.y + hitbox.height
  ) ?? null;
}
