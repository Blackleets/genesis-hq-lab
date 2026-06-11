import { useEffect, useState } from 'react';
import { apiUrl } from '@services/apiBase';

interface OperatorEvent {
  id: string;
  ts: number;
  category: string;
  severity: 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
  subsystem: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

const SEVERITY_COLOR: Record<string, string> = {
  INFO:     '#6b7280',
  WARNING:  '#f59e0b',
  HIGH:     '#f97316',
  CRITICAL: '#ef4444',
};

function timeAgo(ts: number) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

export function PredictionMarketLogs() {
  const [events, setEvents] = useState<OperatorEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch(apiUrl('/api/operator/timeline?category=PREDICTION&limit=20'))
        .then((r) => r.json())
        .then((d) => {
          setEvents(Array.isArray(d.events) ? d.events : Array.isArray(d) ? d : []);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    };
    load();
    const id = setInterval(load, 15_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0d1117] overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Prediction Market Logs</h3>
        <p className="text-[9px] text-zinc-600 mt-0.5">PREDICTION category events · real-time</p>
      </div>

      {loading && <div className="p-4 text-xs text-zinc-600 animate-pulse">Loading events…</div>}

      {!loading && events.length === 0 && (
        <div className="p-6 text-center text-xs text-zinc-600">
          No PREDICTION events yet. Data loads appear here once the module starts fetching.
        </div>
      )}

      <div className="divide-y divide-zinc-900 max-h-64 overflow-y-auto">
        {events.map((ev) => (
          <div key={ev.id} className="px-4 py-2.5 flex items-start gap-3">
            <span className="text-[9px] font-mono shrink-0 mt-0.5"
              style={{ color: SEVERITY_COLOR[ev.severity] ?? '#6b7280' }}>
              {ev.severity}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono text-zinc-300">{ev.reason}</p>
              <p className="text-[9px] text-zinc-600 font-mono mt-0.5">{ev.subsystem} · {timeAgo(ev.ts)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
