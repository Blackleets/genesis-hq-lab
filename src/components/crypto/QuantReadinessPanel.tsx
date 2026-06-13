import { useEffect, useState, useCallback, useRef } from 'react';
import type { QuantReport, QuantStrategyEntry, WfStatus } from '@services/quantClient';
import { fetchQuantReport, fetchWfStatus, triggerWalkForward } from '@services/quantClient';

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
  const [report, setReport]       = useState<QuantReport | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<number | null>(null);
  const [wfStatus, setWfStatus]   = useState<WfStatus | null>(null);
  const [wfTrigering, setWfTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadWf = useCallback(async () => {
    try { setWfStatus(await fetchWfStatus()); } catch { /* non-fatal */ }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [r] = await Promise.all([fetchQuantReport(), loadWf()]);
      setReport(r);
      setLastFetch(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  }, [loadWf]);

  // Poll WF status every 5s while running, otherwise 2 min full reload
  useEffect(() => {
    void load();
    pollRef.current = setInterval(async () => {
      const wf = await fetchWfStatus().catch(() => null);
      setWfStatus(wf);
      if (wf && !wf.running) void load(); // refresh report once WF settles
    }, 2 * 60 * 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Fast-poll every 5s while WF is running
  useEffect(() => {
    if (!wfStatus?.running) return;
    const id = setInterval(() => void loadWf(), 5000);
    return () => clearInterval(id);
  }, [wfStatus?.running, loadWf]);

  const handleRunWf = useCallback(async () => {
    setWfTriggering(true);
    try {
      await triggerWalkForward();
      await loadWf();
    } catch { /* non-fatal */ } finally {
      setWfTriggering(false);
    }
  }, [loadWf]);

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
            onClick={handleRunWf}
            disabled={wfTrigering || wfStatus?.running}
            title="Run walk-forward OOS validation against 730d Binance data"
            className="font-mono text-[8px] text-blue-500 hover:text-blue-300 disabled:opacity-40 border border-blue-900 px-1.5 py-px rounded"
          >
            {wfStatus?.running ? 'WF…' : 'Run WF'}
          </button>
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

          {/* Walk-forward OOS section */}
          {wfStatus && (
            <div
              style={{ border: `1px solid ${BORDER}`, borderRadius: 4 }}
              className="mb-3 px-2 py-1.5"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[8px] uppercase tracking-widest text-zinc-500">
                  Walk-Forward OOS · 730d Binance
                </span>
                {wfStatus.running && (
                  <span className="font-mono text-[7px] text-blue-400 animate-pulse">corriendo…</span>
                )}
                {wfStatus.cache && !wfStatus.running && (
                  <span className="font-mono text-[7px] text-zinc-700">
                    {ago(wfStatus.cache.completedAt)} · {Math.round(wfStatus.cache.durationMs / 1000)}s
                  </span>
                )}
              </div>
              {wfStatus.summary ? (
                <div className="flex flex-wrap gap-3">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[7px] text-zinc-600">SHORT</span>
                    <span className="font-mono text-[9px]" style={{ color: wfStatus.summary.robustShort ? '#22c55e' : '#ef4444' }}>
                      {wfStatus.summary.robustShort ? '✓' : '✗'}
                      {' '}{wfStatus.summary.shortPositiveWindows}/{wfStatus.summary.shortJudgedWindows}w
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[7px] text-zinc-600">COMB</span>
                    <span className="font-mono text-[9px]" style={{ color: wfStatus.summary.robustCombined ? '#22c55e' : '#ef4444' }}>
                      {wfStatus.summary.robustCombined ? '✓' : '✗'}
                      {' '}{wfStatus.summary.combinedPositiveWindows}/{wfStatus.summary.combinedJudgedWindows}w
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[7px] text-zinc-600">EDGE</span>
                    <span className="font-mono text-[9px]" style={{ color: (wfStatus.summary.robustShort || wfStatus.summary.robustCombined) ? '#22c55e' : '#ef4444' }}>
                      {(wfStatus.summary.robustShort || wfStatus.summary.robustCombined) ? 'VALIDADO' : 'NO ROBUSTO'}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="font-mono text-[8px] text-amber-500">
                  {wfStatus.running ? 'Analizando 730d de datos Binance…' : 'Sin resultados — pulsa "Run WF" para analizar edge real'}
                </div>
              )}
            </div>
          )}

          {/* Blockers */}
          <BlockerList blockers={report.blockers} />

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
