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
import { load, save } from '@core/store/persistence';
import { INITIAL_AGENTS } from '@agents/data/initialAgents';
import { INITIAL_TASKS } from '@core/data/initialTasks';
import { FUTURE_AGENTS } from '@agents/data/futureAgents';
import { MODULES } from '@core/data/moduleRegistry';
import { OFFICE_ROOMS } from '@animations/officeRooms';
import type { Lang } from '@core/i18n/translations';
import type { Agent } from '@core/types/genesis';
import type { Task, TaskStatus, TaskType } from '@core/types/task';
import type { SystemEvent } from '@core/types/event';
import type { HiringCandidate } from '@core/types/hiring';
import type { OfficeUpgrade, RoomId } from '@core/types/office';
import type { ModuleEntity, ModuleId, ModuleState } from '@core/types/module';
import type { PaperPosition } from '@core/types/trading';

// ---------- shape ----------

export interface DecisionRecord {
  id: string;
  title: string;
  context: string;
  optionA: string;
  optionB: string;
  status: 'pending' | 'resolved';
  outcome?: string;
  createdAt: string;
  resolvedAt?: string;
  taskId?: string;
}

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
  decisions: Record<string, DecisionRecord>;
  capital: number;
  positions: Record<string, PaperPosition>;
  closedPositions: PaperPosition[];
  capitalHistory: { at: string; value: number }[];
  walletAddress: string | null;
  walletConnected: boolean;
  commandHistory: CommandHistoryEntry[];
  connectors: ConnectorConfig[];
}

export interface CommandHistoryEntry {
  id: string;
  at: string;
  command: string;
  taskIds: string[];
  status: 'running' | 'done' | 'partial';
}

export type PlatformId =
  | 'slack' | 'github' | 'notion' | 'sheets'
  | 'facebook' | 'instagram' | 'linkedin' | 'twitter'
  | 'google_ads' | 'tiktok' | 'make' | 'webhook';

export interface ConnectorConfig {
  id: string;
  name: string;
  platform: PlatformId;
  config: {
    webhookUrl?: string;
    apiKey?: string;
    token?: string;
    url?: string;
    channelId?: string;
    repoOwner?: string;
    repoName?: string;
    databaseId?: string;
    [key: string]: string | undefined;
  };
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  capabilities: string[];
  lastUsed?: string;
  lastError?: string;
  syncCount?: number;
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
    decisions: {},
    capital: 10_000,
    positions: {},
    closedPositions: [],
    capitalHistory: [{ at: now, value: 10_000 }],
    walletAddress: null,
    walletConnected: false,
    commandHistory: [],
    connectors: [],
  };
}

function mergeAgentCapabilities(saved: Record<string, Agent>): Record<string, Agent> {
  const result = { ...saved };
  for (const template of INITIAL_AGENTS) {
    const existing = result[template.id];
    if (!existing) continue;
    const missing = template.capabilities.filter((c) => !existing.capabilities.includes(c));
    if (missing.length === 0) continue;
    result[template.id] = { ...existing, capabilities: [...existing.capabilities, ...missing] };
  }
  return result;
}

function hydrateState(saved: Partial<GenesisStateShape>): GenesisStateShape {
  const base = buildInitialState();
  const rawAgents = saved.agents ?? base.agents;
  const hydratedAgents = mergeAgentCapabilities(rawAgents);
  const hydratedModules = saved.modules ?? base.modules;
  const selectedModule =
    saved.selectedModule && hydratedModules[saved.selectedModule]
      ? saved.selectedModule
      : base.selectedModule;
  // FORCE landing on the pixel office (HQ) for noisy/legacy modules so users
  // see the live, on-vision trading office instead of broken/empty modules.
  const FORCE_HQ = ['pred-markets', 'crypto', 'terminal', 'dashboard', 'console'];
  const finalModule = FORCE_HQ.includes(selectedModule) ? 'hq' : selectedModule;
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
    selectedModule: finalModule,
    selectedAgent,
    modules: hydratedModules,
    officeUpgrades: saved.officeUpgrades ?? base.officeUpgrades,
    decisions: saved.decisions ?? base.decisions,
    capital: 10_000,
    positions: saved.positions ?? base.positions,
    closedPositions: saved.closedPositions ?? base.closedPositions,
    capitalHistory: [{ at: new Date().toISOString(), value: 10_000 }],
    walletAddress: saved.walletAddress ?? base.walletAddress,
    walletConnected: saved.walletConnected ?? base.walletConnected,
    commandHistory: saved.commandHistory ?? base.commandHistory,
    connectors: saved.connectors ?? base.connectors,
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
      currentTask: priorityTask.title,
      movementState: priorityTask.status === 'moving' ? 'moving' : agent.movementState === 'moving' ? 'arrived' : agent.movementState,
    };
  }

  return nextAgents;
}

// ---------- actions ----------

const ONBOARDING_DURATION_MS = 3 * 60 * 1000; // 3 minutes — lab demo pace

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
    const endsAt = new Date(Date.now() + ONBOARDING_DURATION_MS).toISOString();
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
        es: 'Bienvenido a Génesis. Tu onboarding ha comenzado.',
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
        es: 'Estaré activo después de mi inducción.',
        en: 'I will be active after onboarding.',
      },
      message: {
        es: `${candidate.name.es} confirmó que estará activo tras onboarding.`,
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

  createAgentFromFactory(input: {
    name: string;
    role: string;
    department: Agent['department'];
    archetype: Agent['visualProfile']['archetype'];
    primaryColor: string;
    /** optional rich fields from the cinematic Agent Creator */
    accentColor?: string;
    accessory?: Agent['visualProfile']['accessory'];
    capabilities?: TaskType[];
  }): void {
    const id = `factory-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const endsAt = new Date(Date.now() + ONBOARDING_DURATION_MS).toISOString();
    const onboardingRoom: RoomId = 'hr-pod';
    const onboardingEntry = OFFICE_ROOMS[onboardingRoom].entryPoint;
    const destinationRoom = roomForDepartment(input.department);
    const newAgent: Agent = {
      id,
      name: input.name,
      role: { es: input.role, en: input.role },
      department: input.department,
      rank: 'junior',
      status: 'onboarding',
      currentTaskId: null,
      currentTask: null,
      trustScore: 0.50,
      learningScore: 0.10,
      visualProfile: {
        archetype: input.archetype,
        primary: input.primaryColor,
        accent: input.accentColor ?? '#3da9fc',
        accessory: input.accessory ?? 'none',
      },
      position: { ...onboardingEntry, x: onboardingEntry.x - 52, y: onboardingEntry.y + 24, pose: 'standing', facing: 'south' },
      currentRoom: onboardingRoom,
      targetRoom: destinationRoom,
      movementState: 'still',
      hiredAt: now,
      onboardingStartedAt: now,
      onboardingEndsAt: endsAt,
      isVisualSeed: false,
      capabilities: input.capabilities ?? [],
    };
    let next: GenesisStateShape = { ...state, agents: { ...state.agents, [id]: newAgent } };
    next = appendEvent(next, {
      kind: 'agent.hired',
      severity: 'info',
      agentId: id,
      message: {
        es: `Fábrica creó un nuevo agente: ${input.name}.`,
        en: `Factory created a new agent: ${input.name}.`,
      },
      voicedBy: 'visual-genesis-core',
      voicedText: { es: `Bienvenido, ${input.name}.`, en: `Welcome, ${input.name}.` },
      isVisualSeed: false,
    });
    commit(next);
  },

  addDecision(input: { title: string; context: string; optionA: string; optionB: string }): void {
    const id = `decision-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    const record: DecisionRecord = {
      id,
      title: input.title,
      context: input.context,
      optionA: input.optionA,
      optionB: input.optionB,
      status: 'pending',
      createdAt: now,
    };
    let next: GenesisStateShape = { ...state, decisions: { ...state.decisions, [id]: record } };
    // Create a real decision_review task in the board room
    const taskId = `task-dec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const task: Task = {
      id: taskId,
      title: { es: `Decisión: ${input.title}`, en: `Decision: ${input.title}` },
      description: { es: input.context, en: input.context },
      type: 'decision_review',
      assignedAgentIds: [],
      room: 'board-room',
      status: 'queued',
      priority: 'high',
      createdAt: now,
      sourceModule: 'decisions',
      estimatedMs: 5 * 60 * 1000,
      isSeed: false,
      isReal: true,
      isVisualSeed: false,
    };
    next = { ...next, tasks: { ...next.tasks, [taskId]: task }, decisions: { ...next.decisions, [id]: { ...record, taskId } } };
    next = appendEvent(next, {
      kind: 'task.created',
      severity: 'info',
      taskId,
      message: {
        es: `Nueva decisión registrada: ${input.title}.`,
        en: `New decision logged: ${input.title}.`,
      },
      voicedBy: 'visual-genesis-core',
      voicedText: { es: 'Decisión registrada para revisión.', en: 'Decision logged for review.' },
      isVisualSeed: false,
    });
    commit(next);
  },

  resolveDecision(id: string, outcome: string): void {
    const record = state.decisions[id];
    if (!record || record.status === 'resolved') return;
    const updated: DecisionRecord = { ...record, status: 'resolved', outcome, resolvedAt: new Date().toISOString() };
    const next: GenesisStateShape = { ...state, decisions: { ...state.decisions, [id]: updated } };
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
        currentTask: task.title,
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
      const movingAgent = state.agents[eligibleAgentIds[0]];
      next = appendEvent(next, {
        kind: 'agent.moving',
        severity: 'info',
        taskId,
        agentId: eligibleAgentIds[0],
        voicedBy: eligibleAgentIds[0],
        voicedText: {
          es: `Voy a ${OFFICE_ROOMS[task.room].label.es}.`,
          en: `Moving to ${OFFICE_ROOMS[task.room].label.en}.`,
        },
        message: {
          es: `${movingAgent?.name ?? 'Agente'} se dirige a ${OFFICE_ROOMS[task.room].label.es}.`,
          en: `${movingAgent?.name ?? 'Agent'} is moving to ${OFFICE_ROOMS[task.room].label.en}.`,
        },
        isVisualSeed: false,
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
          es: 'Archivaré este aprendizaje.',
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
        es: `Falló: ${task.title.es}. ${reason.es}`,
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
        es: `Risk Guardian marcó una alerta en ${task.title.es}.`,
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

  // ---------- wallet actions ----------

  setWallet(address: string | null): void {
    commit({ ...state, walletAddress: address, walletConnected: !!address });
  },

  // ---------- command console actions ----------

  addCommandHistory(entry: CommandHistoryEntry): void {
    const history = [entry, ...state.commandHistory].slice(0, 50);
    commit({ ...state, commandHistory: history });
  },

  updateCommandStatus(id: string, status: CommandHistoryEntry['status']): void {
    const commandHistory = state.commandHistory.map((e) =>
      e.id === id ? { ...e, status } : e
    );
    commit({ ...state, commandHistory });
  },

  // ---------- connector actions ----------

  addConnector(connector: ConnectorConfig): void {
    const connectors = [...state.connectors.filter((c) => c.id !== connector.id), connector];
    commit({ ...state, connectors });
  },

  removeConnector(id: string): void {
    commit({ ...state, connectors: state.connectors.filter((c) => c.id !== id) });
  },

  updateConnector(id: string, patch: Partial<ConnectorConfig>): void {
    const connectors = state.connectors.map((c) => c.id === id ? { ...c, ...patch } : c);
    commit({ ...state, connectors });
  },

  // ---------- paper trading actions ----------

  openPosition(agentId: string, marketId: string, question: { es: string; en: string }, outcome: 'YES' | 'NO', entryPrice: number, shares: number): void {
    const agent = state.agents[agentId];
    if (!agent) return;
    const capitalAllocated = entryPrice * shares;
    if (capitalAllocated > state.capital) return;
    const id = `pos-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const position: PaperPosition = {
      id, marketId, question, outcome, entryPrice, currentPrice: entryPrice,
      shares, capitalAllocated, openedAt: new Date().toISOString(),
      agentId, confidence: agent.learningScore, status: 'open', isReal: true,
    };
    let next: GenesisStateShape = {
      ...state,
      capital: state.capital - capitalAllocated,
      positions: { ...state.positions, [id]: position },
    };
    next = appendEvent(next, {
      kind: 'trade.opened',
      severity: 'info',
      agentId,
      message: {
        es: `${agent.name} abrió ${outcome} en «${question.es}» @ $${entryPrice.toFixed(3)} (${shares} shares).`,
        en: `${agent.name} opened ${outcome} on "${question.en}" @ $${entryPrice.toFixed(3)} (${shares} shares).`,
      },
      voicedBy: agentId,
      voicedText: {
        es: `Entré ${outcome} a $${entryPrice.toFixed(2)}.`,
        en: `Entered ${outcome} at $${entryPrice.toFixed(2)}.`,
      },
      isVisualSeed: false,
    });
    commit(next);
  },

  closePosition(positionId: string, exitPrice: number): void {
    const pos = state.positions[positionId];
    if (!pos || pos.status !== 'open') return;
    const pnl = (exitPrice - pos.entryPrice) * pos.shares * (pos.outcome === 'YES' ? 1 : -1);
    const closed: PaperPosition = {
      ...pos, exitPrice, pnl, closedAt: new Date().toISOString(), status: 'closed',
      currentPrice: exitPrice,
    };
    const { [positionId]: _, ...restPositions } = state.positions;
    void _;
    const closedList = [...state.closedPositions, closed].slice(-200);
    const agent = state.agents[pos.agentId];
    const updatedAgent = agent
      ? {
        ...agent,
        totalPnL: (agent.totalPnL ?? 0) + pnl,
        tradeCount: (agent.tradeCount ?? 0) + 1,
        winRate: (() => {
          const wins = (agent.winRate ?? 0) * (agent.tradeCount ?? 0) + (pnl > 0 ? 1 : 0);
          const total = (agent.tradeCount ?? 0) + 1;
          return wins / total;
        })(),
      }
      : agent;
    let next: GenesisStateShape = {
      ...state,
      capital: state.capital + pos.capitalAllocated + pnl,
      positions: restPositions,
      closedPositions: closedList,
      agents: agent && updatedAgent
        ? { ...state.agents, [pos.agentId]: updatedAgent }
        : state.agents,
    };
    const isPnlPositive = pnl >= 0;
    next = appendEvent(next, {
      kind: isPnlPositive ? 'trade.profit' : 'trade.loss',
      severity: isPnlPositive ? 'info' : 'warn',
      agentId: pos.agentId,
      message: {
        es: `${agent?.name ?? pos.agentId} cerró posición ${pos.outcome} @ $${exitPrice.toFixed(3)} — P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}.`,
        en: `${agent?.name ?? pos.agentId} closed ${pos.outcome} @ $${exitPrice.toFixed(3)} — P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}.`,
      },
      voicedBy: pos.agentId,
      voicedText: {
        es: `P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}.`,
        en: `P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}.`,
      },
      isVisualSeed: false,
    });
    next = appendEvent(next, {
      kind: 'trade.closed',
      severity: 'info',
      agentId: pos.agentId,
      message: {
        es: `Posición cerrada. Capital actual: $${(state.capital + pos.capitalAllocated + pnl).toFixed(2)}.`,
        en: `Position closed. Current capital: $${(state.capital + pos.capitalAllocated + pnl).toFixed(2)}.`,
      },
      isVisualSeed: false,
    });
    commit(next);
  },

  markPositionsToMarket(latestPrices: Record<string, number>): void {
    const openPositions = Object.values(state.positions);
    if (openPositions.length === 0) return;
    let changed = false;
    const updatedPositions = { ...state.positions };
    for (const pos of openPositions) {
      const price = latestPrices[pos.marketId];
      if (price === undefined) continue;
      const effectivePrice = pos.outcome === 'YES' ? price : 1 - price;
      if (Math.abs(effectivePrice - pos.currentPrice) < 0.001) continue;
      updatedPositions[pos.id] = { ...pos, currentPrice: effectivePrice };
      changed = true;
    }
    if (!changed) return;
    commit({ ...state, positions: updatedPositions });
  },

  snapshotCapital(): void {
    const totalOpenValue = Object.values(state.positions).reduce(
      (sum, pos) => sum + pos.currentPrice * pos.shares, 0
    );
    const totalCapital = state.capital + totalOpenValue;
    const history = [
      ...state.capitalHistory,
      { at: new Date().toISOString(), value: totalCapital },
    ].slice(-500);
    commit({ ...state, capitalHistory: history });
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
        if (!dirty) dirty = true;
      }
    }

    // 2) Advance movement (simple lerp toward target)
    for (const a of Object.values(next.agents)) {
      if (a.movementState !== 'moving' || !a.targetPosition) continue;
      const dx = a.targetPosition.x - a.position.x;
      const dy = a.targetPosition.y - a.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 4) {
        const arrivedRoom = a.targetRoom ?? a.currentRoom;
        next = {
          ...next,
          agents: {
            ...next.agents,
            [a.id]: {
              ...a,
              position: { ...a.position, x: a.targetPosition.x, y: a.targetPosition.y },
              movementState: 'arrived',
              currentRoom: arrivedRoom,
            },
          },
        };
        next = appendEvent(next, {
          kind: 'agent.arrived',
          severity: 'info',
          agentId: a.id,
          voicedBy: a.id,
          voicedText: {
            es: 'Llegué. A trabajar.',
            en: 'Arrived. Time to work.',
          },
          message: {
            es: `${a.name} llegó a ${OFFICE_ROOMS[arrivedRoom]?.label.es ?? arrivedRoom}.`,
            en: `${a.name} arrived at ${OFFICE_ROOMS[arrivedRoom]?.label.en ?? arrivedRoom}.`,
          },
          isVisualSeed: false,
        });
        if (!dirty) dirty = true;
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
        if (!dirty) dirty = true;
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
      } else {
        next = appendEvent(next, {
          kind: 'task.started',
          severity: 'info',
          taskId: t.id,
          agentId: speaker,
          voicedBy: speaker,
          voicedText: { es: 'Iniciando tarea.', en: 'Starting task.' },
          message: {
            es: `Empezó: ${t.title.es}.`,
            en: `Started: ${t.title.en}.`,
          },
          isVisualSeed: true,
        });
      }
      if (!dirty) dirty = true;
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
        // peer_training: senior +0.02, junior +0.08; other tasks: +0.02
        let scoreBoost = 0.02;
        if (t.type === 'peer_training') {
          const isSenior = ['senior', 'lead', 'executive'].includes(a.rank);
          scoreBoost = isSenior ? 0.02 : 0.08;
        }
        updatedAgents[aid] = {
          ...a,
          learningScore: Math.min(1, a.learningScore + scoreBoost),
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
      if (!dirty) dirty = true;
    }

    // 4.5) Periodic task.progress bubbles for working agents (~every 28s)
    const PROGRESS_INTERVAL = 28_000;
    for (const t of Object.values(next.tasks)) {
      if (t.status !== 'working' || !t.startedAt) continue;
      const startedMs = Date.parse(t.startedAt);
      if (now - startedMs < 10_000) continue;
      const speaker = t.assignedAgentIds[0];
      if (!speaker) continue;
      const lastProgress = next.events
        .slice(-60)
        .reverse()
        .find((e) => e.kind === 'task.progress' && e.taskId === t.id);
      const lastAt = lastProgress ? Date.parse(lastProgress.at) : startedMs;
      if (now - lastAt < PROGRESS_INTERVAL) continue;
      next = appendEvent(next, {
        kind: 'task.progress',
        severity: 'info',
        taskId: t.id,
        agentId: speaker,
        voicedBy: speaker,
        message: {
          es: `Trabajando en: ${t.title.es}.`,
          en: `Working on: ${t.title.en}.`,
        },
        isVisualSeed: false,
      });
      if (!dirty) dirty = true;
    }

    // 4.6) Recycle completed seed tasks so agents stay busy (20s cooldown)
    for (const t of Object.values(next.tasks)) {
      if (t.status !== 'completed' || !t.isSeed) continue;
      const age = t.completedAt ? (now - Date.parse(t.completedAt)) : Infinity;
      if (age < 20_000) continue;
      const recycled: Task = {
        ...t,
        status: 'assigned',
        isReal: false,
        startedAt: undefined,
        completedAt: undefined,
      };
      next = { ...next, tasks: { ...next.tasks, [t.id]: recycled } };
      // Mark agents as moving so they walk back to workstation
      const updatedAgents = { ...next.agents };
      for (const aid of t.assignedAgentIds) {
        const a = updatedAgents[aid];
        if (!a || a.status === 'fired' || a.status === 'onboarding') continue;
        const target = OFFICE_ROOMS[t.room]?.entryPoint;
        if (!target) continue;
        updatedAgents[aid] = {
          ...a,
          targetRoom: t.room,
          targetPosition: target,
          movementState: a.currentRoom === t.room ? 'arrived' : 'moving',
        };
      }
      next = { ...next, agents: syncAgentsFromTasks(updatedAgents, next.tasks) };
      if (!dirty) dirty = true;
    }

    // 5) Evaluate hiring queue unlock conditions
    const queueBefore = JSON.stringify(next.hiringQueue);
    next = evaluateHiringQueue(next);
    if (JSON.stringify(next.hiringQueue) !== queueBefore) if (!dirty) dirty = true;

    // 6) Error pipeline — auto-suspend/fire agents by mistakeCount
    const pipelineBefore = JSON.stringify(next.agents);
    next = runErrorPipelineInTick(next);
    if (JSON.stringify(next.agents) !== pipelineBefore) if (!dirty) dirty = true;

    // 7) Auto-training — idle agents + peer learning
    const trainingBefore = JSON.stringify(next.tasks);
    next = runAutoTrainingInTick(next, now);
    if (JSON.stringify(next.tasks) !== trainingBefore) if (!dirty) dirty = true;

    // 8) Snapshot capital every tick
    const totalOpenValue = Object.values(next.positions).reduce(
      (sum, pos) => sum + pos.currentPrice * pos.shares, 0
    );
    const totalCapital = next.capital + totalOpenValue;
    const newHistory = [
      ...next.capitalHistory,
      { at: new Date().toISOString(), value: totalCapital },
    ].slice(-500);
    next = { ...next, capitalHistory: newHistory };
    if (!dirty) dirty = true;

    if (dirty) commit({ ...next, agents: syncAgentsFromTasks(next.agents, next.tasks) });
  },
};

// ---------- helpers ----------

function evaluateHiringQueue(s: GenesisStateShape): GenesisStateShape {
  const allTasks = Object.values(s.tasks);
  const allAgents = Object.values(s.agents);
  const completedEvents = s.events.filter((e) => e.kind === 'task.completed').length;
  const failedEvents = s.events.filter((e) => e.kind === 'task.failed').length;
  let changed = false;
  const nextQueue = { ...s.hiringQueue };

  for (const [id, candidate] of Object.entries(nextQueue)) {
    if (candidate.state !== 'pending') continue;
    let unlocked = false;

    switch (candidate.unlockCondition) {
      case 'decisions-5-recorded':
        // Count task.completed events — seed tasks recycle so we track history via events
        unlocked = completedEvents >= 5;
        break;
      case 'learning-level-up': {
        const scores = allAgents.map((a) => a.learningScore);
        // Threshold 0.65: initial avg is ~0.70, fires on first tick; matches UI copy "supere 0.5"
        unlocked = scores.length > 0 && scores.reduce((a, b) => a + b, 0) / scores.length >= 0.65;
        break;
      }
      case 'module-unlocked-decisions':
        unlocked = s.modules['decisions']?.state !== 'locked-backend';
        break;
      case 'module-unlocked-markets':
        unlocked = s.modules['markets']?.state === 'ready';
        break;
      case 'tasks-pending-many':
        // Count all active tasks (working counts too — seeds are always active)
        unlocked = allTasks.filter((t) => t.status === 'queued' || t.status === 'assigned' || t.status === 'working').length > 3;
        break;
      case 'errors-keep-happening':
        // Count task.failed events — mistakeCount is not incremented by any current action
        unlocked = failedEvents >= 2;
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

function runErrorPipelineInTick(s: GenesisStateShape): GenesisStateShape {
  let next = s;
  for (const a of Object.values(next.agents)) {
    const mistakes = a.mistakeCount ?? 0;
    if (mistakes < 2) continue;
    if (mistakes >= 5 && a.status !== 'fired') {
      const { [a.id]: _, ...rest } = next.agents;
      void _;
      const fired: Agent = { ...a, status: 'fired' };
      next = {
        ...next,
        agents: rest,
        firedAgents: { ...next.firedAgents, [a.id]: fired },
        selectedAgent: next.selectedAgent === a.id ? null : next.selectedAgent,
      };
      next = appendEvent(next, {
        kind: 'agent.auto_fired',
        severity: 'critical',
        agentId: a.id,
        message: {
          es: `${a.name} despedido automáticamente por ${mistakes} errores acumulados.`,
          en: `${a.name} auto-fired after ${mistakes} accumulated mistakes.`,
        },
        voicedBy: 'visual-hr-evaluator',
        voicedText: { es: 'Despido automático ejecutado.', en: 'Auto-termination executed.' },
        isVisualSeed: false,
      });
    } else if (mistakes >= 3 && a.status !== 'suspended' && a.status !== 'fired') {
      next = {
        ...next,
        agents: { ...next.agents, [a.id]: { ...a, status: 'suspended' } },
      };
      next = appendEvent(next, {
        kind: 'agent.auto_suspended',
        severity: 'warn',
        agentId: a.id,
        message: {
          es: `${a.name} suspendido automáticamente por ${mistakes} errores.`,
          en: `${a.name} auto-suspended after ${mistakes} mistakes.`,
        },
        isVisualSeed: false,
      });
    } else if (mistakes === 2) {
      const lastWarning = [...next.events].reverse().find(
        (e) => e.kind === 'agent.warning' && e.agentId === a.id
      );
      if (!lastWarning) {
        next = appendEvent(next, {
          kind: 'agent.warning',
          severity: 'warn',
          agentId: a.id,
          voicedBy: 'visual-risk-guardian',
          voicedText: { es: 'Demasiados errores. Última advertencia.', en: 'Too many mistakes. Final warning.' },
          message: {
            es: `${a.name} recibió advertencia formal: ${mistakes} errores registrados.`,
            en: `${a.name} received formal warning: ${mistakes} mistakes recorded.`,
          },
          isVisualSeed: false,
        });
      }
    }
  }
  return next;
}

function runAutoTrainingInTick(s: GenesisStateShape, now: number): GenesisStateShape {
  let next = s;
  const allTasks = Object.values(next.tasks);

  // Increment idleTicks for agents without active tasks; reset for busy ones
  const updatedAgents = { ...next.agents };
  for (const a of Object.values(updatedAgents)) {
    if (a.status === 'fired' || a.status === 'onboarding' || a.status === 'suspended') continue;
    const hasBusyTask = allTasks.some(
      (t) =>
        t.assignedAgentIds.includes(a.id) &&
        (t.status === 'assigned' || t.status === 'moving' || t.status === 'working')
    );
    if (hasBusyTask) {
      updatedAgents[a.id] = { ...a, idleTicks: 0 };
    } else {
      updatedAgents[a.id] = { ...a, idleTicks: (a.idleTicks ?? 0) + 1 };
    }
  }
  next = { ...next, agents: updatedAgents };

  // Auto-training: agents idle for >= 2 ticks with learningScore < 0.9
  for (const a of Object.values(next.agents)) {
    if ((a.idleTicks ?? 0) < 2) continue;
    if (a.learningScore >= 0.9) continue;
    if (a.status === 'fired' || a.status === 'onboarding' || a.status === 'suspended' || a.status === 'retraining') continue;
    const alreadyTraining = allTasks.some(
      (t) => t.type === 'agent_training' && t.assignedAgentIds.includes(a.id) &&
        (t.status === 'queued' || t.status === 'assigned' || t.status === 'working')
    );
    if (alreadyTraining) continue;
    const taskId = `task-autotrain-${a.id}-${now}`;
    const trainTask: Task = {
      id: taskId,
      title: { es: `Auto-estudio: ${a.name}`, en: `Self-study: ${a.name}` },
      description: { es: `${a.name} inició auto-entrenamiento al detectar tiempo libre.`, en: `${a.name} started self-study after idle time detected.` },
      type: 'agent_training',
      assignedAgentIds: [a.id],
      room: 'hr-pod',
      status: 'queued',
      priority: 'low',
      createdAt: new Date(now).toISOString(),
      sourceModule: 'hr',
      estimatedMs: 5 * 60 * 1000,
      isSeed: false,
      isReal: true,
      isVisualSeed: false,
    };
    next = { ...next, tasks: { ...next.tasks, [taskId]: trainTask } };
    next = appendEvent(next, {
      kind: 'agent.self_trained',
      severity: 'info',
      agentId: a.id,
      voicedBy: a.id,
      voicedText: { es: 'Aprovecharé para estudiar.', en: 'Using downtime to study.' },
      message: {
        es: `${a.name} inició auto-estudio (sin tareas activas).`,
        en: `${a.name} started self-study (no active tasks).`,
      },
      isVisualSeed: false,
    });
  }

  // Peer learning: senior teaches junior
  const seniors = Object.values(next.agents).filter(
    (a) => ['senior', 'lead', 'executive'].includes(a.rank) &&
      a.learningScore > 0.75 && a.status === 'idle' && (a.idleTicks ?? 0) >= 1
  );
  const juniors = Object.values(next.agents).filter(
    (a) => ['intern', 'junior'].includes(a.rank) &&
      a.learningScore < 0.5 && a.status === 'idle'
  );

  for (const senior of seniors) {
    for (const junior of juniors) {
      if (senior.id === junior.id) continue;
      const pairActive = Object.values(next.tasks).some(
        (t) => t.type === 'peer_training' &&
          t.assignedAgentIds.includes(senior.id) && t.assignedAgentIds.includes(junior.id) &&
          (t.status === 'queued' || t.status === 'assigned' || t.status === 'working')
      );
      if (pairActive) continue;
      const taskId = `task-peer-${senior.id}-${junior.id}-${now}`;
      const peerTask: Task = {
        id: taskId,
        title: { es: `Mentoría: ${senior.name} → ${junior.name}`, en: `Mentoring: ${senior.name} → ${junior.name}` },
        description: { es: `Sesión de mentoría entre ${senior.name} y ${junior.name}.`, en: `Mentoring session between ${senior.name} and ${junior.name}.` },
        type: 'peer_training',
        assignedAgentIds: [senior.id, junior.id],
        room: 'hr-pod',
        status: 'queued',
        priority: 'low',
        createdAt: new Date(now).toISOString(),
        sourceModule: 'hr',
        estimatedMs: 8 * 60 * 1000,
        isSeed: false,
        isReal: true,
        isVisualSeed: false,
      };
      next = { ...next, tasks: { ...next.tasks, [taskId]: peerTask } };
      next = appendEvent(next, {
        kind: 'agent.mentoring',
        severity: 'info',
        agentId: senior.id,
        voicedBy: senior.id,
        voicedText: {
          es: `Voy a enseñarle a ${junior.name}.`,
          en: `I'll mentor ${junior.name}.`,
        },
        message: {
          es: `${senior.name} inició mentoría con ${junior.name}.`,
          en: `${senior.name} started mentoring ${junior.name}.`,
        },
        isVisualSeed: false,
      });
      break; // un senior solo enseña a un junior por tick
    }
  }

  return next;
}

function roomForDepartment(dept: Agent['department']): RoomId {
  switch (dept) {
    case 'Market Room': return 'market-desk';
    case 'Strategy Lab': return 'strategy-lab';
    case 'Risk Office': return 'risk-bunker';
    case 'Memory Archive': return 'memory-archive';
    case 'Debate Room': return 'debate-room';
    case 'Board Room': return 'board-room';
    case 'Genesis HR': return 'hr-pod';
    case 'Execution Desk': return 'execution-desk';
    default: return 'open-workspace';
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

export function useDecisions(): DecisionRecord[] {
  const s = useGenesisState();
  return Object.values(s.decisions).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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

export function useTaskById(id: string | null | undefined): Task | null {
  const s = useGenesisState();
  if (!id) return null;
  return s.tasks[id] ?? null;
}

export function getTasksByAgent(agentId: string): Task[] {
  return Object.values(state.tasks).filter((task) => task.assignedAgentIds.includes(agentId));
}

// Re-export TaskType for convenience
export type { TaskType };

// ---------- trading selectors ----------

// TODO_REAL_DATA: useCapital reads dead local state. Use useLiveTrading() from agentClient.ts instead.
export function useCapital(): number {
  const s = useGenesisState();
  return s.capital;
}

// TODO_REAL_DATA: usePositions reads dead local state (always []). Use useAgentData().trades from agentClient.ts instead.
export function usePositions(): PaperPosition[] {
  const s = useGenesisState();
  return Object.values(s.positions);
}

// TODO_REAL_DATA: useCapitalHistory reads dead local state. Use useLiveTrading().capitalHistory from agentClient.ts instead.
export function useCapitalHistory(): { at: string; value: number }[] {
  const s = useGenesisState();
  return s.capitalHistory;
}

export function useWallet() {
  const s = useGenesisState();
  return { address: s.walletAddress, connected: s.walletConnected };
}

// TODO_REAL_DATA: useTradingStats reads dead local closedPositions (always []). Returns 0% win rate.
// Use useLiveTrading() from agentClient.ts for real P&L stats.
export function useTradingStats() {
  const s = useGenesisState();
  const closed = s.closedPositions;
  const wins = closed.filter((p) => (p.pnl ?? 0) > 0).length;
  const losses = closed.filter((p) => (p.pnl ?? 0) <= 0).length;
  const totalPnL = closed.reduce((sum, p) => sum + (p.pnl ?? 0), 0);
  const openPositionsValue = Object.values(s.positions).reduce(
    (sum, p) => sum + (p.currentPrice - p.entryPrice) * p.shares, 0
  );
  return {
    totalTrades: closed.length,
    wins,
    losses,
    winRate: closed.length > 0 ? wins / closed.length : 0,
    totalPnL,
    openPositionsValue,
  };
}

export function useCommandHistory(): CommandHistoryEntry[] {
  const s = useGenesisState();
  return s.commandHistory;
}

export function useConnectors(): ConnectorConfig[] {
  const s = useGenesisState();
  return s.connectors;
}

// Learning sync: update agent learningScore from real backend data
export function updateAgentLearning(agentId: string, newScore: number) {
  const current = getState();
  const agent = current.agents[agentId];
  if (!agent) return;

  const clamped = Math.max(0, Math.min(1, newScore));
  const next = {
    ...current,
    agents: {
      ...current.agents,
      [agentId]: { ...agent, learningScore: clamped },
    },
  };
  commit(next);
}

// Richer learning sync: agents "live" off real measured performance — the
// learning loop feeds win rate, trade count and PnL so every module that
// renders an agent (HQ office, dashboard, HR) shows real numbers.
export function applyAgentTradingStats(
  agentId: string,
  stats: { learningScore?: number; winRate?: number; totalPnL?: number; tradeCount?: number },
) {
  const current = getState();
  const agent = current.agents[agentId];
  if (!agent) return;

  const next = {
    ...current,
    agents: {
      ...current.agents,
      [agentId]: {
        ...agent,
        ...(stats.learningScore != null ? { learningScore: Math.max(0, Math.min(1, stats.learningScore)) } : {}),
        ...(stats.winRate != null ? { winRate: stats.winRate } : {}),
        ...(stats.totalPnL != null ? { totalPnL: stats.totalPnL } : {}),
        ...(stats.tradeCount != null ? { tradeCount: stats.tradeCount } : {}),
      },
    },
  };
  commit(next);
}

// Let external engines (learning loop, sweep) put words in an agent's mouth —
// the office bubbles + activity feed render these, so agents visibly react to
// real measured results (adopted configs, verdicts, PnL milestones).
export function emitAgentSays(
  agentId: string,
  voicedText: { es: string; en: string },
  message?: { es: string; en: string },
) {
  const current = getState();
  if (!current.agents[agentId]) return;
  commit(appendEvent(current, {
    kind: 'agent.says',
    severity: 'info',
    agentId,
    voicedBy: agentId,
    voicedText,
    message: message ?? voicedText,
    isVisualSeed: true,
  }));
}
