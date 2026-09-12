import { useEffect, useMemo, useState } from 'react';
import { Activity, Check, CircleAlert, LockKeyhole, RefreshCw, ShieldCheck, Wifi, X } from 'lucide-react';
import GenesisWorker from '@animations/GenesisWorker';
import { GENESIS_TOKENS, eyeShapeForAnim, type WorkerAnim, type WorkerPalette } from '@animations/genesisWorkerDesign';
import type { VisualProfile } from '@core/types/genesis';
import { canReviewCutover, fetchFounderSnapshot, type FounderAgent, type FounderSnapshot } from '@services/founderClient';

const surface = 'border border-[#242b3a] bg-[#0d1119] shadow-[0_14px_45px_rgba(0,0,0,.22)]';
const money = (n: number | null | undefined) => n == null ? 'NOT SET' : `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const AGENT_PALETTES: Record<string, WorkerPalette> = {
  HERMES: { primary: GENESIS_TOKENS.blue, accent: GENESIS_TOKENS.cyan, glow: GENESIS_TOKENS.blue },
  ATLAS: { primary: GENESIS_TOKENS.amber, accent: GENESIS_TOKENS.blue, glow: GENESIS_TOKENS.amber },
  ORACLE: { primary: GENESIS_TOKENS.purple, accent: GENESIS_TOKENS.cyan, glow: GENESIS_TOKENS.purple },
  SENTINEL: { primary: GENESIS_TOKENS.red, accent: GENESIS_TOKENS.amber, glow: GENESIS_TOKENS.red },
  FORGE: { primary: GENESIS_TOKENS.green, accent: GENESIS_TOKENS.cyan, glow: GENESIS_TOKENS.green },
  AUDITOR: { primary: GENESIS_TOKENS.deepBlue, accent: GENESIS_TOKENS.cyan, glow: GENESIS_TOKENS.cyan },
  EXECUTION: { primary: GENESIS_TOKENS.gray, accent: GENESIS_TOKENS.red, glow: GENESIS_TOKENS.gray },
};

function animForAgent(agent: FounderAgent): WorkerAnim {
  if (agent.status === 'blocking' || agent.status === 'locked') return 'blocked';
  if (agent.status === 'evaluated' || agent.status === 'online') return 'working';
  if (agent.currentTask) return 'thinking';
  return 'idle';
}

function accessoryForAgent(id: string): VisualProfile['accessory'] {
  if (id === 'SENTINEL' || id === 'EXECUTION') return 'shield';
  if (id === 'AUDITOR') return 'clipboard';
  if (id === 'ATLAS' || id === 'ORACLE') return 'book';
  return 'none';
}

function StatusPill({ value, stale = false }: { value: string; stale?: boolean }) {
  const normalized = stale ? 'stale' : value.toLowerCase();
  const good = ['online', 'verified', 'evaluated', 'ready_for_external_cutover'].includes(normalized);
  const bad = ['blocked', 'blocking', 'locked', 'live_locked', 'missing_credentials', 'stale'].includes(normalized);
  return (
    <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[9px] font-mono uppercase tracking-[0.12em] ${good
      ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-300'
      : bad
        ? 'border-red-400/30 bg-red-400/5 text-red-300'
        : 'border-amber-400/30 bg-amber-400/5 text-amber-300'}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {stale ? 'EVIDENCE STALE' : value.replaceAll('_', ' ')}
    </span>
  );
}

function AgentCard({ agent, stale }: { agent: FounderAgent; stale: boolean }) {
  const anim = animForAgent(agent);
  const palette = AGENT_PALETTES[agent.id] ?? { primary: GENESIS_TOKENS.violet, accent: GENESIS_TOKENS.cyan, glow: GENESIS_TOKENS.violet };
  const heartbeat = agent.metrics.lastHeartbeat
    ? new Date(agent.metrics.lastHeartbeat).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <article className="group min-w-[218px] snap-start border border-[#242b3a] bg-[#0a0e15] p-3 transition-colors hover:border-cyan-400/25">
      <div className="flex items-start gap-3">
        <div className="relative h-[74px] w-[74px] shrink-0 overflow-hidden border border-[#202736] bg-[#070a0f]">
          <div className="absolute inset-0 opacity-40" style={{ background: `radial-gradient(circle at 50% 45%, ${palette.glow}33 0, transparent 66%)` }} />
          <svg viewBox="0 0 80 80" className="relative h-full w-full" role="img" aria-label={`${agent.name} Genesis worker`}>
            <GenesisWorker palette={palette} anim={anim} eye={eyeShapeForAnim(anim)} accessory={accessoryForAgent(agent.id)} x={12} y={10} size={56} dim={stale} />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-mono text-[12px] font-bold tracking-[0.08em] text-zinc-100">{agent.name}</h3>
            <span className={`h-2 w-2 rounded-full ${agent.status === 'blocking' || agent.status === 'locked' ? 'bg-red-400' : agent.status === 'evaluated' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          </div>
          <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-zinc-500">{agent.role}</p>
          <div className="mt-2"><StatusPill value={agent.status} stale={stale} /></div>
        </div>
      </div>
      <div className="mt-3 border-t border-[#1f2633] pt-3">
        <div className="text-[9px] font-mono uppercase tracking-[0.14em] text-zinc-600">CURRENT TASK</div>
        <p className="mt-1 line-clamp-2 min-h-8 text-[10px] leading-4 text-zinc-300">{agent.currentTask ?? 'Awaiting verified runner heartbeat'}</p>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] font-mono text-zinc-600">
        <span>{agent.desk.toUpperCase()}</span>
        <span>{heartbeat ? `HB ${heartbeat}` : agent.metrics.evaluatedGates != null ? `${agent.metrics.evaluatedGates} GATES` : 'NO HB'}</span>
      </div>
    </article>
  );
}

export function FounderControlRoom() {
  const [snapshot, setSnapshot] = useState<FounderSnapshot | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [review, setReview] = useState(false);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (pending) return;
      pending = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 10_000);
      try {
        const data = await fetchFounderSnapshot(controller.signal);
        if (!disposed) { setSnapshot(data); setError(false); }
      } catch {
        if (!disposed) { setSnapshot(null); setError(true); setReview(false); }
      } finally {
        window.clearTimeout(timeout);
        pending = false;
      }
    };
    void load();
    const poll = window.setInterval(() => void load(), 15_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { disposed = true; controller?.abort(); window.clearInterval(poll); window.clearInterval(clock); };
  }, [refresh]);

  const ready = canReviewCutover(snapshot, now);
  const expired = !!snapshot && (now - Date.parse(snapshot.updatedAt) >= 60_000 || (snapshot.readiness === 'READY_FOR_EXTERNAL_CUTOVER' && !ready));
  const checks = snapshot?.cutover.checks ?? [];
  const passCount = checks.filter(check => check.passed && !expired).length;
  const gatePct = checks.length ? Math.round((passCount / checks.length) * 100) : 0;
  const blockers = snapshot?.blockers ?? [];
  const connectorsOnline = snapshot?.connectors.filter(c => !expired && c.health === 'online').length ?? 0;

  const agentGroups = useMemo(() => snapshot?.agents ?? [], [snapshot]);

  return (
    <section className="space-y-3" aria-label="Founder and agent operating floor">
      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_.85fr] gap-3">
        <div className={`${surface} relative overflow-hidden p-4 md:p-5`}>
          <div className="pointer-events-none absolute inset-0 opacity-50" style={{ background: 'radial-gradient(circle at 15% 0%, rgba(34,211,238,.08), transparent 35%), radial-gradient(circle at 100% 100%, rgba(255,71,87,.06), transparent 34%)' }} />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-cyan-300">
                <ShieldCheck className="h-3.5 w-3.5" /> FOUNDER CONTROL GATE
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">Capital stays locked until evidence clears.</h2>
              <p className="mt-1 max-w-xl text-[11px] leading-5 text-zinc-500">Readiness is measured server-side. This surface can review evidence; it cannot submit an order.</p>
            </div>
            <StatusPill value={ready ? 'READY_FOR_EXTERNAL_CUTOVER' : 'BLOCKED'} stale={expired} />
          </div>

          <div className="relative mt-5 grid grid-cols-[92px_1fr] gap-4 items-center">
            <div className="relative h-[92px] w-[92px] rounded-full p-[7px]" style={{ background: `conic-gradient(${ready ? '#34d399' : '#22d3ee'} ${gatePct}%, #1d2430 ${gatePct}% 100%)` }}>
              <div className="flex h-full w-full flex-col items-center justify-center rounded-full border border-[#242b3a] bg-[#080b11]">
                <div className="font-mono text-xl font-bold text-zinc-100">{checks.length ? `${gatePct}%` : '—'}</div>
                <div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">GATES</div>
              </div>
            </div>
            <div className="min-w-0">
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5" aria-label="Founder readiness checks">
                {checks.length > 0 ? checks.map(check => (
                  <div key={check.id} title={`${check.label}${check.blocker ? ` — ${check.blocker}` : ''}`} className={`h-7 border flex items-center justify-center ${check.passed && !expired ? 'border-emerald-400/25 bg-emerald-400/8 text-emerald-300' : 'border-red-400/25 bg-red-400/5 text-red-300'}`}>
                    {check.passed && !expired ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  </div>
                )) : Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-7 animate-pulse border border-[#202736] bg-[#111722]" />)}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[9px] font-mono text-zinc-500">
                <span className="text-zinc-300">{passCount}/{checks.length || 12} checks passed</span>
                <span>{connectorsOnline}/{snapshot?.connectors.length ?? 0} connectors verified</span>
                <span>{snapshot?.owner.status === 'verified' ? 'owner verified' : 'owner unverified'}</span>
              </div>
            </div>
          </div>

          <div className="relative mt-5 grid grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              ['DAILY LOSS LIMIT', money(snapshot?.risk.maxDailyLoss), snapshot?.risk.maxDailyLoss != null],
              ['ORDER NOTIONAL', money(snapshot?.risk.maxOrderNotional), snapshot?.risk.maxOrderNotional != null],
              ['KILL SWITCH', snapshot?.risk.killSwitchArmed && snapshot.risk.killSwitchTested ? 'ARMED' : 'UNPROVEN', snapshot?.risk.killSwitchArmed && snapshot.risk.killSwitchTested],
              ['FOUNDER PAUSE', snapshot?.risk.founderPaused === false ? 'CLEAR' : 'ACTIVE', snapshot?.risk.founderPaused === false],
            ].map(([label, value, good]) => (
              <div key={String(label)} className="border border-[#202736] bg-[#080b11] px-3 py-3">
                <div className="text-[8px] font-mono uppercase tracking-[0.14em] text-zinc-600">{label}</div>
                <div className={`mt-2 font-mono text-[12px] ${good ? 'text-emerald-300' : 'text-amber-300'}`}>{value}</div>
              </div>
            ))}
          </div>

          {(error || expired || blockers.length > 0) && (
            <div className="relative mt-4 border border-red-400/20 bg-red-400/[.035] p-3">
              <div className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-300" />
                <div className="min-w-0 text-[10px] leading-4 text-red-200/80">
                  {error ? <p>Founder readiness endpoint unavailable. No cached approval is trusted.</p> : null}
                  {expired ? <p>Readiness evidence expired; stale checks are treated as blocked.</p> : null}
                  {!error && blockers.length > 0 ? <p>{blockers.slice(0, 3).join(' · ')}</p> : null}
                </div>
              </div>
            </div>
          )}

          <div className="relative mt-4 flex flex-wrap gap-2">
            <button type="button" disabled={!ready} onClick={() => setReview(true)} className="inline-flex items-center gap-2 border border-amber-400/35 bg-amber-400/5 px-3 py-2 text-[10px] font-mono text-amber-200 disabled:cursor-not-allowed disabled:opacity-35">
              <LockKeyhole className="h-3.5 w-3.5" /> REVIEW EXTERNAL CUTOVER
            </button>
            <button type="button" onClick={() => { setSnapshot(null); setReview(false); setRefresh(n => n + 1); }} className="inline-flex items-center gap-2 border border-[#2b3445] px-3 py-2 text-[10px] font-mono text-zinc-400 hover:text-zinc-200">
              <RefreshCw className="h-3.5 w-3.5" /> REFRESH EVIDENCE
            </button>
          </div>
          {review && ready ? <div className="relative mt-3 text-[10px] leading-4 text-amber-200/80">Review is not execution permission. Venue, account, strategy version and limits still require separate founder confirmation outside this UI.</div> : null}
        </div>

        <div className={`${surface} p-4 md:p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-cyan-300"><Wifi className="h-3.5 w-3.5" /> HERMES CONNECTOR MESH</div>
              <h2 className="mt-2 text-base font-semibold text-zinc-100">Verified links, not configured claims.</h2>
            </div>
            <div className="font-mono text-[10px] text-zinc-500">{connectorsOnline}/{snapshot?.connectors.length ?? 0} ONLINE</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {snapshot?.connectors.map(connector => {
              const good = !expired && connector.health === 'online';
              return (
                <div key={connector.id} className="relative overflow-hidden border border-[#202736] bg-[#080b11] p-3">
                  <div className={`absolute left-0 top-0 h-full w-[2px] ${good ? 'bg-emerald-400' : connector.status === 'locked' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-[10px] font-medium text-zinc-300">{connector.name}</div>
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${good ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  </div>
                  <div className="mt-2 text-[8px] font-mono uppercase tracking-wider text-zinc-600">{good ? 'VERIFIED' : expired ? 'STALE' : connector.status.replaceAll('_', ' ')}</div>
                  <div className="mt-1 truncate text-[9px] text-zinc-500">{connector.mode} · {connector.permissions.length} perms</div>
                </div>
              );
            }) ?? Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[72px] animate-pulse border border-[#202736] bg-[#111722]" />)}
          </div>
        </div>
      </div>

      <div className={`${surface} overflow-hidden`}>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#242b3a] px-4 py-4 md:px-5">
          <div>
            <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.2em] text-cyan-300"><Activity className="h-3.5 w-3.5" /> AGENT OPERATING FLOOR</div>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-zinc-100">The Genesis brain has visible operators.</h2>
            <p className="mt-1 text-[10px] text-zinc-500">Pixel workers represent registered roles only. Activity appears only when the server supplies evidence.</p>
          </div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-600">{agentGroups.length || 0} REGISTERED · LIVE EXECUTION LOCKED</div>
        </div>

        <div className="gx-scroll grid auto-cols-[218px] grid-flow-col gap-2 overflow-x-auto snap-x snap-mandatory p-3 md:grid-flow-row md:auto-cols-auto md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7 md:overflow-visible md:snap-none md:p-4">
          {agentGroups.length > 0
            ? agentGroups.map(agent => <AgentCard key={agent.id} agent={agent} stale={expired} />)
            : Array.from({ length: 7 }).map((_, i) => <div key={i} className="h-[190px] min-w-[218px] animate-pulse border border-[#202736] bg-[#111722]" />)}
        </div>
      </div>
    </section>
  );
}
