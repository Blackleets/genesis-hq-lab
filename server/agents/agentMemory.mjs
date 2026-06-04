// agentMemory.mjs — per-agent SQLite-backed conversation and context memory.
// Creates its own tables (idempotent) to avoid touching existing schema.

import db from '../db/database.mjs';

// ─── Schema migration (idempotent) ───────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS real_agent_messages (
    id          TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    exec_id     TEXT,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    at          TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ram_agent ON real_agent_messages(agent_id, at);

  CREATE TABLE IF NOT EXISTS real_agent_executions (
    id            TEXT PRIMARY KEY,
    agent_id      TEXT NOT NULL,
    task          TEXT NOT NULL,
    status        TEXT NOT NULL,
    provider      TEXT,
    model_id      TEXT,
    input_tokens  INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    output        TEXT,
    error         TEXT,
    started_at    TEXT NOT NULL,
    completed_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_rae_agent ON real_agent_executions(agent_id, started_at);

  CREATE TABLE IF NOT EXISTS real_agent_logs (
    id        TEXT PRIMARY KEY,
    agent_id  TEXT NOT NULL,
    exec_id   TEXT,
    level     TEXT NOT NULL,
    message   TEXT NOT NULL,
    data      TEXT,
    at        TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ral_agent ON real_agent_logs(agent_id, at);
`);

const insertMessage = db.prepare(`
  INSERT INTO real_agent_messages (id, agent_id, exec_id, role, content, at)
  VALUES (@id, @agentId, @execId, @role, @content, @at)
`);

const insertExecution = db.prepare(`
  INSERT INTO real_agent_executions (id, agent_id, task, status, provider, model_id, started_at)
  VALUES (@id, @agentId, @task, @status, @provider, @modelId, @startedAt)
`);

const updateExecution = db.prepare(`
  UPDATE real_agent_executions
  SET status = @status,
      output = @output,
      error  = @error,
      input_tokens  = @inputTokens,
      output_tokens = @outputTokens,
      model_id      = @modelId,
      completed_at  = @completedAt
  WHERE id = @id
`);

const insertLog = db.prepare(`
  INSERT INTO real_agent_logs (id, agent_id, exec_id, level, message, data, at)
  VALUES (@id, @agentId, @execId, @level, @message, @data, @at)
`);

// ─── Public API ───────────────────────────────────────────────────────────────

let _counter = 0;
function uid(prefix = 'id') {
  return `${prefix}-${Date.now()}-${(++_counter).toString(36)}`;
}

export function addMessage(agentId, execId, role, content) {
  const id = uid('msg');
  const at = new Date().toISOString();
  insertMessage.run({ id, agentId, execId, role, content, at });
  return id;
}

export function getRecentMessages(agentId, limit = 10) {
  return db.prepare(`
    SELECT role, content FROM real_agent_messages
    WHERE agent_id = ?
    ORDER BY at DESC LIMIT ?
  `).all(agentId, limit).reverse();
}

export function createExecution(agentId, task, provider, modelId) {
  const id = uid('exec');
  const startedAt = new Date().toISOString();
  insertExecution.run({ id, agentId, task, status: 'thinking', provider, modelId, startedAt });
  return id;
}

export function finalizeExecution(execId, { status, output, error, inputTokens, outputTokens, modelId }) {
  updateExecution.run({
    id: execId,
    status,
    output: output ?? null,
    error: error ?? null,
    inputTokens: inputTokens ?? 0,
    outputTokens: outputTokens ?? 0,
    modelId: modelId ?? null,
    completedAt: new Date().toISOString(),
  });
}

export function addLog(agentId, execId, level, message, data = null) {
  const id = uid('log');
  const at = new Date().toISOString();
  insertLog.run({
    id,
    agentId,
    execId: execId ?? null,
    level,
    message,
    data: data ? JSON.stringify(data) : null,
    at,
  });
  return { id, agentId, execId, level, message, data, at };
}

export function getLogs(agentId, limit = 50) {
  return db.prepare(`
    SELECT id, exec_id as execId, level, message, data, at
    FROM real_agent_logs
    WHERE agent_id = ?
    ORDER BY at DESC LIMIT ?
  `).all(agentId, limit).map((row) => ({
    ...row,
    data: row.data ? JSON.parse(row.data) : null,
  }));
}

export function getRecentExecutions(agentId, limit = 5) {
  return db.prepare(`
    SELECT id, task, status, provider, model_id as modelId,
           input_tokens as inputTokens, output_tokens as outputTokens,
           output, error, started_at as startedAt, completed_at as completedAt
    FROM real_agent_executions
    WHERE agent_id = ?
    ORDER BY started_at DESC LIMIT ?
  `).all(agentId, limit);
}
