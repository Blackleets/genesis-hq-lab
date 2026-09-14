import { useEffect, useMemo, useState } from 'react';
import { Activity, ChevronDown, LockKeyhole, WifiOff } from 'lucide-react';

interface ArbitrageEvent {
  id: string;
  recordedAt: string;
  observedAt: string;
  type: 'ARBITRAGE_OBSERVATION';
  chain: 'SOLANA';
  mode: 'SHADOW';
  executionAuthority: false;
  liveLocked: true;
  route: string;
  inputUsdc: number | null;
  quotedEdgeBps: number | null;
  netEdgeBps: number | null;
  netPnlUsd: number | null;
  decision: 'QUALIFIED' | 'REJECTED';
  reason: string | null;
  blockers: string[];
  quoteLatencyMs: number | null;
  slot: number | null;
}

interface RadarResponse {
  ok: boolean;
  events?: ArbitrageEvent[];
  executionAuthority?: false;
  liveLocked?: true;
  mode?: 'SHADOW';
  chain?: 'SOLANA';
}

function bps(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)} bps`;
}

function money(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value);
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(Math.abs(n) < 1 ? 4 : 2)}`;
}

function ageLabel(value: string | null | undefined) {
  if (!value) return '—';
  const ageMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'now';
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function reasonLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    net_not_positive: 'net edge <= 0',
    atomic_simulation_missing: 'atomic simulation pending',
    capture_evidence_missing: 'capture evidence pending',
    dex_fee_normalization_missing: 'DEX fee normalization pending',
  };
  if (!value) return '—';
  return labels[value] ?? value.replaceAll('_', ' ');
}

export function ArbitrageRadarPanel() {
  const [events, setEvents] = useState<ArbitrageEvent[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const response = await fetch('/api/genesis/context?view=solana-arbitrage-radar', { cache: 'no-store' });
        if (!response.ok) throw new Error('feed unavailable');
        const body = await response.json() as RadarResponse;
        if (!alive) return;
        const safe = body.mode === 'SHADOW'
          && body.executionAuthority === false
          && body.liveLocked === true
          && body.chain === 'SOLANA';
        if (!safe) throw new Error('safety contract');
        setEvents(Array.isArray(body.events) ? body.events : []);
        setState('ready');
      } catch {
        if (alive) setState('offline');
      } finally {
        if (alive) timer = setTimeout(tick, 15_000);
      }
    };
    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const latest = events[0] ?? null;
  const stats = useMemo(() => {
    const qualified = events.filter((event) => event.decision === 'QUALIFIED').length;
    const rejected = events.filter((event) => event.decision === 'REJECTED').length;
    return { total: events.length, qualified, rejected };
  }, [events]);

  return (
    <section className="overflow-hidden rounded-xl border border-white/8 bg-[#090f18]" aria-label="Solana arbitrage event log">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#14F195]">
            <Activity size={13} className="animate-pulse" /> SOLANA EVENT LOG
          </div>
          <div className="mt-1 text-[11px] text-zinc-500">Registro cronológico de lo que observa y decide Genesis.</div>
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-wider">
          <span className="text-zinc-500">{stats.total} events</span>
          <span className="text-[#14F195]">{stats.qualified} qualified</span>
          <span className="text-zinc-500">{stats.rejected} rejected</span>
          <span className="rounded border border-red-500/30 px-2 py-1 text-red-300"><LockKeyhole size={10} className="mr-1 inline" />LIVE LOCKED</span>
        </div>
      </header>

      {state === 'offline' ? (
        <div className="flex items-center gap-2 px-4 py-8 font-mono text-[11px] text-zinc-500"><WifiOff size={13} />Event feed unavailable</div>
      ) : state === 'loading' ? (
        <div className="px-4 py-8 font-mono text-[11px] text-zinc-500">Loading events…</div>
      ) : events.length === 0 ? (
        <div className="px-4 py-8 font-mono text-[11px] text-zinc-500">Waiting for the first recorded arbitrage event…</div>
      ) : (
        <>
          <div className="grid grid-cols-[76px_minmax(0,1fr)_92px_92px] gap-2 border-b border-white/8 bg-white/[0.02] px-3 py-2 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
            <span>Time</span><span>Event</span><span className="text-right">Net edge</span><span className="text-right">Decision</span>
          </div>

          <div className="max-h-[68vh] overflow-y-auto">
            {events.map((event) => {
              const open = openId === event.id;
              const positive = (event.netEdgeBps ?? 0) > 0;
              return (
                <div key={event.id} className="border-b border-white/5 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : event.id)}
                    className="grid w-full grid-cols-[76px_minmax(0,1fr)_92px_92px] items-center gap-2 px-3 py-3 text-left hover:bg-white/[0.025]"
                  >
                    <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                      {new Date(event.observedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-center gap-2">
                        <ChevronDown size={11} className={`shrink-0 text-zinc-600 transition-transform ${open ? 'rotate-180' : ''}`} />
                        <span className="truncate text-[11px] font-medium text-zinc-200">{event.route}</span>
                      </span>
                      <span className="ml-[19px] mt-0.5 block truncate font-mono text-[8px] uppercase tracking-wider text-zinc-600">
                        observed · {money(event.netPnlUsd)} shadow · {ageLabel(event.observedAt)} ago
                      </span>
                    </span>
                    <span className={`text-right font-mono text-[10px] tabular-nums ${positive ? 'text-[#14F195]' : 'text-zinc-400'}`}>
                      {bps(event.netEdgeBps)}
                    </span>
                    <span className={`justify-self-end rounded border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider ${event.decision === 'QUALIFIED' ? 'border-[#14F19555] text-[#14F195]' : 'border-zinc-700 text-zinc-400'}`}>
                      {event.decision}
                    </span>
                  </button>

                  {open ? (
                    <div className="grid gap-2 bg-black/15 px-4 py-3 sm:grid-cols-4">
                      <div><div className="font-mono text-[8px] uppercase tracking-wider text-zinc-600">Notional</div><div className="mt-1 font-mono text-[10px] text-zinc-300">{event.inputUsdc ?? '—'} USDC</div></div>
                      <div><div className="font-mono text-[8px] uppercase tracking-wider text-zinc-600">Quoted edge</div><div className="mt-1 font-mono text-[10px] text-zinc-300">{bps(event.quotedEdgeBps)}</div></div>
                      <div><div className="font-mono text-[8px] uppercase tracking-wider text-zinc-600">Latency / slot</div><div className="mt-1 font-mono text-[10px] text-zinc-300">{event.quoteLatencyMs ?? '—'} ms · {event.slot ?? '—'}</div></div>
                      <div><div className="font-mono text-[8px] uppercase tracking-wider text-zinc-600">Reason</div><div className="mt-1 font-mono text-[10px] text-zinc-300">{reasonLabel(event.reason)}</div></div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/8 px-4 py-2 font-mono text-[8px] uppercase tracking-wider text-zinc-600">
            <span>Latest event: {latest ? ageLabel(latest.observedAt) + ' ago' : '—'}</span>
            <span>SHADOW · executionAuthority=false · no signing · no broadcast</span>
          </footer>
        </>
      )}
    </section>
  );
}

export default ArbitrageRadarPanel;
