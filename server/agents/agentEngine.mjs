// agentEngine.mjs — core execution engine for real AI agents.
// States are driven by actual execution events, not timers.
// Broadcasts real-time status via the WebSocket broadcast function.

import { routeToProvider, isProviderConfigured } from './providerRouter.mjs';
import {
  addMessage,
  getRecentMessages,
  createExecution,
  finalizeExecution,
  addLog,
  getRecentExecutions,
} from './agentMemory.mjs';
import { getAgent, getAllAgents } from './agentRegistry.mjs';

// ─── In-memory state (per-agent) ─────────────────────────────────────────────
// Persisted state lives in SQLite. This is the live status ring.

const agentState = new Map(); // agentId → AgentLiveState

/**
 * @typedef {Object} AgentLiveState
 * @property {'idle'|'thinking'|'processing'|'researching'|'executing'|'completed'|'error'} status
 * @property {string|null} currentExecId
 * @property {string|null} currentTask
 * @property {number} startedAt
 */

function initState(agentId) {
  if (!agentState.has(agentId)) {
    agentState.set(agentId, {
      status: 'idle',
      currentExecId: null,
      currentTask: null,
      startedAt: 0,
    });
  }
  return agentState.get(agentId);
}

function setState(agentId, patch) {
  const current = initState(agentId);
  Object.assign(current, patch);
  return current;
}

// ─── Broadcast injection (set from server/index.mjs) ─────────────────────────

let broadcastFn = null;

export function setBroadcast(fn) {
  broadcastFn = fn;
}

function emit(type, payload) {
  if (broadcastFn) {
    try { broadcastFn({ type, ...payload }); } catch { /* non-fatal */ }
  }
}

// ─── Status transition helpers ────────────────────────────────────────────────

function setStatus(agentId, status, extraPayload = {}) {
  setState(agentId, { status });
  emit('agent:status', { agentId, status, ...extraPayload });
}

function log(agentId, execId, level, message, data = null) {
  const entry = addLog(agentId, execId, level, message, data);
  emit('agent:log', { agentId, execId, ...entry });
  return entry;
}

// ─── Task content classifier ──────────────────────────────────────────────────
// Determines if the LLM response indicates a research or execution phase.
// This is real — based on actual response content, not a timer.

function classifyOutput(content) {
  const lower = content.toLowerCase();
  const researchKeywords = ['need more data', 'insufficient information', 'research required',
    'to research', 'would need to check', 'cannot determine without', 'pending data'];
  const executingKeywords = ['executing', 'applying', 'implementing', 'running', 'processing step'];

  if (researchKeywords.some((kw) => lower.includes(kw))) return 'researching';
  if (executingKeywords.some((kw) => lower.includes(kw))) return 'executing';
  return 'processing';
}

// ─── Core execution ───────────────────────────────────────────────────────────

/**
 * Execute a task with the specified agent.
 * All status transitions come from real execution events.
 *
 * @param {string} agentId
 * @param {string} taskText
 * @returns {Promise<{ok:boolean; output?:string; error?:string; execId:string; tokens:{in:number,out:number}}>}
 */
export async function executeTask(agentId, taskText) {
  const def = getAgent(agentId);
  if (!def) throw new Error(`Agent not found: ${agentId}`);

  const state = initState(agentId);
  if (state.status !== 'idle' && state.status !== 'completed' && state.status !== 'error') {
    throw new Error(`Agent ${def.name} is busy (status: ${state.status})`);
  }

  if (!isProviderConfigured(def.provider)) {
    throw new Error(`Provider '${def.provider}' is not configured. Set the required API key.`);
  }

  // ── Phase 1: thinking — building context ──────────────────────────────────
  const execId = createExecution(agentId, taskText, def.provider, def.modelId);
  setState(agentId, { status: 'thinking', currentExecId: execId, currentTask: taskText, startedAt: Date.now() });
  setStatus(agentId, 'thinking', { execId, task: taskText });

  log(agentId, execId, 'info', `Task received: ${taskText.slice(0, 120)}`);
  log(agentId, execId, 'debug', `Loading memory context for ${def.name}`);

  // Load conversation history (real memory — no fabrication)
  const history = getRecentMessages(agentId, 8);
  log(agentId, execId, 'debug', `Memory loaded: ${history.length} prior messages`);

  // Build message list: history + current task
  const messages = [
    ...history,
    { role: 'user', content: taskText },
  ];

  // ── Phase 2: processing — HTTP request in flight ──────────────────────────
  setStatus(agentId, 'processing', { execId });
  log(agentId, execId, 'info', `Calling ${def.provider}/${def.modelId}`);

  let result;
  try {
    result = await routeToProvider(messages, def.systemPrompt, {
      provider: def.provider,
      modelId: def.modelId,
      maxTokens: 1200,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(agentId, execId, 'error', `Provider call failed: ${errorMsg}`);
    setState(agentId, { status: 'error', currentExecId: null });
    setStatus(agentId, 'error', { execId, error: errorMsg });
    finalizeExecution(execId, { status: 'error', error: errorMsg, inputTokens: 0, outputTokens: 0, modelId: def.modelId });
    return { ok: false, error: errorMsg, execId, tokens: { in: 0, out: 0 } };
  }

  // ── Phase 3: classify → researching or executing (real, from output) ──────
  const phase = classifyOutput(result.content);
  if (phase !== 'processing') {
    setStatus(agentId, phase, { execId });
    log(agentId, execId, 'debug', `Output classified as: ${phase}`);
  }

  // ── Phase 4: persist to memory ────────────────────────────────────────────
  addMessage(agentId, execId, 'user', taskText);
  addMessage(agentId, execId, 'assistant', result.content);

  log(agentId, execId, 'info',
    `Completed — ${result.inputTokens} in / ${result.outputTokens} out tokens`,
    { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
  );

  // ── Phase 5: completed ────────────────────────────────────────────────────
  finalizeExecution(execId, {
    status: 'completed',
    output: result.content,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    modelId: result.model,
  });

  setState(agentId, { status: 'completed', currentExecId: null });
  setStatus(agentId, 'completed', { execId });

  // Reset to idle after 5s so the agent is ready for the next task
  setTimeout(() => {
    const s = agentState.get(agentId);
    if (s?.status === 'completed') {
      setState(agentId, { status: 'idle', currentTask: null });
      emit('agent:status', { agentId, status: 'idle' });
    }
  }, 5000);

  emit('agent:completed', {
    agentId,
    execId,
    output: result.content,
    tokens: { in: result.inputTokens, out: result.outputTokens },
    model: result.model,
  });

  return {
    ok: true,
    output: result.content,
    execId,
    tokens: { in: result.inputTokens, out: result.outputTokens },
  };
}

// ─── Query helpers ────────────────────────────────────────────────────────────

export function getAgentStatus(agentId) {
  const def = getAgent(agentId);
  if (!def) return null;
  const state = initState(agentId);
  return {
    ...def,
    status: state.status,
    currentExecId: state.currentExecId,
    currentTask: state.currentTask,
    providerConfigured: isProviderConfigured(def.provider),
  };
}

export function getAllAgentStatuses() {
  return getAllAgents().map((def) => {
    const state = initState(def.id);
    return {
      ...def,
      status: state.status,
      currentExecId: state.currentExecId,
      currentTask: state.currentTask,
      providerConfigured: isProviderConfigured(def.provider),
    };
  });
}

export function getAgentWithHistory(agentId) {
  const status = getAgentStatus(agentId);
  if (!status) return null;
  return {
    ...status,
    recentExecutions: getRecentExecutions(agentId, 5),
  };
}
