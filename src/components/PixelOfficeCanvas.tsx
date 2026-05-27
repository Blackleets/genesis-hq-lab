import { useEffect, useMemo, useRef, useState } from 'react';
import {
  actions,
  useAgents,
  useEvents,
  useFiredAgents,
  useSelectedAgent,
  useSelectedLanguage,
  useTasks,
} from '../state/genesisStore';
import type { Agent } from '../types/genesis';
import type { RoomId } from '../types/office';
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
  const latestRef = useRef({
    agents,
    firedAgents,
    tasks,
    events,
    lang,
    selectedAgentId: selectedAgent?.id ?? null,
  });
  const [sprites, setSprites] = useState<LoadedSpriteMap | null>(null);
  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const hoveredAgentIdRef = useRef<string | null>(null);
  const config = useMemo(() => getPixelRendererConfig(), []);

  latestRef.current = {
    agents,
    firedAgents,
    tasks,
    events,
    lang,
    selectedAgentId: selectedAgent?.id ?? null,
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
      }, timestamp);
      const renderAgents = buildRenderAgents(
        [...snapshot.agents, ...snapshot.firedAgents],
        life.visualAgents,
        snapshot.selectedAgentId,
      );
      ctx.imageSmoothingEnabled = false;
      hitboxesRef.current = drawPixelOfficeScene(
        ctx,
        sprites,
        renderAgents,
        life.bubbles,
        hoveredAgentIdRef.current,
      );
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
    <canvas
      ref={canvasRef}
      width={config.width}
      height={config.height}
      className="block"
      style={{
        width: `${config.width}px`,
        height: `${config.height}px`,
        imageRendering: 'pixelated',
      }}
      onMouseMove={handlePointerMove}
      onMouseLeave={handlePointerLeave}
      onClick={handleClick}
    />
  );
}
