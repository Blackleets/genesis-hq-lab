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
import type { Lang } from '../i18n/translations';
import type { Agent } from '../types/genesis';
import type { Task, TaskStatus, TaskType } from '../types/task';
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
  selectedLanguage: Lang;
  selectedModule: ModuleId;
  selectedAgent: string | null;
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
    selectedLanguage: 'es',
    selectedModule: 'hq',
    selectedAgent: null,
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

function hydrateState(saved: Partial<GenesisStateShape>): GenesisStateShape {
  const base = buildInitialState();
  const hydratedAgents = saved.agents ?? base.agents;
  const hydratedModules = saved.modules ?? base.modules;
  const selectedModule =
    saved.selectedModule && hydratedModules[saved.selectedModule]
      ? saved.selectedModule
      : base.selectedModule;
  const selectedAgent =
    saved.selectedAgent && hydratedAgents[saved.selectedAgent]
      ? saved.selectedAgent
      : base.selectedAgent;

  return {
    ...base,
    ...saved,
    meta: saved.meta ? { ...base.meta, ...saved.meta } : base.meta,
    agents: hydratedAgents,
    hiringQueue: saved.hiringQueue ?? base.hiringQueue,
    firedAgents: saved.firedAgents ?? base.firedAgents,
    tasks: saved.tasks ?? base.tasks,
    events: saved.events ?? base.events,
    selectedLanguage: saved.selectedLanguage ?? base.selectedLanguage,
    selectedModule,
    selectedAgent,
    modules: hydratedModules,
    officeUpgrades: saved.officeUpgrades ?? base.officeUpgrades,
  };
}

// ---------- store ----------

let state: GenesisStateShape = (() => {
  const loaded = load<GenesisStateShape>();
  if (loaded && loaded.meta && loaded.agents) return hydrateState(loaded);
  return buildInitialState();
})();

save(state);

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

type TaskCreateInput = {
  title: Task['title'];
  description: Task['description'];
  type: Task['type'];
  room: Task['room'];
  priority: Task['priority'];
  sourceModule: Task['sourceModule'];
  assignedAgentIds?: Task['assignedAgentIds'];
  evidence?: Task['evidence'];
  output?: Task['output'];
  estimatedMs?: Task['estimatedMs'];
  isSeed?: Task['isSeed'];
  isVisualSeed?: Task['isVisualSeed'];
  isReal?: Task['isReal'];
  startBubble?: Task['startBubble'];
};

function syncAgentsFromTasks(agents: Record<string, Agent>, tasks: Record<string, Task>): Record<string, Agent> {
  const nextAgents: Record<string, Agent> = { ...agents };

  for (const agent of Object.values(nextAgents)) {
    if (agent.status === 'onboarding' || agent.status === 'fired' || agent.status === 'suspended') continue;
    const relevantTasks = Object.values(tasks).filter(
      (task) =>
        task.assignedAgentIds.includes(agent.id) &&
        (task.status === 'assigned' || task.status === 'moving' || task.status === 'working' || task.status === 'blocked')
    );

    if (relevantTasks.length === 0) {
      nextAgents[agent.id] = {
        ...agent,
        status: 'idle',
        currentTaskId: null,
        currentTask: null,
        movementState: 'still',
      };
      continue;
    }

    const priorityTask =
      relevantTasks.find((task) => task.status === 'blocked') ??
      relevantTasks.find((task) => task.status === 'moving') ??
      relevantTasks.find((task) => task.status === 'working') ??
      relevantTasks[0];

    const derivedStatus =
      priorityTask.status === 'blocked'
        ? 'warning'
        : priorityTask.status === 'moving'
          ? 'moving'
          : priorityTask.status === 'working'
            ? 'working'
            : 'idle';

    nextAgents[agent.id] = {
      ...agent,
      status: derivedStatus,
      currentTaskId: priorityTask.id,
      currentTask: priorityTask.title.en,
      movementState: priorityTask.status === 'moving' ? 'moving' : agent.movementState === 'moving' ? 'arrived' : agent.movementState,
    };
  }

  return nextAgents;
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

  setSelectedLanguage(selectedLanguage: Lang): void {
    if (selectedLanguage === state.selectedLanguage) return;
    commit({ ...state, selectedLanguage });
  },

  setSelectedModule(selectedModule: ModuleId): void {
    if (selectedModule === state.selectedModule) return;
    commit({ ...state, selectedModule });
  },

  setSelectedAgent(selectedAgent: string | null): void {
    const nextSelectedAgent = selectedAgent && state.agents[selectedAgent] ? selectedAgent : null;
    if (nextSelectedAgent === state.selectedAgent) return;
    commit({ ...state, selectedAgent: nextSelectedAgent });
  },

  hireAgent(candidateId: string): void {
    const candidate = state.hiringQueue[candidateId];
    if (!candidate) return;
    const onboardingRoom: RoomId = 'hr-pod';
    const onboardingEntry = OFFICE_ROOMS[onboardingRoom].entryPoint;
    const destinationRoom = roomForDepartment(candidate.department);
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
      position: { ...onboardingEntry, x: onboardingEntry.x - 52, y: onboardingEntry.y + 24, pose: 'standing', facing: 'south' },
      currentRoom: onboardingRoom,
      targetRoom: destinationRoom,
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
        es: 'Bienvenido a GÃ©nesis. Tu onboarding ha comenzado.',
        en: 'Welcome to Genesis. Your onboarding has started.',
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
    next = appendEvent(next, {
      kind: 'agent.says',
      severity: 'info',
      agentId: id,
      voicedBy: id,
      voicedText: {
        es: 'EstarÃ© activo despuÃ©s de mi inducciÃ³n.',
        en: 'I will be active after onboarding.',
      },
      message: {
        es: `${candidate.name.es} confirmÃ³ que estarÃ¡ activo tras onboarding.`,
        en: `${candidate.name.en} confirmed it will be active after onboarding.`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  completeOnboarding(agentId: string): void {
    const a = state.agents[agentId];
    if (!a || a.status !== 'onboarding') return;
    const destinationRoom = a.targetRoom ?? roomForDepartment(a.department);
    const destination = OFFICE_ROOMS[destinationRoom].entryPoint;
    const updated: Agent = {
      ...a,
      status: 'idle',
      currentRoom: destinationRoom,
      position: { ...destination, pose: 'standing', facing: 'south' },
      movementState: 'still',
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
      selectedAgent: state.selectedAgent === agentId ? null : state.selectedAgent,
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

  promoteAgent(agentId: string): void {
    const a = state.agents[agentId];
    if (!a || a.status === 'fired') return;
    const ladder: Agent['rank'][] = ['intern', 'junior', 'operator', 'senior', 'lead', 'executive'];
    const idx = ladder.indexOf(a.rank);
    if (idx < 0 || idx >= ladder.length - 1) return;
    const nextRank = ladder[idx + 1];
    let next: GenesisStateShape = {
      ...state,
      agents: { ...state.agents, [agentId]: { ...a, rank: nextRank, status: 'idle' } },
    };
    next = appendEvent(next, {
      kind: 'agent.promoted',
      severity: 'info',
      agentId,
      voicedBy: agentId,
      voicedText: { es: 'Promovido.', en: 'Promoted.' },
      message: {
        es: `${a.name} ascendió a ${nextRank}.`,
        en: `${a.name} promoted to ${nextRank}.`,
      },
      isVisualSeed: false,
    });
    commit(next);
  },

  retrainAgent(agentId: string): void {
    const a = state.agents[agentId];
    if (!a || a.status === 'retraining' || a.status === 'fired') return;
    const taskId = `task-retrain-${agentId}-${Date.now()}`;
    const task: Task = {
      id: taskId,
      title: { es: `Reentrenamiento: ${a.name}`, en: `Retraining: ${a.name}` },
      description: {
        es: `Sesión de reentrenamiento para ${a.name}.`,
        en: `Retraining session for ${a.name}.`,
      },
      type: 'agent_training',
      assignedAgentIds: [agentId],
      room: 'hr-pod',
      status: 'queued',
      priority: 'normal',
      createdAt: new Date().toISOString(),
      sourceModule: 'hr',
      estimatedMs: 1000 * 60 * 10,
      isSeed: false,
      isReal: true,
      isVisualSeed: false,
    };
    let next: GenesisStateShape = {
      ...state,
      agents: { ...state.agents, [agentId]: { ...a, status: 'retraining' } },
      tasks: { ...state.tasks, [taskId]: task },
    };
    next = appendEvent(next, {
      kind: 'agent.retraining',
      severity: 'info',
      agentId,
      voicedBy: agentId,
      voicedText: { es: 'Iniciando reentrenamiento.', en: 'Starting retraining.' },
      message: {
        es: `${a.name} entró en reentrenamiento.`,
        en: `${a.name} entered retraining.`,
      },
      isVisualSeed: false,
    });
    commit(next);
  },

  suspendAgent(agentId: string): void {
    const a = state.agents[agentId];
    if (!a || a.status === 'suspended' || a.status === 'fired') return;
    let next: GenesisStateShape = {
      ...state,
      agents: { ...state.agents, [agentId]: { ...a, status: 'suspended' } },
    };
    next = appendEvent(next, {
      kind: 'agent.suspended',
      severity: 'warn',
      agentId,
      message: {
        es: `${a.name} suspendido.`,
        en: `${a.name} suspended.`,
      },
      isVisualSeed: false,
    });
    commit(next);
  },

  createTask(input: TaskCreateInput): string {
    const id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: Task = {
      id,
      title: input.title,
      description: input.description,
      type: input.type,
      assignedAgentIds: input.assignedAgentIds ?? [],
      room: input.room,
      status: 'queued',
      priority: input.priority,
      createdAt: new Date().toISOString(),
      sourceModule: input.sourceModule,
      estimatedMs: input.estimatedMs ?? 1000 * 60 * 5,
      evidence: input.evidence,
      output: input.output,
      isSeed: input.isSeed ?? false,
      isReal: input.isReal ?? false,
      isVisualSeed: input.isVisualSeed ?? true,
      startBubble: input.startBubble,
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
    const eligibleAgentIds = agentIds.filter((agentId) => {
      const agent = state.agents[agentId];
      if (!agent) return false;
      if (agent.status === 'onboarding' && task.priority === 'critical') return false;
      return true;
    });
    const updated: Task = {
      ...task,
      assignedAgentIds: eligibleAgentIds,
      status: 'assigned',
    };
    // Set agents' target to the task's room
    const updatedAgents: Record<string, Agent> = { ...state.agents };
    let hasMovement = false;
    for (const aid of eligibleAgentIds) {
      const a = updatedAgents[aid];
      if (!a) continue;
      const target = OFFICE_ROOMS[task.room].entryPoint;
      const movementState = a.currentRoom === task.room ? 'arrived' : 'moving';
      hasMovement = hasMovement || movementState === 'moving';
      updatedAgents[aid] = {
        ...a,
        targetRoom: task.room,
        targetPosition: target,
        movementState,
        currentTaskId: taskId,
        currentTask: task.title.en,
      };
    }
    const nextTask: Task = { ...updated, status: (hasMovement ? 'moving' : 'assigned') as TaskStatus };
    let next: GenesisStateShape = {
      ...state,
      tasks: { ...state.tasks, [taskId]: nextTask },
      agents: syncAgentsFromTasks(updatedAgents, { ...state.tasks, [taskId]: nextTask }),
    };
    next = appendEvent(next, {
      kind: 'task.assigned',
      severity: 'info',
      taskId,
      agentId: eligibleAgentIds[0],
      voicedBy: eligibleAgentIds[0],
      voicedText: {
        es: 'Voy al area asignada.',
        en: 'Moving to assigned area.',
      },
      message: {
        es: `Tarea «${task.title.es}» asignada.`,
        en: `Task “${task.title.en}” assigned.`,
      },
      isVisualSeed: true,
    });
    if (hasMovement && eligibleAgentIds[0]) {
      next = appendEvent(next, {
        kind: 'task.moving',
        severity: 'info',
        taskId,
        agentId: eligibleAgentIds[0],
        voicedBy: eligibleAgentIds[0],
        voicedText: {
          es: 'Voy al area asignada.',
          en: 'Moving to assigned area.',
        },
        message: {
          es: `${state.agents[eligibleAgentIds[0]]?.name ?? 'Agente'} se dirige a ${OFFICE_ROOMS[task.room].label.es}.`,
          en: `${state.agents[eligibleAgentIds[0]]?.name ?? 'Agent'} is moving to ${OFFICE_ROOMS[task.room].label.en}.`,
        },
        isVisualSeed: true,
      });
    }
    commit(next);
  },

  startTask(taskId: string): void {
    const task = state.tasks[taskId];
    if (!task) return;
    const startedAt = new Date().toISOString();
    const updated: Task = { ...task, status: 'working', startedAt, isReal: true };
    let next: GenesisStateShape = { ...state, tasks: { ...state.tasks, [taskId]: updated } };
    next = { ...next, agents: syncAgentsFromTasks(next.agents, next.tasks) };
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
        agentId: task.assignedAgentIds[0],
        voicedBy: task.assignedAgentIds[0],
        voicedText: {
          es: 'Tarea iniciada.',
          en: 'Task started.',
        },
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
        learningScore: Math.min(1, a.learningScore + 0.01),
      };
    }
    next = { ...next, agents: syncAgentsFromTasks(updatedAgents, next.tasks) };
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
    if (task.type !== 'memory_archive' && next.agents['visual-memory-curator']) {
      const memoryTaskId = `task-memory-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      const memoryTask: Task = {
        id: memoryTaskId,
        title: {
          es: `Archivar aprendizaje: ${task.title.es}`,
          en: `Archive learning: ${task.title.en}`,
        },
        description: {
          es: `Registrar el aprendizaje generado por ${task.title.es}.`,
          en: `Record the learning generated by ${task.title.en}.`,
        },
        type: 'memory_archive',
        assignedAgentIds: ['visual-memory-curator'],
        room: 'memory-archive',
        status: 'queued',
        priority: 'normal',
        createdAt: new Date().toISOString(),
        sourceModule: 'progress',
        estimatedMs: 1000 * 60 * 4,
        evidence: task.output ? [task.output.en] : ['Local task completion'],
        output: undefined,
        isSeed: false,
        isReal: false,
        isVisualSeed: true,
        startBubble: {
          es: 'ArchivarÃ© este aprendizaje.',
          en: 'I will archive this learning.',
        },
      };
      next = {
        ...next,
        tasks: { ...next.tasks, [memoryTaskId]: memoryTask },
      };
    }
    commit(next);
  },

  failTask(taskId: string, reason: { es: string; en: string }): void {
    const task = state.tasks[taskId];
    if (!task) return;
    const updated: Task = {
      ...task,
      status: 'failed',
      blockedReason: reason,
      completedAt: new Date().toISOString(),
    };
    const updatedTasks = { ...state.tasks, [taskId]: updated };
    const updatedAgents = { ...state.agents };
    for (const agentId of task.assignedAgentIds) {
      const agent = updatedAgents[agentId];
      if (!agent) continue;
      updatedAgents[agentId] = {
        ...agent,
        mistakeCount: (agent.mistakeCount ?? 0) + 1,
      };
    }
    let next: GenesisStateShape = {
      ...state,
      tasks: updatedTasks,
      agents: syncAgentsFromTasks(updatedAgents, updatedTasks),
    };
    next = appendEvent(next, {
      kind: 'task.failed',
      severity: 'warn',
      taskId,
      agentId: task.assignedAgentIds[0],
      voicedBy: task.assignedAgentIds[0],
      voicedText: reason,
      message: {
        es: `FallÃ³: ${task.title.es}. ${reason.es}`,
        en: `Failed: ${task.title.en}. ${reason.en}`,
      },
      isVisualSeed: true,
    });
    commit(next);
  },

  archiveTask(taskId: string): void {
    const task = state.tasks[taskId];
    if (!task) return;
    const updated: Task = { ...task, status: 'archived' };
    const updatedTasks = { ...state.tasks, [taskId]: updated };
    commit({
      ...state,
      tasks: updatedTasks,
      agents: syncAgentsFromTasks(state.agents, updatedTasks),
    });
  },

  blockTask(taskId: string, reason: { es: string; en: string }): void {
    const task = state.tasks[taskId];
    if (!task) return;
    const updated: Task = { ...task, status: 'blocked', blockedReason: reason };
    let next: GenesisStateShape = {
      ...state,
      tasks: { ...state.tasks, [taskId]: updated },
      agents: syncAgentsFromTasks(state.agents, { ...state.tasks, [taskId]: updated }),
    };
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
    next = appendEvent(next, {
      kind: 'agent.warning',
      severity: 'warn',
      agentId: 'visual-risk-guardian',
      voicedBy: 'visual-risk-guardian',
      voicedText: reason,
      message: {
        es: `Risk Guardian marcÃ³ una alerta en ${task.title.es}.`,
        en: `Risk Guardian marked a warning on ${task.title.en}.`,
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
        const destinationRoom = a.targetRoom ?? roomForDepartment(a.department);
        const destination = OFFICE_ROOMS[destinationRoom].entryPoint;
        next = {
          ...next,
          agents: {
            ...next.agents,
            [a.id]: {
              ...a,
              status: 'idle',
              currentRoom: destinationRoom,
              position: { ...destination, pose: 'standing', facing: 'south' },
              movementState: 'still',
              onboardingEndsAt: undefined,
            },
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
      if (t.status !== 'assigned' && t.status !== 'moving') continue;
      const allHere = t.assignedAgentIds.every((aid) => {
        const a = next.agents[aid];
        return a && a.currentRoom === t.room && a.movementState !== 'moving';
      });
      if (!allHere) continue;
      const updated: Task = { ...t, status: 'working', startedAt: new Date().toISOString(), isReal: true };
      next = { ...next, tasks: { ...next.tasks, [t.id]: updated } };
      next = { ...next, agents: syncAgentsFromTasks(next.agents, next.tasks) };
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
          learningScore: Math.min(1, a.learningScore + 0.01),
        };
      }
      next = { ...next, agents: syncAgentsFromTasks(updatedAgents, next.tasks) };
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

    // 5) Evaluate hiring queue unlock conditions
    const queueBefore = JSON.stringify(next.hiringQueue);
    next = evaluateHiringQueue(next);
    if (JSON.stringify(next.hiringQueue) !== queueBefore) dirty = true;

    if (dirty) commit({ ...next, agents: syncAgentsFromTasks(next.agents, next.tasks) });
  },
};

// ---------- helpers ----------

function evaluateHiringQueue(s: GenesisStateShape): GenesisStateShape {
  const allTasks = Object.values(s.tasks);
  const allAgents = Object.values(s.agents);
  let changed = false;
  const nextQueue = { ...s.hiringQueue };

  for (const [id, candidate] of Object.entries(nextQueue)) {
    if (candidate.state !== 'pending') continue;
    let unlocked = false;

    switch (candidate.unlockCondition) {
      case 'decisions-5-recorded':
        unlocked = allTasks.filter((t) => t.type === 'decision_review' && t.status === 'completed').length >= 5;
        break;
      case 'learning-level-up': {
        const scores = allAgents.map((a) => a.learningScore);
        unlocked = scores.length > 0 && scores.reduce((a, b) => a + b, 0) / scores.length > 0.7;
        break;
      }
      case 'module-unlocked-decisions':
        unlocked = s.modules['decisions']?.state !== 'locked-backend';
        break;
      case 'module-unlocked-markets':
        unlocked = s.modules['markets']?.state === 'ready';
        break;
      case 'tasks-pending-many':
        unlocked = allTasks.filter((t) => t.status === 'queued' || t.status === 'assigned').length > 3;
        break;
      case 'errors-keep-happening':
        unlocked = allAgents.some((a) => (a.mistakeCount ?? 0) > 2);
        break;
      case 'office-needs-upgrade':
        unlocked = Object.values(s.officeUpgrades).some((u) => u.status === 'requested');
        break;
      default:
        break;
    }

    if (unlocked) {
      nextQueue[id] = { ...candidate, state: 'unlockable', unlockedAt: new Date().toISOString() };
      changed = true;
    }
  }

  if (!changed) return s;
  return { ...s, hiringQueue: nextQueue };
}

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

export function getOnboardingAgents(): Agent[] {
  return Object.values(state.agents).filter((agent) => agent.status === 'onboarding');
}

export function useOnboardingAgents(): Agent[] {
  const s = useGenesisState();
  return Object.values(s.agents).filter((agent) => agent.status === 'onboarding');
}

export function getActiveAgents(): Agent[] {
  return Object.values(state.agents).filter((agent) => agent.status !== 'onboarding');
}

export function useActiveAgents(): Agent[] {
  const s = useGenesisState();
  return Object.values(s.agents).filter((agent) => agent.status !== 'onboarding');
}

export function getHiringQueue(): HiringCandidate[] {
  return Object.values(state.hiringQueue);
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

export function getActiveTasks(): Task[] {
  return Object.values(state.tasks).filter((task) =>
    task.status === 'assigned' || task.status === 'moving' || task.status === 'working' || task.status === 'blocked'
  );
}

export function getQueuedTasks(): Task[] {
  return Object.values(state.tasks).filter((task) => task.status === 'queued');
}

export function getCompletedTasks(): Task[] {
  return Object.values(state.tasks).filter((task) => task.status === 'completed');
}

export function useEvents(): SystemEvent[] {
  const s = useGenesisState();
  return s.events;
}

export function useSelectedLanguage(): Lang {
  const s = useGenesisState();
  return s.selectedLanguage;
}

export function useSelectedModule(): ModuleId {
  const s = useGenesisState();
  return s.selectedModule;
}

export function useSelectedAgent(): Agent | null {
  const s = useGenesisState();
  return s.selectedAgent ? s.agents[s.selectedAgent] ?? null : null;
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

export function getTasksByRoom(room: RoomId): Task[] {
  return Object.values(state.tasks).filter((task) => task.room === room);
}

// Tasks for one agent
export function useTasksForAgent(agentId: string): Task[] {
  return useTasks().filter((t) => t.assignedAgentIds.includes(agentId));
}

export function getTasksByAgent(agentId: string): Task[] {
  return Object.values(state.tasks).filter((task) => task.assignedAgentIds.includes(agentId));
}

// Re-export TaskType for convenience
export type { TaskType };
