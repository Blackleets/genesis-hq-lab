import { useEffect, useMemo, useState } from 'react';
import { Activity, Radar, ShieldCheck, WifiOff } from 'lucide-react';

interface RadarRoute {
  route: string;
  expectedNetPnlUsd: number | null;
  stressNetPnlUsd: number | null;
  netEdgeBps: number | null;
  status: 'qualified' | 'filtered';
  blockers: string[];
  capturedAt: string | null;
}

interface RadarSnapshot {
  mode: 'SHADOW';
  executionAuthority: false;
  status: string;
  providerConfigured: boolean;
  chainId: number | null;
  blockNumber: string | null;
  routesScanned: number;
  routesQuoted: number;
  evaluated: number;
  qualified: number;
  filtered: number;
  theoreticalExpectedNetPnlUsd: number | null;
  theoreticalStressNetPnlUsd: number | null;
  medianNetEdgeBps: number | null;
  topRoutes: RadarRoute[];
  error: string | null;
  updatedAt: string | null;
  stateUpdatedAt?: string | null;
}

interface RadarResponse {
  ok: boolean;
  status: string;
  message?: string;
  radar: RadarSnapshot | null;
}

function money(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value);
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function bps(value: number | null | undefined) {
  return Number.isFinite(value) ? `${Number(value).toFixed(1)} bps` : '—';
}

function blockerLabel(value: string | undefined) {
  const labels: Record<string, string> = {
    atomic: 'awaiting atomic simulation',
    simulationSuccess: 'simulation incomplete',
    knownCosts: 'cost model incomplete',
    quoteFresh: 'quote expired',
    blockFresh: 'block drift',
    netPositive: 'costs consume spread',
    minNetEdge: 'edge below reserve',
    minNetPnl: 'profit below floor',
    stressPositive: 'fails stress test',
    inclusionProbability: 'inclusion confidence low',
    expectedNetPositive: 'expected value too small',
    noProhibitedTactic: 'policy blocked',
  };
  return value ? (labels[value] ?? value.replaceAll('_', ' ')) : 'filtered by evidence';
}

function Metric({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 border-r border-zinc-800 last:border-r-0 px-3 py-2">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-600">{label}</div>
      <div className={`font-mono text-lg font-semibold mt-0.5 tabular-nums ${accent ? 'text-[#00ff9c]' : 'text-zinc-100'}`}>{value}</div>
    </div>
  );
}

export function ArbitrageRadarPanel({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<RadarSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'provider' | 'offline' | 'error'>('loading');
  const [lastSync, setLastSync] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const response = await fetch('/api/mev/radar', { cache: 'no-store' });
        if (!alive) return;
        if (!response.ok) {
          setState(response.status === 404 ? 'offline' : 'error');
          setSnapshot(null);
          return;
        }
        const body = await response.json() as RadarResponse;
        if (!alive) return;
        if (body.status === 'provider_not_configured') {
          setState('provider');
          setSnapshot(null);
        } else {
          setSnapshot(body.radar ?? null);
          setState('ready');
          setLastSync(new Date().toISOString());
        }
      } catch {
        if (alive) {
          setState('offline');
          setSnapshot(null);
        }
      } finally {
        if (alive) timer = setTimeout(tick, 8_000);
      }
    };

    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const routes = useMemo(() => snapshot?.topRoutes ?? [], [snapshot?.topRoutes]);
  const observing = snapshot?.status === 'observing';
  const statusText = state === 'ready'
    ? (observing ? 'OBSERVING' : String(snapshot?.status ?? 'IDLE').replaceAll('_', ' ').toUpperCase())
    : state.toUpperCase();

  return (
    <section className="border border-[#00ff9c33] bg-[#0a0c12] overflow-hidden" aria-label="Arbitrage Radar">
      <header className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800 bg-[#10131a]">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 border border-[#00ff9c44] bg-[#00ff9c0a] grid place-items-center text-[#00ff9c]">
            <Radar size={16} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#00ff9c]">Arbitrage Radar</div>
            <div className="font-mono text-[10px] text-zinc-500 truncate">On-chain intelligence · same-block quotes · shadow only</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`font-mono text-[9px] uppercase tracking-wider px-2 py-1 border ${state === 'ready' && observing ? 'border-[#00ff9c55] text-[#00ff9c] bg-[#00ff9c0a]' : 'border-zinc-700 text-zinc-400'}`}>
            {state === 'ready' && observing ? <Activity size={10} className="inline mr-1 animate-pulse" /> : null}{statusText}
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider px-2 py-1 border border-amber-500/40 text-amber-300">SHADOW</span>
        </div>
      </header>

      {state === 'provider' ? (
        <div className="px-4 py-6 font-mono text-[12px] text-zinc-400">Provider not configured</div>
      ) : state === 'offline' ? (
        <div className="px-4 py-6 flex items-center gap-2 font-mono text-[12px] text-zinc-400"><WifiOff size={14} />Backend offline — npm run start</div>
      ) : state === 'error' ? (
        <div className="px-4 py-6 font-mono text-[12px] text-amber-300">Radar data temporarily unavailable</div>
      ) : state === 'loading' ? (
        <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">Synchronizing evidence…</div>
      ) : !snapshot ? (
        <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">Waiting for first on-chain observation.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 border-b border-zinc-800">
            <Metric label="Routes" value={String(snapshot.routesScanned)} />
            <Metric label="Quoted" value={String(snapshot.routesQuoted)} />
            <Metric label="Qualified" value={String(snapshot.qualified)} accent={snapshot.qualified > 0} />
            <Metric label="Expected" value={money(snapshot.theoreticalExpectedNetPnlUsd)} accent={(snapshot.theoreticalExpectedNetPnlUsd ?? 0) > 0} />
            <Metric label="Stress" value={money(snapshot.theoreticalStressNetPnlUsd)} accent={(snapshot.theoreticalStressNetPnlUsd ?? 0) > 0} />
          </div>

          <div className="px-4 py-2 flex flex-wrap gap-x-5 gap-y-1 border-b border-zinc-800 font-mono text-[10px] text-zinc-500">
            <span>ETHEREUM {snapshot.blockNumber ? `#${snapshot.blockNumber}` : '—'}</span>
            <span>MEDIAN EDGE {bps(snapshot.medianNetEdgeBps)}</span>
            <span>FILTERED {snapshot.filtered}</span>
            <span className="flex items-center gap-1 text-zinc-400"><ShieldCheck size={11} /> execution authority disabled</span>
          </div>

          {!compact && (
            <div className="max-h-64 overflow-y-auto">
              {routes.length === 0 ? (
                <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">No route observations in the latest snapshot.</div>
              ) : routes.map((route, index) => (
                <div key={`${route.route}:${route.capturedAt ?? index}`} className="grid grid-cols-[minmax(0,1fr)_84px_84px_90px] gap-2 items-center px-4 py-2 border-b border-zinc-800/70 last:border-b-0 font-mono text-[10px]">
                  <div className="min-w-0">
                    <div className="text-zinc-200 truncate">{route.route}</div>
                    <div className="text-zinc-600 truncate">{route.status === 'qualified' ? 'qualified by evidence' : blockerLabel(route.blockers[0])}</div>
                  </div>
                  <div className="text-right tabular-nums text-zinc-400">{bps(route.netEdgeBps)}</div>
                  <div className={`text-right tabular-nums ${(route.expectedNetPnlUsd ?? 0) > 0 ? 'text-emerald-300' : 'text-zinc-500'}`}>{money(route.expectedNetPnlUsd)}</div>
                  <div className={`text-right uppercase tracking-wider ${route.status === 'qualified' ? 'text-[#00ff9c]' : 'text-zinc-500'}`}>{route.status === 'qualified' ? 'QUALIFIED' : 'FILTERED'}</div>
                </div>
              ))}
            </div>
          )}

          <footer className="px-4 py-2 border-t border-zinc-800 font-mono text-[9px] text-zinc-600 flex items-center justify-between gap-3">
            <span>Opportunity economics only · not realized account P&amp;L</span>
            <span>{snapshot.stateUpdatedAt || snapshot.updatedAt || lastSync ? new Date(snapshot.stateUpdatedAt ?? snapshot.updatedAt ?? lastSync!).toLocaleTimeString() : '—'}</span>
          </footer>
        </>
      )}
    </section>
  );
}

export default ArbitrageRadarPanel;
