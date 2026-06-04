// AgentExecutionView — real AI agent execution interface.
// States driven by actual LLM execution. No fake loaders.

import { useState, useRef, useEffect } from 'react';
import { useAgentExecution } from '@agents/hooks/useAgentExecution';
import type { RealAgentLive, AgentLogEntry } from '@core/types/realAgent';

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG = {
  idle:        { label: 'Inactivo',     color: '#6b7280', pulse: false },
  thinking:    { label: 'Pensando',     color: '#ffd24a', pulse: true  },
  processing:  { label: 'Procesando',   color: '#3da9fc', pulse: true  },
  researching: { label: 'Investigando', color: '#22d3ee', pulse: true  },
  executing:   { label: 'Ejecutando',   color: '#ff9f47', pulse: true  },
  completed:   { label: 'Completado',   color: '#00ff9c', pulse: false },
  error:       { label: 'Error',        color: '#ff4757', pulse: false },
} as const;

const LOG_COLOR: Record<string, string> = {
  debug: '#4b5563', info: '#6b7280', warn: '#f59e0b', error: '#ff4757',
};

const PROVIDER_COLOR: Record<string, string> = {
  claude: '#d97706', openai: '#10b981', gemini: '#4285f4', custom: '#7c5cff',
};

// ─── Atom: AgentAvatar ────────────────────────────────────────────────────────

function AgentAvatar({ agent, size = 40 }: { agent: RealAgentLive; size?: number }) {
  const cfg = STATUS_CFG[agent.status];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div
        className="w-full h-full flex items-center justify-center font-mono font-bold select-none"
        style={{
          fontSize: size * 0.35,
          color: agent.accent,
          background: `${agent.accent}18`,
          border: `1.5px solid ${agent.accent}44`,
          borderRadius: 4,
          boxShadow: cfg.pulse ? `0 0 10px ${agent.accent}33` : undefined,
        }}
      >
        {agent.name.slice(0, 2).toUpperCase()}
      </div>
      <span
        className="absolute -bottom-0.5 -right-0.5 rounded-full"
        style={{
          width: size * 0.27, height: size * 0.27,
          background: cfg.color,
          border: '1.5px solid #0a0c12',
          boxShadow: cfg.pulse ? `0 0 6px ${cfg.color}` : undefined,
          animation: cfg.pulse ? 'agent-dot-pulse 1.8s ease-in-out infinite' : undefined,
        }}
      />
    </div>
  );
}

// ─── Atom: ProviderBadge ──────────────────────────────────────────────────────

function ProviderBadge({ provider, configured }: { provider: string; configured: boolean }) {
  const color = configured ? (PROVIDER_COLOR[provider] ?? '#9ca3af') : '#374151';
  return (
    <span
      className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border"
      style={{ borderColor: `${color}55`, color: configured ? color : '#4b5563' }}
    >
      {provider.toUpperCase()}{configured ? '' : ' ×'}
    </span>
  );
}

// ─── Atom: LogViewer ──────────────────────────────────────────────────────────

function LogViewer({ logs }: { logs: AgentLogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs.length]);

  if (logs.length === 0) {
    return <p className="font-mono text-[10px] text-zinc-700 py-2">sin logs todavía</p>;
  }
  return (
    <div className="space-y-0.5 font-mono text-[10px]">
      {[...logs].reverse().map((l) => (
        <div key={l.id} className="flex gap-2 items-baseline leading-snug">
          <span className="text-zinc-700 shrink-0 tabular-nums">
            {new Date(l.at).toLocaleTimeString('es', { hour12: false })}
          </span>
          <span className="shrink-0 w-9" style={{ color: LOG_COLOR[l.level] ?? '#6b7280' }}>
            {l.level.toUpperCase()}
          </span>
          <span className="text-zinc-400">{l.message}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

// ─── AgentCard (sidebar row) ──────────────────────────────────────────────────

function AgentCard({
  agent, selected, onClick,
}: { agent: RealAgentLive; selected: boolean; onClick: () => void }) {
  const cfg = STATUS_CFG[agent.status];
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-3 border-b border-trim transition-colors hover:bg-white/[0.03]"
      style={{ background: selected ? `${agent.accent}08` : undefined }}
    >
      <div className="flex items-center gap-2.5">
        <AgentAvatar agent={agent} size={34} />
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[12px] font-semibold text-zinc-100 truncate">{agent.name}</div>
          <div className="font-mono text-[10px] text-zinc-600 truncate">{agent.role}</div>
        </div>
        <span className="font-mono text-[9px] uppercase shrink-0" style={{ color: cfg.color }}>
          {cfg.label}
        </span>
      </div>
      {agent.currentTask && cfg.pulse && (
        <div className="mt-1.5 pl-[46px] font-mono text-[10px] text-zinc-600 truncate">
          {agent.currentTask.slice(0, 70)}
        </div>
      )}
    </button>
  );
}

// ─── AgentDetail (main panel) ─────────────────────────────────────────────────

function AgentDetail({
  agent, output, logs, onExecute, executing,
}: {
  agent: RealAgentLive;
  output: string;
  logs: AgentLogEntry[];
  onExecute: (t: string) => void;
  executing: boolean;
}) {
  const [task, setTask] = useState('');
  const [tab, setTab] = useState<'output' | 'logs'>('output');
  const cfg = STATUS_CFG[agent.status];
  const isActive = cfg.pulse;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!task.trim() || executing || isActive || !agent.providerConfigured) return;
    onExecute(task.trim());
    setTask('');
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Header ── */}
      <div className="px-5 py-4 border-b border-trim shrink-0">
        <div className="flex items-start gap-4">
          <AgentAvatar agent={agent} size={48} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-0.5">
              <h2 className="font-mono text-[15px] font-bold text-zinc-100">{agent.name}</h2>
              <ProviderBadge provider={agent.provider} configured={agent.providerConfigured} />
            </div>
            <div className="font-mono text-[11px] text-zinc-500">{agent.role}</div>
            <div className="font-mono text-[10px] text-zinc-700 mt-0.5">{agent.department}</div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-mono text-[10px] uppercase tracking-wider" style={{ color: cfg.color }}>
              {cfg.label}
            </div>
            <div className="font-mono text-[9px] text-zinc-700 mt-0.5">{agent.modelId}</div>
          </div>
        </div>

        {isActive && agent.currentTask && (
          <div
            className="mt-3 px-3 py-2 font-mono text-[11px] text-zinc-400 border"
            style={{ borderColor: `${agent.accent}33`, background: `${agent.accent}06` }}
          >
            <span className="text-zinc-600 mr-2">procesando:</span>
            {agent.currentTask}
          </div>
        )}

        {!agent.providerConfigured && (
          <div className="mt-3 px-3 py-2 border border-red-400/30 bg-red-500/5 font-mono text-[11px] text-red-300">
            Provider no configurado — agrega{' '}
            {agent.provider === 'claude' ? 'ANTHROPIC_API_KEY'
              : agent.provider === 'openai' ? 'OPENAI_API_KEY'
              : agent.provider === 'gemini' ? 'GEMINI_API_KEY'
              : 'CUSTOM_API_URL'}{' '}
            al archivo .env
          </div>
        )}
      </div>

      {/* ── Task input ── */}
      <form onSubmit={handleSubmit} className="px-5 py-3 border-b border-trim shrink-0 flex gap-2">
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          disabled={isActive || !agent.providerConfigured}
          placeholder={
            !agent.providerConfigured ? 'Configura el provider primero'
              : isActive ? `${agent.name} está procesando…`
              : `Asignar tarea a ${agent.name}…`
          }
          className="flex-1 gx-tile font-mono text-[12px] text-zinc-100 px-3 py-2 focus:outline-none focus:border-zinc-400 disabled:opacity-40 disabled:cursor-not-allowed"
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={!task.trim() || isActive || !agent.providerConfigured}
          className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border transition-all disabled:opacity-40 disabled:cursor-not-allowed hover:bg-white/5"
          style={{ borderColor: `${agent.accent}55`, color: agent.accent }}
        >
          {isActive ? '…' : 'Ejecutar →'}
        </button>
      </form>

      {/* ── Tabs ── */}
      <div className="flex border-b border-trim shrink-0">
        {(['output', 'logs'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className="font-mono text-[10px] uppercase tracking-wider px-4 py-2 border-b-2 transition-colors"
            style={{
              color: tab === t ? agent.accent : '#4b5563',
              borderBottomColor: tab === t ? agent.accent : 'transparent',
            }}
          >
            {t === 'output' ? 'Salida' : `Logs${logs.length > 0 ? ` (${logs.length})` : ''}`}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'output' ? (
          <>
            {isActive && (
              <div
                className="flex items-center gap-2 mb-4 font-mono text-[11px]"
                style={{ color: cfg.color }}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full"
                  style={{ background: cfg.color, animation: 'agent-dot-pulse 1.5s ease-in-out infinite' }}
                />
                {cfg.label}…
              </div>
            )}
            {output ? (
              <div className="font-mono text-[12px] text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {output}
              </div>
            ) : !isActive ? (
              <p className="font-mono text-[11px] text-zinc-700">
                Asigna una tarea para ver la salida real de {agent.name}.
              </p>
            ) : null}
          </>
        ) : (
          <LogViewer logs={logs} />
        )}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function AgentExecutionView() {
  const { agents, providers, loading, error, perAgent, executeTask, fetchLogs } = useAgentExecution();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    if (!selectedId && agents.length > 0) setSelectedId(agents[0].id);
  }, [agents, selectedId]);

  useEffect(() => {
    if (selectedId) void fetchLogs(selectedId);
  }, [selectedId, fetchLogs]);

  const selectedAgent = agents.find((a) => a.id === selectedId) ?? null;
  const selectedState = selectedId
    ? (perAgent[selectedId] ?? { logs: [], history: [], currentOutput: '' })
    : null;

  async function handleExecute(task: string) {
    if (!selectedId || executing) return;
    setExecuting(true);
    try {
      await executeTask(selectedId, task);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 flex bg-carbon-300">
      {/* ── Sidebar ── */}
      <aside className="w-[244px] xl:w-[260px] shrink-0 border-r border-trim flex flex-col bg-carbon-200">
        <header className="px-4 py-3 border-b border-trim flex items-center justify-between shrink-0">
          <span className="gx-card-title">Agentes IA</span>
          <span className="font-mono text-[9px] text-zinc-600">
            {agents.filter((a) => a.providerConfigured).length}/{agents.length} conf.
          </span>
        </header>

        {/* Provider status strip */}
        <div className="px-4 py-2 border-b border-trim shrink-0 flex flex-wrap gap-1.5">
          {Object.entries(providers).map(([key, info]) => (
            <ProviderBadge key={key} provider={key} configured={info.configured} />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-4 py-4 font-mono text-[11px] text-zinc-600">Conectando…</p>
          ) : error ? (
            <div className="px-4 py-4 font-mono text-[11px]">
              <p className="text-red-400 mb-1">Backend offline</p>
              <p className="text-zinc-600">Ejecuta: npm run server</p>
            </div>
          ) : (
            agents.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                selected={a.id === selectedId}
                onClick={() => setSelectedId(a.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* ── Detail panel ── */}
      <div className="flex-1 min-w-0 min-h-0">
        {selectedAgent && selectedState ? (
          <AgentDetail
            agent={selectedAgent}
            output={selectedState.currentOutput}
            logs={selectedState.logs}
            onExecute={handleExecute}
            executing={executing}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            <p className="font-mono text-[12px] text-zinc-700">
              Selecciona un agente para ver su estado en tiempo real.
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes agent-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50%       { opacity: 0.4; transform: scale(1.35); }
        }
      `}</style>
    </main>
  );
}
