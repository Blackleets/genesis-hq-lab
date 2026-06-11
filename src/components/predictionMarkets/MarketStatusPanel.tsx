import { useEffect, useState } from 'react';
import { apiUrl } from '@services/apiBase';

interface ProviderStatus {
  ok: boolean;
  mode: string;
  provider?: string;
  keyConfigured?: boolean;
  wsConnected?: boolean;
  error?: string | null;
  authRequired?: boolean;
}

interface StatusData {
  providers?: {
    polymarket?: ProviderStatus;
    kalshi?: ProviderStatus;
  };
  execution?: {
    paperMode?: { enabled: boolean; status: string };
    liveMode?: { enabled: boolean; status: string; blockedBy?: string | null };
    dailyLoss?: number;
    safetyLimits?: { maxPositionSize: number; maxDailyLoss: number };
  };
  store?: { total: number; fresh: number; stale: number };
}

function ModeBadge({ mode }: { mode: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    'read-only':    { label: 'READ-ONLY',       color: '#00ff9c', bg: 'rgba(0,255,156,0.10)' },
    'degraded':     { label: 'DEGRADED_MODE',   color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
    'paper_only':   { label: 'PAPER_MODE',       color: '#60a5fa', bg: 'rgba(96,165,250,0.10)' },
    'live_ready':   { label: 'LIVE_READY',       color: '#f472b6', bg: 'rgba(244,114,182,0.10)' },
    'fixture':      { label: 'FIXTURE_DATA',     color: '#a78bfa', bg: 'rgba(167,139,250,0.10)' },
    'real':         { label: 'REAL_DATA',        color: '#00ff9c', bg: 'rgba(0,255,156,0.10)' },
    'locked':       { label: 'LIVE_LOCKED',      color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  };
  const style = map[mode] ?? { label: mode.toUpperCase(), color: '#6b7280', bg: 'rgba(107,114,128,0.10)' };
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold tracking-widest"
      style={{ color: style.color, background: style.bg, border: `1px solid ${style.color}33` }}>
      {style.label}
    </span>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className="inline-block w-2 h-2 rounded-full mr-2 shrink-0"
      style={{ background: ok ? '#00ff9c' : '#f59e0b', boxShadow: `0 0 6px ${ok ? '#00ff9c' : '#f59e0b'}88` }} />
  );
}

export function MarketStatusPanel() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(apiUrl('/api/prediction-markets/status'));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStatus(await res.json());
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      }
    };
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/40 bg-red-950/20 p-4">
        <p className="text-xs text-red-400 font-mono">Backend unreachable: {error}</p>
      </div>
    );
  }

  if (!status) {
    return <div className="rounded-lg border border-zinc-800 bg-[#0d1117] p-4 animate-pulse h-32" />;
  }

  const { providers, execution, store } = status;
  const pm = providers?.polymarket;
  const kalshi = providers?.kalshi;

  return (
    <div className="rounded-lg border border-zinc-800 bg-[#0d1117] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Connector Status</h3>
        {store && (
          <span className="text-[10px] text-zinc-600 font-mono">
            {store.fresh} fresh / {store.stale} stale / {store.total} total
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Polymarket */}
        <div className="rounded border border-zinc-800 bg-[#111827] p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <StatusDot ok={pm?.ok ?? false} />
            <span className="text-[11px] font-semibold text-zinc-200">Polymarket</span>
          </div>
          <ModeBadge mode={pm?.mode ?? 'degraded'} />
          <p className="text-[10px] text-zinc-500 font-mono">Gamma API · No auth</p>
          {pm?.error && <p className="text-[10px] text-amber-400 font-mono truncate">{pm.error}</p>}
        </div>

        {/* Kalshi */}
        <div className="rounded border border-zinc-800 bg-[#111827] p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <StatusDot ok={kalshi?.ok ?? false} />
            <span className="text-[11px] font-semibold text-zinc-200">Kalshi</span>
          </div>
          <ModeBadge mode={kalshi?.mode ?? 'degraded'} />
          <p className="text-[10px] text-zinc-500 font-mono">
            Key: {kalshi?.keyConfigured ? '✓ set' : '✗ not set'} · WS: {kalshi?.wsConnected ? '✓' : '✗'}
          </p>
          {kalshi?.error && <p className="text-[10px] text-amber-400 font-mono truncate">{kalshi.error}</p>}
        </div>
      </div>

      {/* Execution status */}
      {execution && (
        <div className="flex items-center gap-3 pt-1">
          <ModeBadge mode="paper_only" />
          <ModeBadge mode={execution.liveMode?.enabled ? 'live_ready' : 'locked'} />
          {execution.dailyLoss != null && (
            <span className="text-[10px] text-zinc-500 font-mono ml-auto">
              Daily P&amp;L used: ${execution.dailyLoss.toFixed(2)} / ${execution.safetyLimits?.maxDailyLoss ?? 25}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
