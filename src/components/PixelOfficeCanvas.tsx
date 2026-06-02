import { useEffect, useMemo, useRef, useState } from 'react';
import {
  actions,
  useAgents,
  useDevMode,
  useEvents,
  useFiredAgents,
  useSelectedAgent,
  useSelectedLanguage,
  useTasks,
} from '../state/genesisStore';
import type { Agent } from '../types/genesis';
import type { RoomId } from '../types/office';
import AgentWorkOverlay from './AgentWorkOverlay';
import type { PixelRenderAgent } from '../lib/pixelCanvasRenderer';
import {
  buildRenderAgents,
  drawPixelOfficeScene,
  getPixelRendererConfig,
  loadPixelSprites,
  pickHitbox,
  type LoadedSpriteMap,
  type PixelOfficeHitbox,
} from '../lib/pixelCanvasRenderer';
import { createPixelLifeRuntime, stepPixelLifeLoop } from '../lib/pixelLifeLoop';
import { useAgentData } from '../hooks/useAgentData';

interface Props {
  scale: number;
  onAgentHover: (agent: Agent | null, screenX: number, screenY: number) => void;
  onRoomClick?: (room: RoomId) => void;
}

export default function PixelOfficeCanvas({ scale, onAgentHover, onRoomClick }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hitboxesRef = useRef<PixelOfficeHitbox[]>([]);
  const runtimeRef = useRef(createPixelLifeRuntime());
  const agents = useAgents();
  const firedAgents = useFiredAgents();
  const tasks = useTasks();
  const events = useEvents();
  const lang = useSelectedLanguage();
  const selectedAgent = useSelectedAgent();
  const devMode = useDevMode();
  const { trades: liveTrades } = useAgentData();   // real backend paper trades
  const latestRef = useRef({
    agents,
    firedAgents,
    tasks,
    events,
    lang,
    selectedAgentId: selectedAgent?.id ?? null,
    devMode,
    liveTrades,
  });
  const [sprites, setSprites] = useState<LoadedSpriteMap | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [activeOverlays, setActiveOverlays] = useState<PixelRenderAgent[]>([]);
  const [overlayProgress, setOverlayProgress] = useState<Record<string, number>>({});
  const hoveredAgentIdRef = useRef<string | null>(null);
  const overlayUpdateRef = useRef<number>(0);
  const frameTimestampsRef = useRef<number[]>([]);  // rolling window for FPS
  const lastRenderMsRef = useRef<number>(0);          // last frame draw time
  const config = useMemo(() => getPixelRendererConfig(), []);

  latestRef.current = {
    agents,
    firedAgents,
    tasks,
    events,
    lang,
    selectedAgentId: selectedAgent?.id ?? null,
    devMode,
    liveTrades,
  };
  hoveredAgentIdRef.current = hoveredAgentId;

  useEffect(() => {
    let active = true;
    loadPixelSprites()
      .then((loaded) => {
        if (active) setSprites(loaded);
      })
      .catch(() => {
        if (active) setSprites({});
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !sprites) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId = 0;

    const tick = (timestamp: number) => {
      const snapshot = latestRef.current;
      const life = stepPixelLifeLoop(runtimeRef.current, {
        agents: snapshot.agents,
        firedAgents: snapshot.firedAgents,
        tasks: snapshot.tasks,
        events: snapshot.events,
        lang: snapshot.lang,
        liveTrades: snapshot.liveTrades,
      }, timestamp);
      const renderAgents = buildRenderAgents(
        [...snapshot.agents, ...snapshot.firedAgents],
        life.visualAgents,
        snapshot.selectedAgentId,
      );
      const taskProgressMap: Record<string, number> = {};
      const blockedRoomIds = new Set<string>();
      for (const task of snapshot.tasks) {
        if (task.status === 'blocked' && task.room) {
          blockedRoomIds.add(task.room);
        }
        if (task.status === 'working' && task.startedAt && task.estimatedMs) {
          // Use Date.now() — task.startedAt is wall-clock, not RAF timestamp
          const elapsed = Date.now() - new Date(task.startedAt).getTime();
          const pct = Math.max(0, Math.min(elapsed / task.estimatedMs, 1));
          for (const agentId of (task.assignedAgentIds ?? [])) {
            taskProgressMap[agentId] = pct;
          }
        }
      }
      ctx.imageSmoothingEnabled = false;
      const renderStart = performance.now();
      hitboxesRef.current = drawPixelOfficeScene(
        ctx,
        sprites,
        renderAgents,
        life.bubbles,
        hoveredAgentIdRef.current,
        snapshot.lang,
        taskProgressMap,
        snapshot.devMode,
        blockedRoomIds,
      );
      lastRenderMsRef.current = performance.now() - renderStart;

      // Rolling FPS: keep last 60 frame timestamps
      frameTimestampsRef.current.push(timestamp);
      if (frameTimestampsRef.current.length > 60) {
        frameTimestampsRef.current.shift();
      }

      // Dev performance overlay — canvas text, no React state
      if (snapshot.devMode) {
        const timestamps = frameTimestampsRef.current;
        const fps = timestamps.length >= 2
          ? Math.round(1000 * (timestamps.length - 1) / (timestamps[timestamps.length - 1] - timestamps[0]))
          : 0;
        const renderMs = lastRenderMsRef.current.toFixed(1);
        const agentCount = renderAgents.length;
        const bubbleCount = life.bubbles.length;

        const lines = [
          `FPS: ${fps}`,
          `render: ${renderMs}ms`,
          `agents: ${agentCount}  bubbles: ${bubbleCount}`,
        ];

        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = 'rgba(10, 10, 20, 0.75)';
        ctx.fillRect(4, 4, 110, lines.length * 10 + 6);
        ctx.fillStyle = '#00ff9c';
        ctx.font = '7px monospace';
        ctx.textBaseline = 'top';
        lines.forEach((line, i) => {
          ctx.fillText(line, 8, 8 + i * 10);
        });
        ctx.restore();
      }

      // Update HTML overlays at ~5fps to avoid excessive re-renders
      if (timestamp - overlayUpdateRef.current > 200) {
        overlayUpdateRef.current = timestamp;
        const working = renderAgents.filter(
          (ra) => ra.visual.animation === 'work' || ra.visual.animation === 'talk',
        );
        setActiveOverlays(working);
        setOverlayProgress({ ...taskProgressMap });
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [sprites]);

  function toInternalCoords(event: React.MouseEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.floor((event.clientX - rect.left) / scale),
      y: Math.floor((event.clientY - rect.top) / scale),
    };
  }

  function handlePointerMove(event: React.MouseEvent<HTMLCanvasElement>) {
    const coords = toInternalCoords(event);
    const hitbox = pickHitbox(hitboxesRef.current, coords.x, coords.y);

    if (hitbox?.kind === 'agent') {
      const hoveredAgent = [...agents, ...firedAgents].find((agent) => agent.id === hitbox.id) ?? null;
      setHoveredAgentId(hitbox.id);
      onAgentHover(hoveredAgent, event.clientX, event.clientY);
      return;
    }

    setHoveredAgentId(null);
    onAgentHover(null, event.clientX, event.clientY);
  }

  function handlePointerLeave() {
    setHoveredAgentId(null);
    onAgentHover(null, 0, 0);
  }

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>) {
    const coords = toInternalCoords(event);
    const hitbox = pickHitbox(hitboxesRef.current, coords.x, coords.y);

    if (!hitbox) {
      actions.setSelectedAgent(null);
      return;
    }

    if (hitbox.kind === 'agent') {
      actions.setSelectedAgent(selectedAgent?.id === hitbox.id ? null : hitbox.id);
      return;
    }

    onRoomClick?.(hitbox.id as RoomId);
  }

  return (
    <div className="relative" style={{ width: `${config.width}px`, height: `${config.height}px` }}>
      <canvas
        ref={canvasRef}
        width={config.width}
        height={config.height}
        className="block absolute inset-0"
        style={{ imageRendering: 'pixelated' }}
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        onClick={handleClick}
      />
      {/* HTML work overlays — positioned in canvas pixel space (800×450) */}
      {activeOverlays.map((ra) => {
        const agentTasks = tasks.filter(
          (t) =>
            t.assignedAgentIds.includes(ra.agent.id) &&
            (t.status === 'working' || t.status === 'assigned'),
        );
        const currentTask = agentTasks[0] ?? null;
        const agentPosition = null;
        return (
          <AgentWorkOverlay
            key={ra.agent.id}
            agent={ra.agent}
            visualX={ra.visual.x}
            visualY={ra.visual.y}
            task={currentTask}
            position={agentPosition}
            lang={lang}
            progress={overlayProgress[ra.agent.id]}
          />
        );
      })}
    </div>
  );
}
