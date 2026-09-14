import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CircleDollarSign,
  LockKeyhole,
  Radar,
  Route,
  ShieldCheck,
  Timer,
  WifiOff,
} from 'lucide-react';

type EvidenceStatus = 'OBSERVING' | 'QUALIFIED' | 'FILTERED' | 'BLOCKED';

interface SolanaEconomics {
  grossProfitBeforeDexFeesUsd: number | null;
  grossEdgeBps: number | null;
  dexFeesUsd: number | null;
  dexFeesEmbeddedInQuotedOutput: boolean;
  dexFeeFullyNormalized: boolean;
  quotedRoundTripProfitUsd: number | null;
  quotedRoundTripEdgeBps: number | null;
  slippageReserveBps: number | null;
  slippageReserveUsd: number | null;
  baseFeeUsd: number | null;
  priorityFeeUsd: number | null;
  jitoTipUsd: number | null;
  failedAttemptReserveUsd: number | null;
  netPnlUsd: number | null;
  netEdgeBps: number | null;
  criticalCostsKnown: boolean;
}

interface SolanaObservation {
  chain: 'SOLANA';
  mode: 'SHADOW';
  executionAuthority: false;
  liveLocked: true;
  observedAt: string;
  route: string;
  inputUsdc: number;
  quotedEndUsdc: number;
  solOut: number;
  impliedSolUsd: number;
  contextSlots: {
    first: number | null;
    second: number | null;
  };
  slotDrift: number | null;
  quoteLatencyMs: number | null;
  venues: {
    firstLeg: string[];
    secondLeg: string[];
  };
  economics: SolanaEconomics;
  feeEvidence: {
    priority?: {
      source?: string;
      microLamportsPerCu?: number | null;
      computeUnitLimit?: number | null;
      priorityFeeLamports?: number | null;
    } | null;
    jito?: {
      source?: string;
      tipSol?: number | null;
      tipLamports?: number | null;
      observedAt?: string | null;
    } | null;
  };
  atomicSimulation: {
    attempted: boolean;
    success: boolean;
  };
  captureEvidence: {
    measured: boolean;
  };
  blockers: string[];
  status: string;
}

interface SolanaRadarSnapshot {
  ok: boolean;
  status: string;
  mode: 'SHADOW';
  executionAuthority: false;
  liveLocked: true;
  observation: SolanaObservation | null;
  evidenceErrors?: {
    priorityFee?: string | null;
    jitoTip?: string | null;
  } | null;
}

interface RadarResponse {
  ok: boolean;
  status: string;
  radar: SolanaRadarSnapshot | null;
  executionAuthority?: false;
  liveLocked?: true;
  mode?: 'SHADOW';
  chain?: 'SOLANA';
  error?: string;
}

function money(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value);
  const decimals = Math.abs(n) < 1 ? 4 : 2;
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(decimals)}`;
}

function bps(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '—';
  const n = Number(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)} bps`;
}

function usd(value: number | null | undefined) {
  if (!Number.isFinite(value)) return '—';
  return `$${Number(value).toFixed(Math.abs(Number(value)) < 1 ? 4 : 2)}`;
}

function compactNumber(value: number | null | undefined, decimals = 2) {
  if (!Number.isFinite(value)) return '—';
  return Number(value).toFixed(decimals);
}

function ageLabel(value: string | null | undefined) {
  if (!value) return '—';
  const ageMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0) return 'just now';
  const seconds = Math.floor(ageMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function normalizeStatus(value: string | null | undefined): EvidenceStatus {
  const normalized = String(value ?? '').toUpperCase();
  if (normalized === 'OBSERVING' || normalized === 'QUALIFIED' || normalized === 'FILTERED' || normalized === 'BLOCKED') {
    return normalized;
  }
  return 'BLOCKED';
}

function blockerLabel(value: string) {
  const labels: Record<string, string> = {
    net_not_positive: 'net edge is not positive',
    atomic_simulation_missing: 'atomic simulation pending',
    capture_evidence_missing: 'capture evidence pending',
    dex_fee_normalization_missing: 'DEX fee normalization pending',
    quote_stale: 'quote is stale',
    liquidity_unproven: 'liquidity not proven',
    viable_size_unproven: 'viable size not proven',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

function statusClasses(status: EvidenceStatus) {
  if (status === 'QUALIFIED') return 'border-[#14F19566] bg-[#14F19512] text-[#14F195]';
  if (status === 'OBSERVING') return 'border-[#00C2FF55] bg-[#00C2FF10] text-[#73ddff]';
  if (status === 'FILTERED') return 'border-zinc-700 bg-zinc-900/70 text-zinc-400';
  return 'border-red-500/35 bg-red-500/10 text-red-300';
}

function Metric({
  label,
  value,
  hint,
  accent = false,
  danger = false,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
  danger?: boolean;
}) {
  const valueClass = danger ? 'text-red-300' : accent ? 'text-[#14F195]' : 'text-zinc-100';
  return (
    <div className="min-w-0 rounded-xl border border-white/7 bg-[#111827]/80 px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]">
      <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className={`mt-1 font-mono text-base font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-[10px] text-zinc-600 truncate">{hint}</div> : null}
    </div>
  );
}

function CostRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/5 py-2 last:border-b-0">
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.13em] text-zinc-400">{label}</div>
        {note ? <div className="mt-0.5 text-[10px] text-zinc-600 truncate">{note}</div> : null}
      </div>
      <div className="shrink-0 font-mono text-[11px] tabular-nums text-zinc-200">{value}</div>
    </div>
  );
}

export function ArbitrageRadarPanel({ compact = false }: { compact?: boolean }) {
  const [snapshot, setSnapshot] = useState<SolanaRadarSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'offline' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const response = await fetch('/api/genesis/context?view=solana-arbitrage-radar', { cache: 'no-store' });
        if (!alive) return;
        if (!response.ok) {
          setState(response.status === 404 ? 'offline' : 'error');
          setSnapshot(null);
          return;
        }

        const body = await response.json() as RadarResponse;
        if (!alive) return;
        const next = body.radar;
        const safe = next?.mode === 'SHADOW'
          && next?.executionAuthority === false
          && next?.liveLocked === true
          && (!next.observation || next.observation.chain === 'SOLANA');

        if (!next || !safe) {
          setSnapshot(null);
          setState('error');
          return;
        }

        setSnapshot(next);
        setState('ready');
      } catch {
        if (alive) {
          setState('offline');
          setSnapshot(null);
        }
      } finally {
        if (alive) timer = setTimeout(tick, 30_000);
      }
    };

    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const observation = snapshot?.observation ?? null;
  const economics = observation?.economics ?? null;
  const status = normalizeStatus(observation?.status ?? snapshot?.status);
  const firstLeg = observation?.venues.firstLeg ?? [];
  const secondLeg = observation?.venues.secondLeg ?? [];
  const blockers = useMemo(() => observation?.blockers ?? [], [observation?.blockers]);

  const routeText = observation
    ? `${firstLeg.length ? firstLeg.join(' + ') : 'Jupiter'} → ${secondLeg.length ? secondLeg.join(' + ') : 'Jupiter'}`
    : 'Waiting for Solana route evidence';

  const grossEdgeHint = economics?.dexFeeFullyNormalized
    ? 'before slippage and network costs'
    : economics?.dexFeesEmbeddedInQuotedOutput
      ? 'DEX fees embedded in Jupiter quote'
      : 'awaiting fee normalization';

  return (
    <section
      className="overflow-hidden rounded-2xl border border-[#14F1952e] bg-[#0B1020] shadow-[0_18px_70px_rgba(0,0,0,0.28)]"
      aria-label="Solana Arbitrage Radar"
    >
      <header className="relative overflow-hidden border-b border-white/7 bg-[#0f172a] px-4 py-4 sm:px-5">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(20,241,149,0.09),transparent_36%),radial-gradient(circle_at_top_right,rgba(153,69,255,0.12),transparent_34%)]" />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#14F19555] bg-[#14F19510] text-[#14F195] shadow-[0_0_30px_rgba(20,241,149,0.08)]">
              <Radar size={19} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-[#14F195]">Arbitrage Radar · Solana</div>
                <span className="rounded border border-[#9945FF55] bg-[#9945FF12] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[#c4a5ff]">Jupiter</span>
              </div>
              <div className="mt-1 text-[11px] text-zinc-500">USDC → SOL → USDC · evidence only · paper/shadow</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2 py-1 font-mono text-[9px] uppercase tracking-wider ${statusClasses(status)}`}>
              {status === 'OBSERVING' ? <Activity size={10} className="mr-1 inline animate-pulse" /> : null}
              {status}
            </span>
            <span className="rounded-md border border-amber-500/35 bg-amber-500/8 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-amber-300">SHADOW</span>
            <span className="rounded-md border border-red-500/30 bg-red-500/8 px-2 py-1 font-mono text-[9px] uppercase tracking-wider text-red-300">
              <LockKeyhole size={10} className="mr-1 inline" />LIVE LOCKED
            </span>
          </div>
        </div>
      </header>

      {state === 'offline' ? (
        <div className="flex items-center gap-2 px-5 py-8 font-mono text-[12px] text-zinc-400"><WifiOff size={14} />Solana evidence feed offline</div>
      ) : state === 'error' ? (
        <div className="px-5 py-8 font-mono text-[12px] text-red-300">Solana evidence failed validation. No economic data displayed.</div>
      ) : state === 'loading' ? (
        <div className="px-5 py-8 font-mono text-[12px] text-zinc-500">Synchronizing Solana evidence…</div>
      ) : !observation || !economics ? (
        <div className="px-5 py-8 font-mono text-[12px] text-zinc-500">Waiting for the next Jupiter observation.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-6 sm:p-4">
            <Metric label="Notional" value={`${compactNumber(observation.inputUsdc, 2)} USDC`} hint={`quoted end ${compactNumber(observation.quotedEndUsdc, 6)}`} />
            <Metric label="Quoted edge" value={bps(economics.quotedRoundTripEdgeBps)} hint="Jupiter round trip" accent={(economics.quotedRoundTripEdgeBps ?? 0) > 0} />
            <Metric label="Gross edge" value={bps(economics.grossEdgeBps)} hint={grossEdgeHint} />
            <Metric label="Net edge" value={bps(economics.netEdgeBps)} hint="after measured reserves" accent={(economics.netEdgeBps ?? 0) > 0} danger={(economics.netEdgeBps ?? 0) < 0} />
            <Metric label="Net opportunity" value={money(economics.netPnlUsd)} hint="not realized account P&L" accent={(economics.netPnlUsd ?? 0) > 0} danger={(economics.netPnlUsd ?? 0) < 0} />
            <Metric label="Quote latency" value={Number.isFinite(observation.quoteLatencyMs) ? `${observation.quoteLatencyMs} ms` : '—'} hint={ageLabel(observation.observedAt)} />
          </div>

          <div className="grid gap-3 border-t border-white/7 p-3 sm:p-4 lg:grid-cols-[1.25fr_1fr]">
            <div className="rounded-xl border border-white/7 bg-[#111827]/65 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#00C2FF]">
                    <Route size={13} />Observed route
                  </div>
                  <div className="mt-1 text-[11px] text-zinc-600">Real venues returned by Jupiter for the latest quote</div>
                </div>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-zinc-500">slot {observation.contextSlots.second ?? '—'}</span>
              </div>

              <div className="rounded-lg border border-[#9945FF2e] bg-[#9945FF0a] px-3 py-3">
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">USDC → SOL</div>
                    <div className="mt-1 truncate text-sm font-semibold text-zinc-100">{firstLeg.length ? firstLeg.join(' · ') : '—'}</div>
                  </div>
                  <div className="text-[#9945FF]">→</div>
                  <div className="min-w-0 text-right">
                    <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">SOL → USDC</div>
                    <div className="mt-1 truncate text-sm font-semibold text-zinc-100">{secondLeg.length ? secondLeg.join(' · ') : '—'}</div>
                  </div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="SOL out" value={compactNumber(observation.solOut, 6)} />
                <Metric label="SOL implied" value={usd(observation.impliedSolUsd)} />
                <Metric label="Slot drift" value={compactNumber(observation.slotDrift, 0)} />
                <Metric label="Freshness" value={ageLabel(observation.observedAt)} />
              </div>
            </div>

            <div className="rounded-xl border border-white/7 bg-[#111827]/65 p-4">
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#14F195]">
                <CircleDollarSign size={13} />Cost reconciliation
              </div>
              <CostRow
                label="DEX / swap fees"
                value={Number.isFinite(economics.dexFeesUsd) ? money(-(economics.dexFeesUsd ?? 0)) : economics.dexFeesEmbeddedInQuotedOutput ? 'embedded' : '—'}
                note={economics.dexFeeFullyNormalized ? 'normalized separately' : 'preserved in quoted output'}
              />
              <CostRow label="Slippage reserve" value={money(-(economics.slippageReserveUsd ?? 0))} note={`${compactNumber(economics.slippageReserveBps, 1)} bps reserve`} />
              <CostRow label="Base fee" value={money(-(economics.baseFeeUsd ?? 0))} />
              <CostRow label="Priority fee" value={money(-(economics.priorityFeeUsd ?? 0))} note={observation.feeEvidence.priority?.source ?? 'unavailable'} />
              <CostRow label="Jito tip" value={money(-(economics.jitoTipUsd ?? 0))} note={observation.feeEvidence.jito?.source ?? 'unavailable'} />
              <CostRow label="Failed-attempt reserve" value={money(-(economics.failedAttemptReserveUsd ?? 0))} />
              <div className="mt-2 flex items-center justify-between border-t border-[#14F19522] pt-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-400">Net after costs</span>
                <span className={`font-mono text-sm font-semibold tabular-nums ${(economics.netPnlUsd ?? 0) > 0 ? 'text-[#14F195]' : 'text-red-300'}`}>{money(economics.netPnlUsd)}</span>
              </div>
            </div>
          </div>

          {!compact && (
            <div className="grid gap-3 border-t border-white/7 p-3 sm:p-4 md:grid-cols-2">
              <div className="rounded-xl border border-white/7 bg-[#111827]/55 p-4">
                <div className="mb-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#00C2FF]">
                  <ShieldCheck size={13} />Evidence gates
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Metric label="Atomic simulation" value={observation.atomicSimulation.success ? 'PASSED' : 'PENDING'} hint={observation.atomicSimulation.attempted ? 'attempted' : 'not attempted'} accent={observation.atomicSimulation.success} />
                  <Metric label="Capture evidence" value={observation.captureEvidence.measured ? 'MEASURED' : 'PENDING'} hint="realistic inclusion/capture" accent={observation.captureEvidence.measured} />
                  <Metric label="Liquidity" value="—" hint="not yet proven" />
                  <Metric label="Viable size" value="—" hint="not yet proven" />
                </div>
              </div>

              <div className="rounded-xl border border-white/7 bg-[#111827]/55 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                    <Timer size={13} />Decision blockers
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">{blockers.length} active</span>
                </div>
                {blockers.length === 0 ? (
                  <div className="rounded-lg border border-[#14F19522] bg-[#14F19508] px-3 py-3 text-[11px] text-[#8efbc9]">No blockers reported by the latest observation.</div>
                ) : (
                  <div className="space-y-2">
                    {blockers.map((blocker) => (
                      <div key={blocker} className="flex items-start gap-2 rounded-lg border border-white/6 bg-black/10 px-3 py-2 text-[11px] text-zinc-400">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                        <span>{blockerLabel(blocker)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <footer className="flex flex-col gap-1 border-t border-white/7 px-4 py-3 font-mono text-[9px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
            <span>Route: {routeText}</span>
            <span>Execution authority disabled · no wallet · no signing · no broadcast</span>
          </footer>
        </>
      )}
    </section>
  );
}

export default ArbitrageRadarPanel;
