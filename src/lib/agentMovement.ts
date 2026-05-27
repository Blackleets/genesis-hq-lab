import { workstationsForRoom } from '../data/officeWorkstations';
import type { Agent, Facing } from '../types/genesis';
import type { Task } from '../types/task';

export type VisualAnimationState =
  | 'idle'
  | 'walk'
  | 'work'
  | 'talk'
  | 'think'
  | 'warning'
  | 'onboarding'
  | 'fired';

export interface VisualAgentState {
  agentId: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
  animation: VisualAnimationState;
  frameIndex: 0 | 1;
  bobOffset: number;
  facing: Facing;
  workstationId?: string;
  idleUntil: number;
  idleTargetX: number;
  idleTargetY: number;
  talkUntil: number;
}

interface DesiredTarget {
  x: number;
  y: number;
  baseTargetX: number;
  baseTargetY: number;
  workstationId?: string;
  animation: VisualAnimationState;
  idleUntil: number;
}

interface MovementInput {
  agents: Agent[];
  firedAgents: Agent[];
  tasks: Task[];
  now: number;
  dtMs: number;
}

const WALK_SPEED = 34;
const IDLE_WALK_SPEED = 12;
const SNAP_DISTANCE = 2;

export function updateVisualAgents(
  previous: Record<string, VisualAgentState>,
  input: MovementInput,
): Record<string, VisualAgentState> {
  const allAgents = [...input.agents, ...input.firedAgents];
  const next: Record<string, VisualAgentState> = {};
  const onboardingAgents = input.agents.filter((agent) => agent.status === 'onboarding');
  const occupiedStations = new Set<string>();

  allAgents.forEach((agent, index) => {
    const prior = previous[agent.id];
    const desired = resolveDesiredTarget(agent, onboardingAgents, input.firedAgents, input.tasks, index, input.now, prior, occupiedStations);
    if (desired.workstationId) occupiedStations.add(desired.workstationId);
    const baseX = prior ? prior.x : desired.x;
    const baseY = prior ? prior.y : desired.y;
    const deltaX = desired.x - baseX;
    const deltaY = desired.y - baseY;
    const distance = Math.hypot(deltaX, deltaY);
    const isIdleRoam = desired.animation === 'idle' && (desired.x !== desired.baseTargetX || desired.y !== desired.baseTargetY);
    const speed = desired.animation === 'walk' || desired.animation === 'onboarding' ? WALK_SPEED : isIdleRoam ? IDLE_WALK_SPEED : 0;

    let x = baseX;
    let y = baseY;
    let animation = desired.animation;

    if (speed > 0 && distance > SNAP_DISTANCE) {
      const step = Math.min(distance, speed * input.dtMs / 1000);
      const ratio = step / distance;
      x = Math.round(baseX + deltaX * ratio);
      y = Math.round(baseY + deltaY * ratio);
      animation = desired.animation === 'idle' ? 'walk' : desired.animation;
    } else {
      x = Math.round(desired.x);
      y = Math.round(desired.y);
    }

    const bobOffset = animation === 'walk'
      ? (Math.floor(input.now / 160) % 2 === 0 ? 0 : 1)
      : animation === 'work' || animation === 'talk'
        ? (Math.floor(input.now / 260) % 2 === 0 ? 0 : 1)
        : animation === 'idle' || animation === 'onboarding'
          ? (Math.floor(input.now / 520) % 2 === 0 ? 0 : 1)
          : 0;

    const frameIndex = (animation === 'walk' || animation === 'work') && Math.floor(input.now / 180) % 2 === 1 ? 1 : 0;

    next[agent.id] = {
      agentId: agent.id,
      x,
      y,
      targetX: Math.round(desired.x),
      targetY: Math.round(desired.y),
      width: 28,
      height: 28,
      animation,
      frameIndex,
      bobOffset,
      facing: determineFacing(deltaX, agent.position.facing ?? 'south'),
      workstationId: desired.workstationId,
      idleUntil: desired.idleUntil,
      idleTargetX: desired.x,
      idleTargetY: desired.y,
      talkUntil: prior?.talkUntil ?? 0,
    };
  });

  return next;
}

function resolveDesiredTarget(
  agent: Agent,
  onboardingAgents: Agent[],
  firedAgents: Agent[],
  tasks: Task[],
  index: number,
  now: number,
  prior?: VisualAgentState,
  occupiedStations: Set<string> = new Set(),
): DesiredTarget {
  const activeTask = tasks.find((task) =>
    task.assignedAgentIds.includes(agent.id) &&
    (task.status === 'assigned' || task.status === 'moving' || task.status === 'working' || task.status === 'blocked')
  );

  if (agent.status === 'fired' || firedAgents.some((entry) => entry.id === agent.id)) {
    const stations = workstationsForRoom('fired-archive');
    const station = stations[index % stations.length];
    return {
      x: station.x,
      y: station.y,
      baseTargetX: station.x,
      baseTargetY: station.y,
      workstationId: station.id,
      animation: 'fired' as VisualAnimationState,
      idleUntil: now + 60_000,
    };
  }

  if (agent.status === 'onboarding') {
    const onboardingIndex = onboardingAgents.findIndex((entry) => entry.id === agent.id);
    const stations = workstationsForRoom('hr-pod').filter((station) => station.kind === 'onboarding');
    const station = stations[onboardingIndex % stations.length];
    const roam = idleRoomOffset(station.x, station.y, now, onboardingIndex);
    return {
      x: roam.x,
      y: roam.y,
      baseTargetX: station.x,
      baseTargetY: station.y,
      workstationId: station.id,
      animation: 'onboarding' as VisualAnimationState,
      idleUntil: now + 2400,
    };
  }

  if (activeTask) {
    const roomStations = workstationsForRoom(activeTask.room);
    const preferredIdx = activeTask.assignedAgentIds.indexOf(agent.id) % Math.max(1, roomStations.length);
    const station =
      roomStations.find((s, i) => i >= preferredIdx && !occupiedStations.has(s.id)) ??
      roomStations.find((s) => !occupiedStations.has(s.id)) ??
      roomStations[preferredIdx] ??
      roomStations[0];
    const isArrived = Math.hypot((prior?.x ?? station.x) - station.x, (prior?.y ?? station.y) - station.y) <= SNAP_DISTANCE;
    const animation =
      activeTask.status === 'blocked'
        ? 'warning'
        : activeTask.status === 'working' || (activeTask.status === 'assigned' && isArrived)
          ? 'work'
          : 'walk';
    return {
      x: station.x,
      y: station.y,
      baseTargetX: station.x,
      baseTargetY: station.y,
      workstationId: station.id,
      animation,
      idleUntil: now + 2000,
    };
  }

  const room = agent.currentRoom;
  const roomStations = workstationsForRoom(room);
  const baseStation = roomStations[index % Math.max(1, roomStations.length)] ?? { id: `${room}-fallback`, x: 240, y: 220 };
  const idleUntil = prior?.idleUntil ?? 0;
  const shouldPickNewIdle = !prior || now >= idleUntil || Math.hypot(prior.x - prior.idleTargetX, prior.y - prior.idleTargetY) <= SNAP_DISTANCE;
  const idleTarget = shouldPickNewIdle
    ? idleRoomOffset(baseStation.x, baseStation.y, now, index)
    : { x: prior.idleTargetX, y: prior.idleTargetY };

  return {
    x: idleTarget.x,
    y: idleTarget.y,
    baseTargetX: baseStation.x,
    baseTargetY: baseStation.y,
    workstationId: baseStation.id,
    animation: agent.status === 'warning' ? 'warning' : agent.status === 'thinking' ? 'think' : 'idle',
    idleUntil: shouldPickNewIdle ? now + 2800 + (index % 3) * 500 : idleUntil,
  };
}

function idleRoomOffset(baseX: number, baseY: number, now: number, seed: number) {
  const pattern = (Math.floor(now / 2400) + seed) % 4;
  const offsets = [
    { x: 0, y: 0 },
    { x: 8, y: 0 },
    { x: -8, y: 6 },
    { x: 4, y: -6 },
  ];
  return {
    x: Math.round(baseX + offsets[pattern].x),
    y: Math.round(baseY + offsets[pattern].y),
  };
}

function determineFacing(deltaX: number, fallback: Facing): Facing {
  if (Math.abs(deltaX) < 1) return fallback;
  return deltaX > 0 ? 'east' : 'west';
}
