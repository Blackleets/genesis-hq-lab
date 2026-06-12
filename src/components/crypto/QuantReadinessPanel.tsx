import { useEffect, useState, useCallback } from 'react';
import type { QuantReport, QuantStrategyEntry } from '@services/quantClient';
import { fetchQuantReport } from '@services/quantClient';

const BG     = '#0a0a06';
const BORDER = '#1f1f10';

const pct = (n: number | null | undefined) =>
  n == null ? '-' : `${(n * 100).toFixed(1)}%`;
const pf  = (n: number | null | undefined) =>
  n == null ? '-' : n.toFixed(2);

function ago(iso: string | null | undefined) {
  if (!iso) return '-';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '-';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

const STATUS_COLOR: Record<string, string> = {
  PROMOTED:    '#22c55e',
  PAPER:       '#3b82f6',
  RESEARCH:    '#a78bfa',
  BACKTESTING: '#f59e0b',
  REJECTED:    '#ef4444',
  DISABLED:    '#52525b',
};

function StatusBadge({ status }: { status: QuantStrategyEntry['status'] }) {
  const color = STATUS_COLOR[status] ?? '#9ca3af';
  return (
    <span
      style={{ color, border: `1px solid ${color}33`, borderRadius: 3 }}
      className="px-1 py-px font-mono text-[8px] uppercase tracking-wider"
    >
      {status}
    </span>
  );
}

function EdgeBanner({ answer, headline }: { answer: string; headline: string }) {
  const color = answer === 'YES' ? '#22c55e' : answer === 'NO' ? '#ef4444' : '#f59e0b';
  const bg    = answer === 'YES' ? '#052e1622' : answer === 'NO' ? '#450a0a22' : '#451a0322';
  return (
    <div
      style={{ background: bg, border: `1px solid ${color}44`, borderRadius: 6 }}
      className="mb-3 px-3 py-2"
    >
      <div style={{ color }} className="font-mono text-[10px] font-bold uppercase tracking-widest">
        {answer === 'YES' ? '✓ EDGE VALIDADO' : answer === 'NO' ? '✗ SIN EDGE' : '? EDGE DESCONOCIDO'}
      </div>
      <div className="mt-0.5 font-mono text-[9px] text-zinc-400 leading-tight">{headline}</div>
    </div>
  );
}

function StrategyRow({ s }: { s: QuantStrategyEntry }) {
  return (
    <div
      style={{ borderBottom: `1px solid ${BORDER}` }}
      className="flex items-center gap-2 py-1.5 px-1"
    >
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[9px] text-zinc-200 truncate">{s.name}</div>
        <div className="font-mono text-[8px] text-zinc-600 truncate">{s.strategyId}</div>
      </div>
      <StatusBadge status={s.status} />
      <div className="font-mono text-[8px] text-zinc-500 w-10 text-right tabular-nums">
        {s.trades != null ? `${s.trades}t` : '—'}
      </div>
      <div className="font-mono text-[8px] text-zinc-400 w-10 text-right tabular-nums">
        PF {pf(s.profitFactor)}
      </div>
      <div className="font-mono text-[8px] text-zinc-400 w-10 text-right tabular-nums">
        WR {pct(s.winRate)}
      </div>
    </div>
  );
}

function BlockerList({ blockers }: { blockers: { reason: string; code: string }[] }) {
  if (blockers.length === 0) return null;
  return (
    <div className="mb-3">
      <div className="font-mono text-[8px] uppercase tracking-widest text-red-500 mb-1">
        Blockers ({blockers.length})
      </div>
      {blockers.map((b, i) => (
        <div key={i} className="flex gap-2 items-start py-0.5">
          <span className="font-mono text-[8px] text-red-500 shrink-0">[{b.code}]</span>
          <span className="font-mono text-[8px] text-zinc-400 leading-tight">{b.reason}</span>
        </div>
      ))}
    </div>
  );
}

function AllocationSummary({ allocation }: { allocation: NonNullable<QuantReport['allocation']> }) {
  if (allocation.blocked) {
    return (
      <div className="mb-3">
        <div className="font-mono text-[8px] uppercase tracking-widest text-amber-500 mb-1">Capital</div>
        <div className="font-mono text-[9px] text-amber-400">
          BLOQUEADO — {allocation.blockReason ?? 'safe mode activo'}
        </div>
      </div>
    );
  }
  return (
    <div className="mb-3">
      <div className="font-mono text-[8px] uppercase tracking-widest text-zinc-500 mb-1">Capital asignado</div>
      <div className="flex gap-4 mb-1">
        <div>
          <div className="font-mono text-[9px] text-zinc-200">{pct(allocation.totalAllocatedPct)}</div>
          <div className="font-mono text-[8px] text-zinc-600">total %</div>
        </div>
        <div>
          <div className="font-mono text-[9px] text-zinc-200">
            ${allocation.totalAllocatedUsd.toFixed(0)}
          </div>
          <div className="font-mono text-[8px] text-zinc-600">USD (papel)</div>
        </div>
      </div>
      {allocation.topAllocations.length > 0 && (
        <div className="space-y-0.5">
          {allocation.topAllocations.map((a) => (
            <div key={a.strategyId} className="flex items-center gap-2">
              <span className="font-mono text-[8px] text-zinc-500 truncate flex-1">{a.name}</span>
              <span className="font-mono text-[8px] text-blue-400 shrink-0">{pct(a.recommendedCapitalPct)}</span>
              {a.paperMode && (
                <span className="font-mono text-[7px] text-blue-600 shrink-0">PAPEL</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuantReadinessPanel({ es = true }: { es?: boolean }) {
  const [report, setReport]   = useState<QuantReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetchQuantReport();
      setReport(r);
      setLastFetch(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const label = (en: string, sp: string) => (es ? sp : en);

  return (
    <div
      style={{ background: BG, border: `1px solid ${BORDER}`, borderRadius: 8 }}
      className="p-3 text-zinc-300 select-none"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[9px] uppercase tracking-widest text-amber-400">
          {label('Quant Readiness', 'Quant Lab — Estado')}
        </div>
        <div className="flex items-center gap-2">
          {lastFetch && (
            <span className="font-mono text-[8px] text-zinc-600">
              {ago(new Date(lastFetch).toISOString())}
            </span>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="font-mono text-[8px] text-zinc-500 hover:text-zinc-300 disabled:opacity-40"
          >
            {loading ? '…' : '↺'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 font-mono text-[9px] text-red-400">
          {label('Backend unavailable', 'Backend no disponible')}: {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !report && (
        <div className="font-mono text-[9px] text-zinc-600 animate-pulse">
          {label('Loading…', 'Cargando…')}
        </div>
      )}

      {report && (
        <>
          {/* Edge banner */}
          <EdgeBanner answer={report.edgeAnswer} headline={report.headline} />

          {/* Blockers */}
          <BlockerList blockers={report.blockers} />

          {/* Allocation */}
          {report.allocation && <AllocationSummary allocation={report.allocation} />}

          {/* Metrics row */}
          <div className="flex gap-4 mb-3">
            <div>
              <div className="font-mono text-[9px] text-zinc-200">
                {report.metrics.totalStrategies}
              </div>
              <div className="font-mono text-[8px] text-zinc-600">estrategias</div>
            </div>
            {report.metrics.profitFactor != null && (
              <div>
                <div className="font-mono text-[9px] text-zinc-200">
                  {pf(report.metrics.profitFactor)}
                </div>
                <div className="font-mono text-[8px] text-zinc-600">PF</div>
              </div>
            )}
            {report.metrics.winRate != null && (
              <div>
                <div className="font-mono text-[9px] text-zinc-200">
                  {pct(report.metrics.winRate)}
                </div>
                <div className="font-mono text-[8px] text-zinc-600">WR</div>
              </div>
            )}
            <div>
              <div
                className="font-mono text-[9px]"
                style={{ color: report.dataMode === 'REAL_DATA' ? '#22c55e' : '#f59e0b' }}
              >
                {report.dataMode}
              </div>
              <div className="font-mono text-[8px] text-zinc-600">fuente</div>
            </div>
          </div>

          {/* Strategy list */}
          <div className="mb-2">
            <div className="font-mono text-[8px] uppercase tracking-widest text-zinc-500 mb-1">
              {label('Strategies', 'Estrategias')}
            </div>
            <div style={{ border: `1px solid ${BORDER}`, borderRadius: 4 }}>
              {report.strategies.map((s) => (
                <StrategyRow key={s.strategyId} s={s} />
              ))}
            </div>
          </div>

          {/* Status counts */}
          <div className="flex flex-wrap gap-2 mt-2">
            {Object.entries(report.metrics.byStatus).map(([status, count]) => (
              <span key={status} className="font-mono text-[7px]" style={{ color: STATUS_COLOR[status] ?? '#9ca3af' }}>
                {status}:{count}
              </span>
            ))}
          </div>

          {/* Updated at */}
          {report.updatedAt && (
            <div className="mt-2 font-mono text-[7px] text-zinc-700 text-right">
              {label('updated', 'actualizado')} {ago(report.updatedAt)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
