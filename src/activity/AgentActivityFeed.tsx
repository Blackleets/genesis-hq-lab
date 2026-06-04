// AgentActivityFeed — terminal-style live activity stream.
// Sources: real store events → WebSocket ticks → synthetic heartbeat.
// Entries slide in from top, max 30 visible. No spinners.

import { useEffect, useRef, useState, useCallback } from 'react';
import { useAgents, useTasks, useEvents } from '@core/store/genesisStore';
import { useWebSocket } from '@hooks/useWebSocket';
import { useLanguage } from '@core/i18n/languageStore';
import type { Agent, AgentStatus } from '@core/types/genesis';
import type { TaskType } from '@core/types/task';
import type { SystemEvent } from '@core/types/event';

// ─── Phrase tables ────────────────────────────────────────────────────────────

const TASK_PHRASES: Record<TaskType, Array<{ es: string; en: string }>> = {
  market_scan: [
    { es: 'analizando datos de mercado', en: 'analyzing market data' },
    { es: 'escaneando señales de precio', en: 'scanning price signals' },
    { es: 'evaluando probabilidades', en: 'evaluating probabilities' },
    { es: 'procesando feeds de mercado', en: 'processing market feeds' },
    { es: 'calculando scores de señal', en: 'calculating signal scores' },
  ],
  risk_review: [
    { es: 'monitoreando exposición total', en: 'monitoring total exposure' },
    { es: 'verificando límites de stop-loss', en: 'verifying stop-loss limits' },
    { es: 'evaluando riesgo de posición', en: 'evaluating position risk' },
    { es: 'calculando VaR del portafolio', en: 'calculating portfolio VaR' },
  ],
  decision_review: [
    { es: 'deliberando opciones estratégicas', en: 'deliberating strategic options' },
    { es: 'analizando vectores de decisión', en: 'analyzing decision vectors' },
    { es: 'ponderando evidencia disponible', en: 'weighing available evidence' },
  ],
  memory_archive: [
    { es: 'archivando lección aprendida', en: 'archiving learned lesson' },
    { es: 'indexando patrones de fallo', en: 'indexing failure patterns' },
    { es: 'consolidando memoria episódica', en: 'consolidating episodic memory' },
  ],
  paper_trade: [
    { es: 'ejecutando trade en simulación', en: 'executing simulated trade' },
    { es: 'calculando tamaño de posición', en: 'calculating position size' },
    { es: 'verificando criterio de Kelly', en: 'verifying Kelly criterion' },
  ],
  signal_generation: [
    { es: 'generando estrategia de entrada', en: 'generating entry strategy' },
    { es: 'sintetizando señales de mercado', en: 'synthesizing market signals' },
    { es: 'construyendo tesis de inversión', en: 'building investment thesis' },
  ],
  agent_training: [
    { es: 'procesando lecciones previas', en: 'processing prior lessons' },
    { es: 'calibrando modelo de decisión', en: 'calibrating decision model' },
    { es: 'refinando reglas de trading', en: 'refining trading rules' },
  ],
  peer_training: [
    { es: 'transfiriendo conocimiento operativo', en: 'transferring operational knowledge' },
    { es: 'mentorizando agente junior', en: 'mentoring junior agent' },
  ],
  performance_review: [
    { es: 'auditando métricas de rendimiento', en: 'auditing performance metrics' },
    { es: 'calculando score de Brier', en: 'calculating Brier score' },
    { es: 'evaluando win rate acumulado', en: 'evaluating cumulative win rate' },
  ],
  system_check: [
    { es: 'verificando integridad del sistema', en: 'verifying system integrity' },
    { es: 'monitoreando latencia de API', en: 'monitoring API latency' },
  ],
  maintenance: [
    { es: 'ejecutando rutina de mantenimiento', en: 'running maintenance routine' },
    { es: 'optimizando parámetros internos', en: 'optimizing internal parameters' },
  ],
  hr_review: [
    { es: 'evaluando candidatos de contratación', en: 'evaluating hiring candidates' },
    { es: 'procesando solicitudes de acceso', en: 'processing access requests' },
  ],
  agent_onboarding: [
    { es: 'iniciando protocolo de incorporación', en: 'initiating onboarding protocol' },
    { es: 'cargando perfil de capacidades', en: 'loading capability profile' },
  ],
  office_upgrade: [
    { es: 'planificando mejora de infraestructura', en: 'planning infrastructure upgrade' },
    { es: 'coordinando expansión de oficina', en: 'coordinating office expansion' },
  ],
  module_unlock_review: [
    { es: 'evaluando condiciones de desbloqueo', en: 'evaluating unlock conditions' },
  ],
  language_update: [
    { es: 'actualizando configuración de idioma', en: 'updating language configuration' },
  ],
  campaign_launch: [
    { es: 'lanzando campaña de crecimiento', en: 'launching growth campaign' },
    { es: 'preparando activos de marketing', en: 'preparing marketing assets' },
  ],
  content_creation: [
    { es: 'generando contenido estratégico', en: 'generating strategic content' },
    { es: 'redactando narrativa de marca', en: 'drafting brand narrative' },
  ],
  growth_analysis: [
    { es: 'analizando métricas de adquisición', en: 'analyzing acquisition metrics' },
    { es: 'modelando curvas de crecimiento', en: 'modeling growth curves' },
  ],
  seo_audit: [
    { es: 'auditando posicionamiento orgánico', en: 'auditing organic positioning' },
  ],
  ads_review: [
    { es: 'optimizando rendimiento de anuncios', en: 'optimizing ad performance' },
  ],
  sprint_planning: [
    { es: 'planificando sprint de desarrollo', en: 'planning development sprint' },
  ],
  code_review: [
    { es: 'revisando código en producción', en: 'reviewing production code' },
    { es: 'validando integridad del sistema', en: 'validating system integrity' },
  ],
  qa_testing: [
    { es: 'ejecutando suite de pruebas', en: 'running test suite' },
    { es: 'verificando regresiones críticas', en: 'verifying critical regressions' },
  ],
  deployment: [
    { es: 'coordinando despliegue de sistema', en: 'coordinating system deployment' },
  ],
  bug_fix: [
    { es: 'diagnosticando fallo de sistema', en: 'diagnosing system failure' },
    { es: 'aplicando parche de corrección', en: 'applying correction patch' },
  ],
};

const STATUS_PHRASES: Partial<Record<AgentStatus, Array<{ es: string; en: string }>>> = {
  idle:          [{ es: 'en espera de asignación', en: 'waiting for assignment' }],
  thinking:      [
    { es: 'procesando datos entrantes', en: 'processing incoming data' },
    { es: 'evaluando próxima acción', en: 'evaluating next action' },
  ],
  debating:      [
    { es: 'deliberando en sala de debate', en: 'deliberating in debate room' },
    { es: 'analizando argumentos contrapuestos', en: 'analyzing opposing arguments' },
  ],
  learning:      [
    { es: 'asimilando nueva lección', en: 'assimilating new lesson' },
    { es: 'actualizando base de conocimiento', en: 'updating knowledge base' },
  ],
  waiting_review:[{ es: 'esperando revisión humana', en: 'waiting for human review' }],
  warning:       [{ es: 'detectando anomalía crítica', en: 'detecting critical anomaly' }],
  retraining:    [{ es: 'en ciclo de reentrenamiento', en: 'in retraining cycle' }],
};

const SEVERITY_BY_STATUS: Partial<Record<AgentStatus, ActivityEntry['severity']>> = {
  warning: 'warn',
  failed:  'critical',
  retraining: 'warn',
  promoted: 'success',
  working: 'info',
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEntry {
  id: string;
  agentId: string | null;
  agentName: string | null;
  agentColor: string;
  text: { es: string; en: string };
  at: number;
  severity: 'info' | 'warn' | 'success' | 'critical';
  isNew: boolean;
}

const MAX_ENTRIES = 30;
const HEARTBEAT_MS = 5500;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: T[], seed?: number): T {
  const i = seed !== undefined
    ? Math.floor(seed * arr.length) % arr.length
    : Math.floor(Math.random() * arr.length);
  return arr[i];
}

function phraseForAgent(agent: Agent, tasks: ReturnType<typeof useTasks>): { es: string; en: string } {
  if (agent.status === 'working' && agent.currentTaskId) {
    const task = tasks.find(t => t.id === agent.currentTaskId);
    if (task) {
      const pool = TASK_PHRASES[task.type];
      if (pool?.length) return pick(pool);
    }
    if (agent.currentTask) return agent.currentTask;
  }
  const pool = STATUS_PHRASES[agent.status];
  if (pool?.length) return pick(pool);
  return { es: 'en estado nominal', en: 'in nominal state' };
}

function eventToEntry(
  e: SystemEvent,
  agents: Agent[],
): ActivityEntry | null {
  const agent = e.agentId ? agents.find(a => a.id === e.agentId) ?? null : null;
  const skip: SystemEvent['kind'][] = [
    'agent.moving', 'agent.arrived', 'system.boot', 'language.changed',
    'office.upgrade.requested', 'office.upgrade.in_progress',
  ];
  if (skip.includes(e.kind)) return null;

  let text = e.voicedText ?? e.message;
  let severity: ActivityEntry['severity'] = e.severity === 'critical' ? 'critical'
    : e.severity === 'warn' ? 'warn'
    : e.kind === 'task.completed' || e.kind === 'agent.promoted' ? 'success'
    : 'info';

  return {
    id: `ev-${e.id}`,
    agentId: agent?.id ?? null,
    agentName: agent?.name ?? null,
    agentColor: agent?.visualProfile?.accent ?? '#9ca3af',
    text,
    at: Date.parse(e.at),
    severity,
    isNew: true,
  };
}

function heartbeatEntry(agent: Agent, tasks: ReturnType<typeof useTasks>): ActivityEntry {
  const phrase = phraseForAgent(agent, tasks);
  return {
    id: `hb-${agent.id}-${Date.now()}`,
    agentId: agent.id,
    agentName: agent.name,
    agentColor: agent.visualProfile?.accent ?? '#3da9fc',
    text: phrase,
    at: Date.now(),
    severity: SEVERITY_BY_STATUS[agent.status] ?? 'info',
    isNew: true,
  };
}

const SEVERITY_COLOR: Record<ActivityEntry['severity'], string> = {
  info:     '#6b7280',
  warn:     '#f59e0b',
  success:  '#00ff9c',
  critical: '#ff4757',
};

const SEVERITY_DOT: Record<ActivityEntry['severity'], string> = {
  info:     '#3da9fc',
  warn:     '#f59e0b',
  success:  '#00ff9c',
  critical: '#ff4757',
};

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentActivityFeed() {
  const lang = useLanguage();
  const agents = useAgents();
  const tasks = useTasks();
  const events = useEvents();
  const { lastMessage, connectionStatus } = useWebSocket();

  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const seenEventIds = useRef(new Set<string>());
  // Initialize to current count so we don't flood the feed with stale events on mount
  const prevEventCount = useRef(events.length);

  const pushEntry = useCallback((entry: ActivityEntry) => {
    setEntries(prev => {
      const next = [entry, ...prev].slice(0, MAX_ENTRIES);
      return next;
    });
    // Clear isNew flag after animation
    setTimeout(() => {
      setEntries(prev =>
        prev.map(e => e.id === entry.id ? { ...e, isNew: false } : e),
      );
    }, 500);
  }, []);

  // ── Drain new store events ──────────────────────────────────────────────────
  useEffect(() => {
    if (events.length === prevEventCount.current) return;
    const newEvents = events.slice(-(events.length - prevEventCount.current));
    prevEventCount.current = events.length;

    for (const e of newEvents) {
      if (seenEventIds.current.has(e.id)) continue;
      seenEventIds.current.add(e.id);
      const entry = eventToEntry(e, agents);
      if (entry) pushEntry(entry);
    }
  }, [events, agents, pushEntry]);

  // ── React to WebSocket backend events ──────────────────────────────────────
  useEffect(() => {
    if (!lastMessage) return;
    const msg = lastMessage;
    const id = `ws-${msg.type}-${Date.now()}`;
    if (seenEventIds.current.has(id.slice(0, 40))) return;
    seenEventIds.current.add(id.slice(0, 40));

    if (msg.type === 'trade:executed') {
      pushEntry({
        id, agentId: null, agentName: 'Sistema',
        agentColor: '#ffb547',
        text: {
          es: `trade ejecutado — precio ${(msg.price as number)?.toFixed?.(2) ?? '—'}`,
          en: `trade executed — price ${(msg.price as number)?.toFixed?.(2) ?? '—'}`,
        },
        at: Date.now(), severity: 'success', isNew: true,
      });
    } else if (msg.type === 'lesson:learned') {
      pushEntry({
        id, agentId: null, agentName: 'Memoria',
        agentColor: '#1f6fb0',
        text: {
          es: 'nueva lección archivada en memoria',
          en: 'new lesson archived to memory',
        },
        at: Date.now(), severity: 'info', isNew: true,
      });
    } else if (msg.type === 'trade:resolved') {
      const pnl = msg.pnl as number | undefined;
      const won = pnl !== undefined && pnl > 0;
      pushEntry({
        id, agentId: null, agentName: 'Tesorería',
        agentColor: won ? '#00ff9c' : '#ff4757',
        text: {
          es: `posición cerrada — ${pnl !== undefined ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' USDC' : 'resultado pendiente'}`,
          en: `position closed — ${pnl !== undefined ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' USDC' : 'result pending'}`,
        },
        at: Date.now(), severity: won ? 'success' : 'warn', isNew: true,
      });
    }
  }, [lastMessage, pushEntry]);

  // ── Heartbeat: synthetic activity for working agents ────────────────────────
  useEffect(() => {
    const id = setInterval(() => {
      const active = agents.filter(a =>
        a.status === 'working' || a.status === 'thinking' ||
        a.status === 'debating' || a.status === 'learning',
      );
      if (active.length === 0) return;
      const agent = active[Math.floor(Math.random() * active.length)];
      pushEntry(heartbeatEntry(agent, tasks));
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [agents, tasks, pushEntry]);

  // ── Seed initial entries on mount ───────────────────────────────────────────
  useEffect(() => {
    const initial = agents
      .filter(a => a.status === 'working' || a.status === 'thinking')
      .slice(0, 4)
      .map(a => ({ ...heartbeatEntry(a, tasks), isNew: false }));
    if (initial.length > 0) setEntries(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isLive = connectionStatus === 'open';

  return (
    <aside className="h-full w-[248px] xl:w-[260px] shrink-0 bg-carbon-200 border-l border-trim flex flex-col">
      {/* ── Header ── */}
      <header className="px-3 py-2.5 border-b border-trim flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          {/* Live pulse indicator */}
          <span className="relative flex h-2 w-2">
            {isLive && (
              <span
                className="absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{
                  background: '#00ff9c',
                  animation: 'genesis-ping 1.4s cubic-bezier(0,0,0.2,1) infinite',
                }}
              />
            )}
            <span
              className="relative inline-flex rounded-full h-2 w-2"
              style={{ background: isLive ? '#00ff9c' : '#374151' }}
            />
          </span>
          <span className="gx-card-title">
            Actividad
          </span>
        </div>
        <span
          className="font-mono text-[9px] uppercase tracking-wider"
          style={{ color: isLive ? '#00ff9c' : '#6b7280' }}
        >
          {isLive ? 'EN VIVO' : 'OFFLINE'}
        </span>
      </header>

      {/* ── Feed ── */}
      <div className="flex-1 overflow-y-auto px-0 py-0 relative" style={{ overflowAnchor: 'none' }}>
        {entries.length === 0 ? (
          <div className="px-3 py-4 font-mono text-[11px] text-zinc-600">
            esperando actividad de agentes…
          </div>
        ) : (
          <ul>
            {entries.map((entry) => (
              <li
                key={entry.id}
                style={{
                  animation: entry.isNew
                    ? 'genesis-slide-in 0.35s cubic-bezier(0.22,1,0.36,1) both'
                    : undefined,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                }}
              >
                <EntryRow entry={entry} lang={lang} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Footer: agent count ── */}
      <footer className="px-3 py-2 border-t border-trim shrink-0 flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">
          {agents.filter(a => a.status === 'working').length} activos
        </span>
        <span className="font-mono text-[9px] text-zinc-700">
          {entries.length} entradas
        </span>
      </footer>

      <style>{KEYFRAMES}</style>
    </aside>
  );
}

// ─── Single row ───────────────────────────────────────────────────────────────

function EntryRow({ entry, lang }: { entry: ActivityEntry; lang: 'es' | 'en' }) {
  const elapsed = Math.max(0, Math.floor((Date.now() - entry.at) / 1000));
  const timeLabel = elapsed < 5 ? 'ahora' : elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m`;

  return (
    <div className="px-3 py-2 hover:bg-white/[0.02] transition-colors group">
      {/* Agent name + timestamp */}
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Status dot */}
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{
              background: SEVERITY_DOT[entry.severity],
              boxShadow: entry.severity !== 'info'
                ? `0 0 4px ${SEVERITY_DOT[entry.severity]}88`
                : undefined,
            }}
          />
          {/* Agent name */}
          {entry.agentName && (
            <span
              className="font-mono text-[10px] font-semibold truncate"
              style={{ color: entry.agentColor }}
            >
              [{entry.agentName}]
            </span>
          )}
        </div>
        <span className="font-mono text-[9px] text-zinc-700 shrink-0 group-hover:text-zinc-500 transition-colors">
          {timeLabel}
        </span>
      </div>
      {/* Activity text */}
      <p
        className="font-mono text-[11px] leading-snug pl-3"
        style={{ color: SEVERITY_COLOR[entry.severity] }}
      >
        {entry.text[lang]}
      </p>
    </div>
  );
}

// ─── Keyframes (injected once) ────────────────────────────────────────────────

const KEYFRAMES = `
@keyframes genesis-slide-in {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@keyframes genesis-ping {
  75%, 100% {
    transform: scale(2);
    opacity: 0;
  }
}
`;
