// OperatorTimelineView — minimal operator event timeline.
// Shows every system decision (trades, blocks, risk changes, learning calibration)
// ordered by timestamp. Filterable by severity and category.

import { useState, useEffect, useCallback } from 'react';
import { agentClient } from '@services/agentClient';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OperatorEvent {
  id: string;
  ts: string;
  category: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  subsystem: string;
  reason: string;
  metadata: Record<string, unknown>;
}

// ── Severity badge ────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, string> = {
  INFO:     'bg-blue-900/40 text-blue-300 border border-blue-700',
  WARNING:  'bg-yellow-900/40 text-yellow-300 border border-yellow-600',
  HIGH:     'bg-orange-900/40 text-orange-300 border border-orange-600',
  CRITICAL: 'bg-red-900/50 text-red-300 border border-red-600',
};

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.INFO}`}>
      {severity}
    </span>
  );
}

// ── Category chip ─────────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<string, string> = {
  TRADING:    'text-emerald-400',
  CONFIDENCE: 'text-purple-400',
  LEARNING:   'text-cyan-400',
  RISK:       'text-red-400',
  SYSTEM:     'text-slate-400',
};

function CategoryChip({ category }: { category: string }) {
  return (
    <span className={`text-[10px] font-mono uppercase ${CATEGORY_STYLES[category] ?? 'text-slate-400'}`}>
      {category}
    </span>
  );
}

// ── Timestamp formatter ───────────────────────────────────────────────────────

function fmt(ts: string) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
           ' · ' + d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
  } catch {
    return ts;
  }
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({ event }: { event: OperatorEvent }) {
  const [expanded, setExpanded] = useState(false);
  const hasMetadata = event.metadata && Object.keys(event.metadata).length > 0;

  return (
    <div
      className={`border-b border-carbon-200/10 px-4 py-2 hover:bg-carbon-200/5 cursor-default ${
        event.severity === 'CRITICAL' ? 'border-l-2 border-l-red-500' :
        event.severity === 'HIGH'     ? 'border-l-2 border-l-orange-500' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-[10px] font-mono text-slate-500 mt-0.5 shrink-0 w-36">{fmt(event.ts)}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <SeverityBadge severity={event.severity} />
          <CategoryChip category={event.category} />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-xs text-slate-200 font-mono break-words">{event.reason}</span>
          <span className="text-[10px] text-slate-500 ml-2">({event.subsystem})</span>
        </div>
        {hasMetadata && (
          <button
            type="button"
            onClick={() => setExpanded(e => !e)}
            className="text-[10px] text-slate-500 hover:text-slate-300 shrink-0"
          >
            {expanded ? '▲' : '▼'}
          </button>
        )}
      </div>
      {expanded && hasMetadata && (
        <div className="mt-1 ml-36 pl-2 border-l border-slate-700">
          <pre className="text-[10px] text-slate-400 overflow-x-auto">
            {JSON.stringify(event.metadata, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Filter bar ────────────────────────────────────────────────────────────────

const SEVERITIES = ['ALL', 'INFO', 'WARNING', 'HIGH', 'CRITICAL'];
const CATEGORIES = ['ALL', 'TRADING', 'CONFIDENCE', 'LEARNING', 'RISK', 'SYSTEM'];

// ── Main view ─────────────────────────────────────────────────────────────────

export default function OperatorTimelineView() {
  const [events, setEvents] = useState<OperatorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchEvents = useCallback(async () => {
    try {
      const params: Record<string, string> = { limit: '200' };
      if (severityFilter !== 'ALL') params.severity = severityFilter;
      if (categoryFilter !== 'ALL') params.category = categoryFilter;

      const data = await agentClient.getOperatorTimeline(params);
      setEvents((data?.events ?? []) as OperatorEvent[]);
      setError(null);
    } catch (err) {
      setError((err as Error).message ?? 'Error fetching timeline');
    } finally {
      setLoading(false);
    }
  }, [severityFilter, categoryFilter]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(fetchEvents, 10_000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchEvents]);

  return (
    <div className="h-full flex flex-col bg-carbon-300 text-slate-200">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-carbon-200/20 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-sm font-mono font-semibold text-slate-100">Operator Timeline</h1>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {events.length} evento(s) · cada decisión del sistema
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setAutoRefresh(a => !a)}
              className={`text-[10px] font-mono px-2 py-1 rounded border ${
                autoRefresh
                  ? 'border-emerald-700 text-emerald-400 bg-emerald-900/20'
                  : 'border-slate-600 text-slate-500'
              }`}
            >
              {autoRefresh ? '⟳ Auto' : '⟳ Paused'}
            </button>
            <button
              type="button"
              onClick={fetchEvents}
              className="text-[10px] font-mono px-2 py-1 rounded border border-slate-600 text-slate-400 hover:text-slate-200"
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 items-center flex-wrap">
          <div className="flex gap-1 items-center">
            <span className="text-[10px] text-slate-500 mr-1">Severity:</span>
            {SEVERITIES.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setSeverityFilter(s)}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  severityFilter === s
                    ? 'border-slate-400 text-slate-100 bg-slate-700'
                    : 'border-slate-700 text-slate-500 hover:text-slate-300'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-1 items-center">
            <span className="text-[10px] text-slate-500 mr-1">Category:</span>
            {CATEGORIES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setCategoryFilter(c)}
                className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  categoryFilter === c
                    ? 'border-slate-400 text-slate-100 bg-slate-700'
                    : 'border-slate-700 text-slate-500 hover:text-slate-300'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center h-32 text-slate-500 text-xs font-mono">
            Cargando eventos…
          </div>
        )}
        {error && (
          <div className="px-4 py-3 text-red-400 text-xs font-mono bg-red-900/10 border-b border-red-800/30">
            Error: {error}
          </div>
        )}
        {!loading && events.length === 0 && (
          <div className="flex items-center justify-center h-32 text-slate-500 text-xs font-mono">
            No hay eventos todavía. Los eventos aparecen al ejecutar ciclos de trading.
          </div>
        )}
        {events.map(ev => (
          <EventRow key={ev.id} event={ev} />
        ))}
      </div>
    </div>
  );
}
