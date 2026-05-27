import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, RefreshCcw, WifiOff } from 'lucide-react';
import { useLanguage } from '../i18n/languageStore';
import {
  actions,
  useAgents,
  useEvents,
  useSelectedAgent,
  useTasks,
} from '../state/genesisStore';
import type { Agent } from '../types/genesis';
import type { Task } from '../types/task';
import {
  loadPolymarketSnapshot,
  type MarketEventSnapshot,
  type MarketsClientError,
  type PolymarketSnapshotResponse,
} from '../lib/marketsClient';

const AUTO_REFRESH_MS = 30_000;
const EXECUTION_EVENT_KINDS = new Set([
  'task.assigned',
  'task.moving',
  'task.started',
  'task.blocked',
  'task.completed',
  'task.failed',
  'agent.warning',
]);

function formatCompactNumber(value: number | null, language: 'es' | 'en') {
  if (value == null) return '—';
  return new Intl.NumberFormat(language === 'es' ? 'es-ES' : 'en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string | null, language: 'es' | 'en') {
  if (!value) return '—';

  try {
    return new Intl.DateTimeFormat(language === 'es' ? 'es-ES' : 'en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatClock(value: string | null, language: 'es' | 'en') {
  if (!value) return '—';

  try {
    return new Intl.DateTimeFormat(language === 'es' ? 'es-ES' : 'en-US', {
      timeStyle: 'medium',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function roomLabel(room: string, language: 'es' | 'en') {
  const labels: Record<string, { es: string; en: string }> = {
    'market-desk': { es: 'Market Desk', en: 'Market Desk' },
    'risk-bunker': { es: 'Risk Bunker', en: 'Risk Bunker' },
    'memory-archive': { es: 'Memory Archive', en: 'Memory Archive' },
    'hr-pod': { es: 'Genesis HR', en: 'Genesis HR' },
    'board-room': { es: 'Board Room', en: 'Board Room' },
    'execution-desk': { es: 'Execution Desk', en: 'Execution Desk' },
    'debate-room': { es: 'Debate Area', en: 'Debate Area' },
    'strategy-lab': { es: 'Strategy Lab', en: 'Strategy Lab' },
    'open-workspace': { es: 'Open Workspace', en: 'Open Workspace' },
  };
  return labels[room]?.[language] ?? room;
}

function statusTone(status: Agent['status']) {
  switch (status) {
    case 'working':
      return 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100';
    case 'moving':
      return 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100';
    case 'warning':
    case 'failed':
      return 'border-red-400/30 bg-red-500/10 text-red-100';
    case 'onboarding':
      return 'border-violet-400/30 bg-violet-500/10 text-violet-100';
    default:
      return 'border-trim bg-carbon-300 text-zinc-300';
  }
}

function taskTone(status: Task['status']) {
  switch (status) {
    case 'working':
      return 'text-emerald-200';
    case 'moving':
      return 'text-cyan-200';
    case 'blocked':
    case 'failed':
      return 'text-red-200';
    case 'assigned':
      return 'text-amber-200';
    default:
      return 'text-zinc-200';
  }
}

function StatusBanner({
  kind,
  language,
  detail,
}: {
  kind: 'readonly' | 'loading' | 'error';
  language: 'es' | 'en';
  detail?: string;
}) {
  const content = {
    readonly: {
      className: 'border-cyan-400/30 bg-cyan-500/10 text-cyan-100',
      title: language === 'es' ? 'Polymarket conectado en modo solo lectura.' : 'Polymarket connected in read-only mode.',
    },
    loading: {
      className: 'border-zinc-600 bg-carbon-200 text-zinc-300',
      title: language === 'es' ? 'Cargando snapshot real de mercados…' : 'Loading live market snapshot…',
    },
    error: {
      className: 'border-red-400/40 bg-red-500/10 text-red-100',
      title: detail ?? (language === 'es' ? 'Proveedor inaccesible.' : 'Provider unreachable.'),
    },
  }[kind];

  return (
    <div className={`border px-3 py-2 font-mono text-[11px] leading-snug ${content.className}`}>
      {content.title}
    </div>
  );
}

function EventCard({ event, language }: { event: MarketEventSnapshot; language: 'es' | 'en' }) {
  const topMarkets = event.markets.slice(0, 3);

  return (
    <article className="border border-trim bg-carbon-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-trim flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500 mb-1">
            {event.tags.slice(0, 3).join(' · ') || (language === 'es' ? 'Mercado' : 'Market')}
          </div>
          <h2 className="font-mono text-sm text-zinc-100 leading-snug">{event.title}</h2>
        </div>
        {event.url && (
          <a
            href={event.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-cyan-200 hover:text-cyan-100"
          >
            <span>{language === 'es' ? 'Abrir' : 'Open'}</span>
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="grid grid-cols-3 border-b border-trim">
        <div className="px-4 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {language === 'es' ? 'Vol 24h' : '24h vol'}
          </div>
          <div className="font-mono text-sm text-zinc-100">{formatCompactNumber(event.volume24hr, language)}</div>
        </div>
        <div className="px-4 py-2 border-x border-trim">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {language === 'es' ? 'Liquidez' : 'Liquidity'}
          </div>
          <div className="font-mono text-sm text-zinc-100">{formatCompactNumber(event.liquidity, language)}</div>
        </div>
        <div className="px-4 py-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {language === 'es' ? 'Cierre' : 'Ends'}
          </div>
          <div className="font-mono text-[11px] text-zinc-100">{formatDate(event.endDate, language)}</div>
        </div>
      </div>

      <ul className="divide-y divide-trim">
        {topMarkets.map((market) => (
          <li key={market.id} className="px-4 py-3">
            <div className="font-mono text-[11px] text-zinc-200 leading-snug">{market.question}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {market.outcomes.slice(0, 2).map((outcome) => (
                <span
                  key={`${market.id}-${outcome.label}`}
                  className="inline-flex items-center gap-1 border border-trim px-2 py-1 font-mono text-[10px] text-zinc-300"
                >
                  <span className="uppercase tracking-wider text-zinc-500">{outcome.label}</span>
                  <span>{outcome.price == null ? '—' : outcome.price.toFixed(3)}</span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </article>
  );
}

function AgentExecutionCard({
  agent,
  task,
  selected,
  language,
}: {
  agent: Agent;
  task?: Task;
  selected: boolean;
  language: 'es' | 'en';
}) {
  return (
    <button
      type="button"
      onClick={() => actions.setSelectedAgent(selected ? null : agent.id)}
      className={`w-full text-left border px-3 py-3 ${selected ? 'border-cyan-300/60 bg-cyan-500/10' : 'border-trim bg-carbon-200 hover:bg-white/5'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
            {roomLabel(agent.currentRoom, language)}
          </div>
          <div className="font-mono text-sm text-zinc-100 truncate">{agent.name}</div>
        </div>
        <span className={`shrink-0 border px-2 py-1 font-mono text-[10px] uppercase tracking-wider ${statusTone(agent.status)}`}>
          {agent.status}
        </span>
      </div>

      <div className="mt-2 font-mono text-[11px] text-zinc-400">
        {language === 'es' ? 'Departamento' : 'Department'}: {agent.department}
      </div>

      <div className="mt-2 font-mono text-[11px] leading-snug text-zinc-200">
        {task ? task.title[language] : agent.currentTask || (language === 'es' ? 'Sin tarea activa.' : 'No active task.')}
      </div>

      {task ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <span className={`font-mono text-[10px] uppercase tracking-wider ${taskTone(task.status)}`}>
            {task.status}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {task.sourceModule}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
            {task.priority}
          </span>
        </div>
      ) : null}
    </button>
  );
}

export default function MarketsView() {
  const language = useLanguage();
  const agents = useAgents();
  const tasks = useTasks();
  const events = useEvents();
  const selectedAgent = useSelectedAgent();
  const [snapshot, setSnapshot] = useState<PolymarketSnapshotResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryIn, setRetryIn] = useState<number | null>(null);

  const copy = useMemo(() => ({
    title: language === 'es' ? 'Mercados' : 'Markets',
    intro:
      language === 'es'
        ? 'Snapshot real de Polymarket en modo solo lectura. Sin trading, sin wallet y sin datos inventados.'
        : 'Live Polymarket snapshot in read-only mode. No trading, no wallet, and no fabricated data.',
    refresh: language === 'es' ? 'Actualizar' : 'Refresh',
    backendHint:
      language === 'es'
        ? 'Si falla el backend local, inicia `npm run server`.'
        : 'If the local backend is down, start `npm run server`.',
    empty:
      language === 'es'
        ? 'No llegaron mercados activos desde el proveedor.'
        : 'No active markets were returned by the provider.',
    liveBoard: language === 'es' ? 'Live Market Board' : 'Live Market Board',
    executionBoard: language === 'es' ? 'Execution Board' : 'Execution Board',
    recentOps: language === 'es' ? 'Recent Ops' : 'Recent Ops',
    queuedOps: language === 'es' ? 'Queued / Assigned' : 'Queued / Assigned',
  }), [language]);

  const taskById = useMemo(
    () => Object.fromEntries(tasks.map((task) => [task.id, task])),
    [tasks]
  );

  const activeExecutionAgents = useMemo(
    () =>
      agents
        .filter((agent) => agent.status !== 'fired' && (agent.currentTaskId || agent.status === 'moving' || agent.status === 'working' || agent.status === 'warning' || agent.status === 'onboarding'))
        .sort((left, right) => {
          const leftBusy = left.status === 'working' || left.status === 'moving' || left.status === 'warning';
          const rightBusy = right.status === 'working' || right.status === 'moving' || right.status === 'warning';
          if (leftBusy !== rightBusy) return leftBusy ? -1 : 1;
          return left.name.localeCompare(right.name);
        }),
    [agents]
  );

  const queuedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.status === 'queued' || task.status === 'assigned' || task.status === 'moving')
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, 8),
    [tasks]
  );

  const executionEvents = useMemo(
    () =>
      [...events]
        .reverse()
        .filter((event) => EXECUTION_EVENT_KINDS.has(event.kind))
        .slice(0, 8),
    [events]
  );

  const marketSummary = useMemo(() => {
    const marketTasks = tasks.filter((task) => task.sourceModule === 'markets' || task.room === 'market-desk' || task.room === 'risk-bunker');
    const activeMarketTasks = marketTasks.filter((task) => task.status === 'assigned' || task.status === 'moving' || task.status === 'working' || task.status === 'blocked');
    return {
      marketTasks: activeMarketTasks.length,
      workingAgents: activeExecutionAgents.filter((agent) => agent.status === 'working').length,
      watchingAgents: activeExecutionAgents.filter((agent) => agent.department === 'Market Room' || agent.department === 'Risk Office').length,
    };
  }, [activeExecutionAgents, tasks]);

  const refresh = async () => {
    setRetryIn(null);
    setLoading(true);
    setError(null);

    try {
      const next = await loadPolymarketSnapshot(8);
      setSnapshot(next);
    } catch (cause) {
      const clientError = cause as MarketsClientError;
      if (clientError.code === 'provider_unreachable') {
        setError(language === 'es' ? 'Proveedor inaccesible.' : 'Provider unreachable.');
      } else {
        setError(language === 'es' ? 'Backend local inaccesible.' : 'Local backend unreachable.');
      }
      setSnapshot(null);
      setRetryIn(60);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let disposed = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const next = await loadPolymarketSnapshot(8);
        if (!disposed) {
          setSnapshot(next);
        }
      } catch (cause) {
        if (!disposed) {
          const clientError = cause as MarketsClientError;
          if (clientError.code === 'provider_unreachable') {
            setError(language === 'es' ? 'Proveedor inaccesible.' : 'Provider unreachable.');
          } else {
            setError(language === 'es' ? 'Backend local inaccesible.' : 'Local backend unreachable.');
          }
          setSnapshot(null);
          setRetryIn(60);
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void run();
    const interval = window.setInterval(() => {
      void run();
    }, AUTO_REFRESH_MS);

    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [language]);

  useEffect(() => {
    if (retryIn === null) return;
    if (retryIn <= 0) {
      void refresh();
      return;
    }
    const timer = window.setTimeout(() => setRetryIn((n) => (n !== null ? n - 1 : null)), 1000);
    return () => window.clearTimeout(timer);
  // refresh changes identity each render, intentionally not in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryIn]);

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-6 bg-carbon-300">
      <div className="max-w-7xl mx-auto space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
              Genesis HQ
            </div>
            <h1 className="font-mono text-2xl text-zinc-100">{copy.title}</h1>
            <p className="font-mono text-[12px] text-zinc-500 mt-1 max-w-4xl">{copy.intro}</p>
          </div>
          <button
            type="button"
            onClick={() => { void refresh(); }}
            className="inline-flex items-center gap-2 border border-trim px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-zinc-200 hover:bg-white/5"
          >
            <RefreshCcw className="h-3.5 w-3.5" />
            <span>{copy.refresh}</span>
          </button>
        </header>

        {loading ? <StatusBanner kind="loading" language={language} /> : null}
        {!loading && error ? (
          <StatusBanner
            kind="error"
            language={language}
            detail={retryIn !== null
              ? `${error} ${language === 'es' ? `Reintentando en ${retryIn}s…` : `Retrying in ${retryIn}s…`}`
              : error}
          />
        ) : null}
        {!loading && !error ? <StatusBanner kind="readonly" language={language} /> : null}

        {error ? (
          <section className="border border-trim bg-carbon-200 p-4 flex items-start gap-3">
            <WifiOff className="h-4 w-4 text-red-300 mt-0.5 shrink-0" />
            <div className="font-mono text-[11px] text-zinc-300">
              <div>{copy.backendHint}</div>
              <div className="text-zinc-500 mt-1">http://127.0.0.1:8787/api</div>
            </div>
          </section>
        ) : null}

        <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="border border-trim bg-carbon-200 px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {language === 'es' ? 'Auto refresh' : 'Auto refresh'}
            </div>
            <div className="font-mono text-lg text-zinc-100">30s</div>
          </div>
          <div className="border border-trim bg-carbon-200 px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {language === 'es' ? 'Agentes monitoreando' : 'Agents watching'}
            </div>
            <div className="font-mono text-lg text-zinc-100">{marketSummary.watchingAgents}</div>
          </div>
          <div className="border border-trim bg-carbon-200 px-4 py-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
              {language === 'es' ? 'Tareas activas de mercado' : 'Active market tasks'}
            </div>
            <div className="font-mono text-lg text-zinc-100">{marketSummary.marketTasks}</div>
          </div>
        </section>

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_360px] gap-4 items-start">
          <section className="space-y-4 min-w-0">
            <div className="border border-trim bg-carbon-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {copy.liveBoard}
                </div>
                <div className="font-mono text-[11px] text-zinc-300 mt-1">
                  {language === 'es' ? 'Último pull' : 'Last pull'}: {snapshot ? formatClock(snapshot.fetchedAt, language) : '—'}
                </div>
              </div>
              <div className="flex flex-wrap gap-4">
                <div className="font-mono text-[11px] text-zinc-300">
                  {language === 'es' ? 'Eventos visibles' : 'Visible events'}: <span className="text-zinc-100">{snapshot?.events.length ?? 0}</span>
                </div>
                <div className="font-mono text-[11px] text-zinc-300">
                  {language === 'es' ? 'Agentes trabajando' : 'Agents working'}: <span className="text-zinc-100">{marketSummary.workingAgents}</span>
                </div>
              </div>
            </div>

            {!loading && !error && snapshot && snapshot.events.length === 0 ? (
              <section className="border border-trim bg-carbon-200 p-4 font-mono text-[11px] text-zinc-300">
                {copy.empty}
              </section>
            ) : null}

            {!loading && !error && snapshot ? (
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                {snapshot.events.map((event) => (
                  <EventCard key={event.id} event={event} language={language} />
                ))}
              </div>
            ) : null}
          </section>

          <aside className="space-y-4 xl:sticky xl:top-4">
            <section className="border border-trim bg-carbon-200 overflow-hidden">
              <header className="px-4 py-3 border-b border-trim">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {copy.executionBoard}
                </div>
                <div className="font-mono text-[11px] text-zinc-300 mt-1">
                  {language === 'es' ? 'Qué están ejecutando los agentes ahora.' : 'What agents are executing right now.'}
                </div>
              </header>
              <div className="p-3 space-y-3">
                {activeExecutionAgents.length > 0 ? activeExecutionAgents.map((agent) => (
                  <AgentExecutionCard
                    key={agent.id}
                    agent={agent}
                    task={agent.currentTaskId ? taskById[agent.currentTaskId] : undefined}
                    selected={selectedAgent?.id === agent.id}
                    language={language}
                  />
                )) : (
                  <div className="font-mono text-[11px] text-zinc-400">
                    {language === 'es' ? 'No hay agentes ejecutando tareas en este momento.' : 'No agents are executing tasks right now.'}
                  </div>
                )}
              </div>
            </section>

            <section className="border border-trim bg-carbon-200 overflow-hidden">
              <header className="px-4 py-3 border-b border-trim">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {copy.queuedOps}
                </div>
              </header>
              <div className="divide-y divide-trim">
                {queuedTasks.length > 0 ? queuedTasks.map((task) => (
                  <div key={task.id} className="px-4 py-3">
                    <div className="font-mono text-[11px] text-zinc-100 leading-snug">{task.title[language]}</div>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <span className={`font-mono text-[10px] uppercase tracking-wider ${taskTone(task.status)}`}>
                        {task.status}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                        {roomLabel(task.room, language)}
                      </span>
                      <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                        {task.sourceModule}
                      </span>
                    </div>
                  </div>
                )) : (
                  <div className="px-4 py-3 font-mono text-[11px] text-zinc-400">
                    {language === 'es' ? 'No hay tareas en cola.' : 'No queued tasks.'}
                  </div>
                )}
              </div>
            </section>

            <section className="border border-trim bg-carbon-200 overflow-hidden">
              <header className="px-4 py-3 border-b border-trim">
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                  {copy.recentOps}
                </div>
              </header>
              <div className="divide-y divide-trim">
                {executionEvents.length > 0 ? executionEvents.map((event) => (
                  <div key={event.id} className="px-4 py-3">
                    <div className="font-mono text-[11px] text-zinc-100 leading-snug">
                      {event.message[language]}
                    </div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      {event.kind} · {formatClock(event.at, language)}
                    </div>
                  </div>
                )) : (
                  <div className="px-4 py-3 font-mono text-[11px] text-zinc-400">
                    {language === 'es' ? 'Sin eventos recientes de ejecución.' : 'No recent execution events.'}
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
