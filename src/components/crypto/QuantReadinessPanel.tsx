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
  const color = answer === 'YES'          ? '#22c55e'
              : answer === 'WF_VALIDATED' ? '#f59e0b'
              : answer === 'NO'           ? '#ef4444'
              : '#9ca3af';
  const bg    = answer === 'YES'          ? '#052e1622'
              : answer === 'WF_VALIDATED' ? '#451a0322'
              : answer === 'NO'           ? '#450a0a22'
              : '#11111122';
  const label = answer === 'YES'          ? '✓ EDGE VALIDADO'
              : answer === 'WF_VALIDATED' ? '⚡ OOS EDGE HISTÓRICO VALIDADO'
              : answer === 'NO'           ? '✗ SIN EDGE'
              : '? EDGE DESCONOCIDO';
  return (
    <div
      style={{ background: bg, border: `1px solid ${color}44`, borderRadius: 6 }}
      className="mb-3 px-3 py-2"
    >
      <div style={{ color }} className="font-mono text-[10px] font-bold uppercase tracking-widest">
        {label}
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

function BlockerList({ blockers, wfValidated }: { blockers: { reason: string; code: string }[]; wfValidated?: boolean }) {
  if (blockers.length === 0) return null;
  const hardBlockers = blockers.filter(b => !(wfValidated && b.code === 'INSUFFICIENT_TRADES'));
  const softBlockers = blockers.filter(b =>   wfValidated && b.code === 'INSUFFICIENT_TRADES');
  return (
    <div className="mb-3">
      {hardBlockers.length > 0 && (
        <>
          <div className="font-mono text-[8px] uppercase tracking-widest text-red-500 mb-1">
            Blockers ({hardBlockers.length})
          </div>
          {hardBlockers.map((b, i) => (
            <div key={i} className="flex gap-2 items-start py-0.5">
              <span className="font-mono text-[8px] text-red-500 shrink-0">[{b.code}]</span>
              <span className="font-mono text-[8px] text-zinc-400 leading-tight">{b.reason}</span>
            </div>
          ))}
        </>
      )}
      {softBlockers.map((b, i) => (
        <div key={`soft-${i}`} className="flex gap-2 items-start py-0.5">
          <span className="font-mono text-[8px] text-amber-500 shrink-0">⏳</span>
          <span className="font-mono text-[8px] text-amber-600 leading-tight">Acumulando trades paper para confirmación live · {b.reason}</span>
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
          <BlockerList blockers={report.blockers} wfValidated={report.edgeAnswer === 'WF_VALIDATED'} />

          {/* Allocation */}
          {report.allocation && <AllocationSummary allocation={report.allocation} />}

          {/* Core metrics row */}
          <div className="flex flex-wrap gap-4 mb-2">
            <div>
              <div className="font-mono text-[9px] text-zinc-200">{report.metrics.totalStrategies}</div>
              <div className="font-mono text-[8px] text-zinc-600">estrategias</div>
            </div>
            {report.metrics.profitFactor != null && (
              <div>
                <div className="font-mono text-[9px] text-zinc-200">{pf(report.metrics.profitFactor)}</div>
                <div className="font-mono text-[8px] text-zinc-600">PF</div>
              </div>
            )}
            {report.metrics.winRate != null && (
              <div>
                <div className="font-mono text-[9px] text-zinc-200">{pct(report.metrics.winRate)}</div>
                <div className="font-mono text-[8px] text-zinc-600">WR</div>
              </div>
            )}
            {report.metrics.maxDrawdown != null && (
              <div>
                <div
                  className="font-mono text-[9px]"
                  style={{ color: report.metrics.maxDrawdown > 0.15 ? '#ef4444' : '#22c55e' }}
                >
                  {pct(report.metrics.maxDrawdown)}
                </div>
                <div className="font-mono text-[8px] text-zinc-600">DD máx</div>
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

          {/* Extended edge metrics */}
          <div
            style={{ border: `1px solid ${BORDER}`, borderRadius: 4 }}
            className="flex flex-wrap gap-x-4 gap-y-1 px-2 py-1.5 mb-3"
          >
            {report.metrics.rollingPf15 != null && (
              <div className="flex items-center gap-1">
                <span className="font-mono text-[7px] text-zinc-600">PF-15</span>
                <span
                  className="font-mono text-[9px]"
                  style={{ color: report.metrics.rollingPf15 >= 1.0 ? '#22c55e' : '#ef4444' }}
                >
                  {pf(report.metrics.rollingPf15)}
                </span>
              </div>
            )}
            {report.metrics.sortinoProxy != null && (
              <div className="flex items-center gap-1">
                <span className="font-mono text-[7px] text-zinc-600">Sortino</span>
                <span className="font-mono text-[9px] text-zinc-300">{pf(report.metrics.sortinoProxy)}</span>
              </div>
            )}
            {report.metrics.sharpeProxy != null && (
              <div className="flex items-center gap-1">
                <span className="font-mono text-[7px] text-zinc-600">Sharpe</span>
                <span className="font-mono text-[9px] text-zinc-300">{pf(report.metrics.sharpeProxy)}</span>
              </div>
            )}
            {report.metrics.maxLossStreak != null && (
              <div className="flex items-center gap-1">
                <span className="font-mono text-[7px] text-zinc-600">Racha</span>
                <span
                  className="font-mono text-[9px]"
                  style={{ color: report.metrics.maxLossStreak >= 8 ? '#ef4444' : '#a1a1aa' }}
                >
                  -{report.metrics.maxLossStreak}
                </span>
              </div>
            )}
            {/* Walk-forward OOS status */}
            <div className="flex items-center gap-1">
              <span className="font-mono text-[7px] text-zinc-600">WF-OOS</span>
              {report.metrics.wfRunAt == null ? (
                <span className="font-mono text-[8px] text-amber-500">sin datos</span>
              ) : report.metrics.wfRobustCombined || report.metrics.wfRobustShort ? (
                <span className="font-mono text-[8px] text-green-400">
                  {report.metrics.wfRobustCombined ? 'COMBINADO ✓' : 'CORTO ✓'}
                </span>
              ) : (
                <span className="font-mono text-[8px] text-red-400">NO ROBUSTO</span>
              )}
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
