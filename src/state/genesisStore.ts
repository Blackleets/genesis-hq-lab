// Genesis Life Operating System — single source of truth.
// Persisted to localStorage on every commit. React subscribers via
// useSyncExternalStore. Actions are pure imperative helpers.
//
// What lives here:
//   - agents (active + onboarding + fired)
//   - tasks (queued / assigned / working / completed / failed)
//   - events (append-only log; bubble layer + activity feed both read it)
//   - modules (per-id state + unlocked timestamp)
//   - office upgrades
//   - hiring queue
//   - meta (bornAt, devMode)
//
// All actions emit events. The bubble layer reads recent voiced events.

import { useSyncExternalStore } from 'react';
import { load, save } from './persistence';
import { INITIAL_AGENTS } from '../data/initialAgents';
import { INITIAL_TASKS } from '../data/initialTasks';
import { FUTURE_AGENTS } from '../data/futureAgents';
import { MODULES } from '../data/moduleRegistry';
import { OFFICE_ROOMS } from '../data/officeRooms';
import type { Agent } from '../types/genesis';
import type { Task, TaskType } from '../types/task';
import type { SystemEvent } from '../types/event';
import type { HiringCandidate } from '../types/hiring';
import type { OfficeUpgrade, RoomId } from '../types/office';
import type { ModuleEntity, ModuleId, ModuleState } from '../types/module';

// ---------- shape ----------

export interface GenesisStateShape {
  meta: {
    bornAt: string;
    devMode: boolean;
  };
  agents: Record<string, Agent>;
  hiringQueue: Record<string, HiringCandidate>;
  firedAgents: Record<string, Agent>;
  tasks: Record<string, Task>;
  events: SystemEvent[];
  modules: Record<ModuleId, ModuleEntity>;
  officeUpgrades: Record<string, OfficeUpgrade>;
}

// ---------- initial state ----------

function buildInitialState(): GenesisStateShape {
  const now = new Date().toISOString();
  return {
    meta: { bornAt: now, devMode: false },
    agents: Object.fromEntries(INITIAL_AGENTS.map((a) => [a.id, a])),
    hiringQueue: Object.fromEntries(
      FUTURE_AGENTS.map((c) => [c.id, { ...c } as HiringCandidate])
    ),
    firedAgents: {},
    tasks: Object.fromEntries(INITIAL_TASKS.map((t) => [t.id, t])),
    events: [
      {
        id: `ev-boot-${Date.now()}`,
        at: now,
        kind: 'system.boot',
        severity: 'info',
        message: {
          es: 'Génesis nació con 5 agentes activos.',
          en: 'Genesis was born with 5 active agents.',
        },
        isVisualSeed: true,
      },
    ],
    modules: Object.fromEntries(
      MODULES.map((m) => [
        m.id,
        {
          id: m.id,
          state: m.state,
          isImplemented: m.state === 'ready' || m.state === 'visual-only',
          isLocked: m.state !== 'ready' && m.state !== 'visual-only',
        } as ModuleEntity,
      ])
    ) as Record<ModuleId, ModuleEntity>,
    officeUpgrades: {},
  };
}

// ---------- store ----------

let state: GenesisStateShape = (() => {
  const loaded = load<GenesisStateShape>();
  if (loaded && loaded.meta && loaded.agents) return loaded;
  return buildInitialState();
})();

const listeners = new Set<() => void>();

function commit(next: GenesisStateShape) {
  state = next;
  save(state);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): GenesisStateShape {
  return state;
}

export function useGenesisState(): GenesisStateShape {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function getState(): GenesisStateShape {
  return state;
}

// ---------- event helpers ----------

let evSeq = 0;
function makeEventId(): string {
  evSeq += 1;
  return `ev-${Date.now()}-${evSeq}`;
}

function appendEvent(s: GenesisStateShape, ev: Omit<SystemEvent, 'id' | 'at'>): GenesisStateShape {
  const event: SystemEvent = {
    id: makeEventId(),
    at: new Date().toISOString(),
    ...ev,
  };
  const next = [...s.events, event];
  // Keep the last 200 entries to bound persistence size.
  const trimmed = next.length > 200 ? next.slice(next.length - 200) : next;
  return { ...s, events: trimmed };
}

// ---------- actions ----------

const TWENTY_FOUR_HOURS_MS = 1000 * 60 * 60 * 24;

export const actions = {
  reset(): void {
    commit(buildInitialState());
  },

  setDevMode(devMode: boolean): void {
    commit({ ...state, meta: { ...state.meta, devMode } });
  },

  hireAgent(candidateId: string): void {
    const candidate = state.hiringQueue[candidateId];
    if (!candidate) return;
    const room = roomForDepartment(candidate.department);
    const entry = OFFICE_ROOMS[room].entryPoint;
    const id = `hired-${candidateId.replace(/^future-/, '')}-${Date.now()}`;
    const now = new Date().toISOString();
    const endsAt = new Date(Date.now() + TWENTY_FOUR_HOURS_MS).toISOString();
    const newAgent: Agent = {
      id,
      name: candidate.name.en,
      role: candidate.role,
      department: candidate.department,
      rank: 'junior',
      status: 'onboarding',
      currentTaskId: null,
      currentTask: null,
      trustScore: 0.45,
      learningScore: 0.1,
      visualProfile: {
        archetype: candidate.archetype,
        primary: '#9ca3af',
        accent: '#3da9fc',
        accessory: 'none',
      },
      position: { ...entry, pose: 'standing', facing: 'south' },
      currentRoom: room,
      movementState: 'still',
      hiredAt: now,
      onboardingStartedAt: now,
      onboardingEndsAt: endsAt,
      isVisualSeed: true,
      capabilities: [],
    };
    const { [candidateId]: _, ...restQueue } = state.hiringQueue;
    void _;
    let next: GenesisStateShape = {
      ...state,
      hiringQueue: restQueue,
      agents: { ...state.agents, [id]: newAgent },
    };
    next = appendEvent(next, {
      kind: 'agent.hired',
      severity: 'info',
      agentId: id,
      message: {
        es: `Génesis contrató a ${candidate.name.es}.`,
        en: `Genesis hired ${candidate.name.en}.`,
      },
      voicedBy: 'visual-genesis-core',
      voicedText: {
        es: `HR, inicia onboarding de ${candidate.name.es}.`,
        en: `HR, start onboarding for ${candidate.name.en}.`,
      },
      isVisualSeed: true,
    });
    next = appendEvent(next, {
      kind: 'agent.onboarding.start',
      severity: 'info',
      agentId: id,
      message: {
        es: `Onboarding iniciado para ${candidate.name.es}. Estará activo en 24 horas.`,
        en: `Onboarding started for ${candidate.name.en}. Will be active in 24h.`,
      },
      voicedBy: 'visual-hr-evaluator',
      voicedText: {
        es: `Onboarding iniciado. Estará activo en 24h.`,
        en: `Onboarding started. Active in 24h.`,
      },
      isVisualSeed: true,
    });
    next = appendEvent(next, {
      kind: 'agent.says',
      severity: 'info',
      agentId: id,
      voicedBy: id,
      voicedText: {
        es: `Hola, soy ${candidate.name.es}. Aprenderé las reglas de Génesis.`,
        en: `Hi, I'm ${candidate.name.en}. I'll learn the rules of Genesis.`,
      },
      message: {
        es: `${candidate.name.es} se presentó al equipo.`,
        en: `${candidate.name.en} introduced itself.`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  completeOnboarding(agentId: string): void {
    const a = state.agents[agentId];
    if (!a || a.status !== 'onboarding') return;
    const updated: Agent = {
      ...a,
      status: 'idle',
      onboardingEndsAt: undefined,
    };
    let next: GenesisStateShape = {
      ...state,
      agents: { ...state.agents, [agentId]: updated },
    };
    next = appendEvent(next, {
      kind: 'agent.onboarding.end',
      severity: 'info',
      agentId,
      message: {
        es: `${a.name} terminó onboarding y está activo.`,
        en: `${a.name} completed onboarding and is now active.`,
      },
      voicedBy: 'visual-hr-evaluator',
      voicedText: {
        es: `${a.name} listo para trabajar.`,
        en: `${a.name} ready for work.`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  fireAgent(agentId: string, reason?: string): void {
    const a = state.agents[agentId];
    if (!a) return;
    const fired: Agent = { ...a, status: 'fired' };
    const { [agentId]: _, ...rest } = state.agents;
    void _;
    let next: GenesisStateShape = {
      ...state,
      agents: rest,
      firedAgents: { ...state.firedAgents, [agentId]: fired },
    };
    next = appendEvent(next, {
      kind: 'agent.fired',
      severity: 'warn',
      agentId,
      message: {
        es: `${a.name} fue despedido. ${reason ?? ''}`.trim(),
        en: `${a.name} was fired. ${reason ?? ''}`.trim(),
      },
      voicedBy: 'visual-hr-evaluator',
      voicedText: {
        es: `Despido registrado.`,
        en: `Termination recorded.`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  createTask(input: Omit<Task, 'id' | 'status' | 'createdAt'>): string {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: Task = {
      ...input,
      id,
      status: 'queued',
      createdAt: new Date().toISOString(),
    };
    let next: GenesisStateShape = { ...state, tasks: { ...state.tasks, [id]: task } };
    next = appendEvent(next, {
      kind: 'task.created',
      severity: 'info',
      taskId: id,
      message: {
        es: `Nueva tarea creada: ${task.title.es}.`,
        en: `New task created: ${task.title.en}.`,
      },
      voicedBy: 'visual-genesis-core',
      voicedText: {
        es: 'Asigno una tarea nueva.',
        en: 'Assigning a new task.',
      },
      isVisualSeed: true,
    });
    commit(next);
    return id;
  },

  assignTask(taskId: string, agentIds: string[]): void {
    const task = state.tasks[taskId];
    if (!task) return;
    const updated: Task = {
      ...task,
      assignedAgentIds: agentIds,
      status: 'assigned',
    };
    // Set agents' target to the task's room
    const updatedAgents: Record<string, Agent> = { ...state.agents };
    for (const aid of agentIds) {
      const a = updatedAgents[aid];
      if (!a || a.status === 'onboarding') continue;
      const target = OFFICE_ROOMS[task.room].entryPoint;
      updatedAgents[aid] = {
        ...a,
        targetRoom: task.room,
        targetPosition: target,
        movementState: a.currentRoom === task.room ? 'arrived' : 'moving',
        status: a.currentRoom === task.room ? 'working' : 'moving',
        currentTaskId: taskId,
        currentTask: a.role && typeof a.role !== 'string' ? task.title.en : task.title.en,
      };
    }
    let next: GenesisStateShape = {
      ...state,
      tasks: { ...state.tasks, [taskId]: updated },
      agents: updatedAgents,
    };
    next = appendEvent(next, {
      kind: 'task.assigned',
      severity: 'info',
      taskId,
      message: {
        es: `Tarea «${task.title.es}» asignada.`,
        en: `Task “${task.title.en}” assigned.`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  startTask(taskId: string): void {
    const task = state.tasks[taskId];
    if (!task) return;
    const startedAt = new Date().toISOString();
    const updated: Task = { ...task, status: 'working', startedAt };
    let next: GenesisStateShape = { ...state, tasks: { ...state.tasks, [taskId]: updated } };
    // mark assigned agents as working
    const updatedAgents = { ...next.agents };
    for (const aid of task.assignedAgentIds) {
      const a = updatedAgents[aid];
      if (!a) continue;
      updatedAgents[aid] = { ...a, status: 'working', currentTaskId: taskId };
    }
    next = { ...next, agents: updatedAgents };
    if (task.startBubble) {
      const speaker = task.assignedAgentIds[0];
      next = appendEvent(next, {
        kind: 'task.started',
        severity: 'info',
        taskId,
        agentId: speaker,
        voicedBy: speaker,
        voicedText: task.startBubble,
        message: {
          es: `Empezó: ${task.title.es}.`,
          en: `Started: ${task.title.en}.`,
        },
        isVisualSeed: true,
      });
    } else {
      next = appendEvent(next, {
        kind: 'task.started',
        severity: 'info',
        taskId,
        message: {
          es: `Empezó: ${task.title.es}.`,
          en: `Started: ${task.title.en}.`,
        },
        isVisualSeed: true,
      });
    }
    commit(next);
  },

  completeTask(taskId: string, output?: Task['output']): void {
    const task = state.tasks[taskId];
    if (!task) return;
    const updated: Task = {
      ...task,
      status: 'completed',
      completedAt: new Date().toISOString(),
      output,
    };
    let next: GenesisStateShape = { ...state, tasks: { ...state.tasks, [taskId]: updated } };
    const updatedAgents = { ...next.agents };
    for (const aid of task.assignedAgentIds) {
      const a = updatedAgents[aid];
      if (!a) continue;
      updatedAgents[aid] = {
        ...a,
        status: 'idle',
        currentTaskId: null,
        currentTask: null,
        learningScore: Math.min(1, a.learningScore + 0.01),
      };
    }
    next = { ...next, agents: updatedAgents };
    next = appendEvent(next, {
      kind: 'task.completed',
      severity: 'info',
      taskId,
      message: {
        es: `Completado: ${task.title.es}.`,
        en: `Completed: ${task.title.en}.`,
      },
      voicedBy: task.assignedAgentIds[0],
      voicedText: {
        es: 'Tarea terminada.',
        en: 'Task complete.',
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  blockTask(taskId: string, reason: { es: string; en: string }): void {
    const task = state.tasks[taskId];
    if (!task) return;
    const updated: Task = { ...task, status: 'blocked', blockedReason: reason };
    let next: GenesisStateShape = { ...state, tasks: { ...state.tasks, [taskId]: updated } };
    next = appendEvent(next, {
      kind: 'task.blocked',
      severity: 'warn',
      taskId,
      voicedBy: 'visual-risk-guardian',
      voicedText: reason,
      message: {
        es: `Bloqueada: ${task.title.es}. ${reason.es}`,
        en: `Blocked: ${task.title.en}. ${reason.en}`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  requestOfficeUpgrade(input: Omit<OfficeUpgrade, 'id' | 'status'>): string {
    const id = `upg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const upgrade: OfficeUpgrade = { ...input, id, status: 'requested' };
    let next: GenesisStateShape = {
      ...state,
      officeUpgrades: { ...state.officeUpgrades, [id]: upgrade },
    };
    next = appendEvent(next, {
      kind: 'office.upgrade.requested',
      severity: 'info',
      upgradeId: id,
      message: {
        es: `Solicitada mejora: ${input.title.es}.`,
        en: `Upgrade requested: ${input.title.en}.`,
      },
      voicedBy: 'visual-genesis-core',
      voicedText: {
        es: `Necesitamos mejorar ${OFFICE_ROOMS[input.room].label.es}.`,
        en: `We need to upgrade ${OFFICE_ROOMS[input.room].label.en}.`,
      },
      isVisualSeed: true,
    });
    commit(next);
    return id;
  },

  completeOfficeUpgrade(id: string): void {
    const u = state.officeUpgrades[id];
    if (!u) return;
    const next1: OfficeUpgrade = { ...u, status: 'completed', completedAt: new Date().toISOString() };
    let next: GenesisStateShape = {
      ...state,
      officeUpgrades: { ...state.officeUpgrades, [id]: next1 },
    };
    next = appendEvent(next, {
      kind: 'office.upgrade.completed',
      severity: 'info',
      upgradeId: id,
      voicedBy: 'visual-memory-curator',
      voicedText: { es: 'Mejora registrada.', en: 'Upgrade recorded.' },
      message: {
        es: `Mejora completada: ${u.title.es}.`,
        en: `Upgrade completed: ${u.title.en}.`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  unlockModule(moduleId: ModuleId, nextState: ModuleState = 'ready'): void {
    const m = state.modules[moduleId];
    if (!m) return;
    const updated: ModuleEntity = {
      ...m,
      state: nextState,
      unlockedAt: new Date().toISOString(),
      isLocked: nextState !== 'ready' && nextState !== 'visual-only',
      isImplemented: nextState === 'ready' || nextState === 'visual-only',
    };
    let next: GenesisStateShape = {
      ...state,
      modules: { ...state.modules, [moduleId]: updated },
    };
    next = appendEvent(next, {
      kind: 'module.unlocked',
      severity: 'info',
      moduleId,
      message: {
        es: `Módulo desbloqueado: ${moduleId}.`,
        en: `Module unlocked: ${moduleId}.`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  // ---------- tick: time-driven transitions ----------
  tick(): void {
    const now = Date.now();
    let next: GenesisStateShape = state;
    let dirty = false;

    // 1) Auto-complete onboarding when the timer elapses
    for (const a of Object.values(next.agents)) {
      if (a.status !== 'onboarding') continue;
      if (!a.onboardingEndsAt) continue;
      if (Date.parse(a.onboardingEndsAt) <= now) {
        next = {
          ...next,
          agents: {
            ...next.agents,
            [a.id]: { ...a, status: 'idle', onboardingEndsAt: undefined },
          },
        };
        next = appendEvent(next, {
          kind: 'agent.onboarding.end',
          severity: 'info',
          agentId: a.id,
          message: {
            es: `${a.name} terminó onboarding.`,
            en: `${a.name} completed onboarding.`,
          },
          voicedBy: a.id,
          voicedText: {
            es: 'Listo para empezar a trabajar.',
            en: 'Ready to start working.',
          },
          isVisualSeed: true,
        });
        dirty = true;
      }
    }

    // 2) Advance movement (simple lerp toward target)
    for (const a of Object.values(next.agents)) {
      if (a.movementState !== 'moving' || !a.targetPosition) continue;
      const dx = a.targetPosition.x - a.position.x;
      const dy = a.targetPosition.y - a.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) {
        next = {
          ...next,
          agents: {
            ...next.agents,
            [a.id]: {
              ...a,
              position: { ...a.position, x: a.targetPosition.x, y: a.targetPosition.y },
              movementState: 'arrived',
              currentRoom: a.targetRoom ?? a.currentRoom,
              status: a.currentTaskId ? 'working' : 'idle',
            },
          },
        };
        dirty = true;
      } else {
        const step = 40; // world units per tick (~5s tick)
        const k = Math.min(1, step / dist);
        const nx = a.position.x + dx * k;
        const ny = a.position.y + dy * k;
        next = {
          ...next,
          agents: {
            ...next.agents,
            [a.id]: { ...a, position: { ...a.position, x: nx, y: ny } },
          },
        };
        dirty = true;
      }
    }

    // 3) Auto-start assigned tasks where assignee has arrived
    for (const t of Object.values(next.tasks)) {
      if (t.status !== 'assigned') continue;
      const allHere = t.assignedAgentIds.every((aid) => {
        const a = next.agents[aid];
        return a && a.currentRoom === t.room && a.movementState !== 'moving';
      });
      if (!allHere) continue;
      const updated: Task = { ...t, status: 'working', startedAt: new Date().toISOString() };
      next = { ...next, tasks: { ...next.tasks, [t.id]: updated } };
      const updatedAgents = { ...next.agents };
      for (const aid of t.assignedAgentIds) {
        const a = updatedAgents[aid];
        if (!a) continue;
        updatedAgents[aid] = { ...a, status: 'working', currentTaskId: t.id, currentTask: t.title.en };
      }
      next = { ...next, agents: updatedAgents };
      const speaker = t.assignedAgentIds[0];
      if (t.startBubble) {
        next = appendEvent(next, {
          kind: 'task.started',
          severity: 'info',
          taskId: t.id,
          agentId: speaker,
          voicedBy: speaker,
          voicedText: t.startBubble,
          message: {
            es: `Empezó: ${t.title.es}.`,
            en: `Started: ${t.title.en}.`,
          },
          isVisualSeed: true,
        });
      }
      dirty = true;
    }

    // 4) Auto-complete working tasks past their estimatedMs
    for (const t of Object.values(next.tasks)) {
      if (t.status !== 'working' || !t.startedAt) continue;
      const startedMs = Date.parse(t.startedAt);
      if (now - startedMs < t.estimatedMs) continue;
      const updated: Task = { ...t, status: 'completed', completedAt: new Date().toISOString() };
      next = { ...next, tasks: { ...next.tasks, [t.id]: updated } };
      const updatedAgents = { ...next.agents };
      for (const aid of t.assignedAgentIds) {
        const a = updatedAgents[aid];
        if (!a) continue;
        updatedAgents[aid] = {
          ...a,
          status: 'idle',
          currentTaskId: null,
          currentTask: null,
          learningScore: Math.min(1, a.learningScore + 0.01),
        };
      }
      next = { ...next, agents: updatedAgents };
      next = appendEvent(next, {
        kind: 'task.completed',
        severity: 'info',
        taskId: t.id,
        agentId: t.assignedAgentIds[0],
        voicedBy: t.assignedAgentIds[0],
        voicedText: { es: 'Tarea terminada.', en: 'Task complete.' },
        message: {
          es: `Completado: ${t.title.es}.`,
          en: `Completed: ${t.title.en}.`,
        },
        isVisualSeed: true,
      });
      dirty = true;
    }

    if (dirty) commit(next);
  },
};

// ---------- helpers ----------

function roomForDepartment(dept: Agent['department']): RoomId {
  switch (dept) {
    case 'Market Room':    return 'market-desk';
    case 'Strategy Lab':   return 'strategy-lab';
    case 'Risk Office':    return 'risk-bunker';
    case 'Memory Archive': return 'memory-archive';
    case 'Debate Room':    return 'debate-room';
    case 'Board Room':     return 'board-room';
    case 'Genesis HR':     return 'hr-pod';
    case 'Execution Desk': return 'execution-desk';
    default:                return 'open-workspace';
  }
}

// ---------- selectors (React hooks) ----------

export function useAgents(): Agent[] {
  const s = useGenesisState();
  return Object.values(s.agents);
}

export function useHiringQueue(): HiringCandidate[] {
  const s = useGenesisState();
  return Object.values(s.hiringQueue);
}

export function useFiredAgents(): Agent[] {
  const s = useGenesisState();
  return Object.values(s.firedAgents);
}

export function useTasks(): Task[] {
  const s = useGenesisState();
  return Object.values(s.tasks);
}

export function useEvents(): SystemEvent[] {
  const s = useGenesisState();
  return s.events;
}

export function useModules(): ModuleEntity[] {
  const s = useGenesisState();
  return Object.values(s.modules);
}

export function useModuleById(id: ModuleId): ModuleEntity | undefined {
  const s = useGenesisState();
  return s.modules[id];
}

export function useOfficeUpgrades(): OfficeUpgrade[] {
  const s = useGenesisState();
  return Object.values(s.officeUpgrades);
}

export function useDevMode(): boolean {
  const s = useGenesisState();
  return s.meta.devMode;
}

export function useGenesisMeta() {
  const s = useGenesisState();
  return s.meta;
}

// Convenience: tasks per room
export function useTasksForRoom(room: RoomId): Task[] {
  return useTasks().filter((t) => t.room === room);
}

// Tasks for one agent
export function useTasksForAgent(agentId: string): Task[] {
  return useTasks().filter((t) => t.assignedAgentIds.includes(agentId));
}

// Re-export TaskType for convenience
export type { TaskType };
