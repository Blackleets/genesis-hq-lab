// SystemHealthView — granular system health dashboard using the truth layer.
// Polls /api/system/health every 15s for authoritative backend state.

import { useTruthLayer } from '@hooks/useTruthLayer';
import type { TruthIssue } from '@hooks/useTruthLayer';

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`inline-block w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-red-500'}`}
      />
      <span className={`font-mono text-[11px] uppercase tracking-wider ${ok ? 'text-emerald-300' : 'text-red-400'}`}>
        {label}
      </span>
    </span>
  );
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-white/5 last:border-0">
      <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className={`font-mono text-[12px] ${muted ? 'text-zinc-500' : 'text-zinc-200'}`}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="gx-card p-4 space-y-1">
      <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500 mb-3">
        {title}
      </div>
      {children}
    </section>
  );
}

function IssueCard({ issue }: { issue: TruthIssue }) {
  const color = issue.severity === 'warn' ? 'text-amber-400 border-amber-400/30 bg-amber-500/10' : 'text-sky-400 border-sky-400/30 bg-sky-500/10';
  return (
    <div className={`font-mono text-[11px] px-3 py-2 border rounded ${color}`}>
      <span className="uppercase tracking-wider opacity-70 mr-2">[{issue.system}]</span>
      {issue.message}
    </div>
  );
}

function fmtMs(ms: number | null | undefined) {
  if (ms == null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s ago`;
  return `${(ms / 60_000).toFixed(1)}min ago`;
}

export default function SystemHealthView() {
  const { truth, loading, lastFetchedAt } = useTruthLayer();

  if (loading && !truth) {
    return (
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
        <div className="font-mono text-[12px] text-zinc-500 animate-pulse">Loading system health…</div>
      </main>
    );
  }

  if (!truth) {
    return (
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
        <div className="font-mono text-[12px] text-red-400">Backend unreachable — cannot fetch system health.</div>
      </main>
    );
  }

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-3xl mx-auto space-y-5">

        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
              Genesis HQ
            </div>
            <h1 className="font-mono text-2xl text-zinc-100">System Health</h1>
            <p className="font-mono text-[12px] text-zinc-500 mt-1">
              Canonical truth layer — all data from authoritative backend sources
            </p>
          </div>
          <div className="text-right space-y-1">
            <StatusDot ok={truth.ok} label={truth.ok ? 'Operational' : 'Degraded'} />
            <div className="font-mono text-[10px] text-zinc-600">
              {lastFetchedAt ? `Updated ${lastFetchedAt.toLocaleTimeString()}` : 'Fetching…'}
            </div>
            <div className="font-mono text-[10px] text-zinc-600">
              Probe took {truth.probeMs}ms
            </div>
          </div>
        </header>

        {/* Issues */}
        {truth.issues.length > 0 && (
          <Section title="Active Issues">
            <div className="space-y-2">
              {truth.issues.map((issue, i) => (
                <IssueCard key={i} issue={issue} />
              ))}
            </div>
          </Section>
        )}

        {/* Execution state */}
        <Section title="Execution State">
          <Row label="Capital (total)" value={`$${Math.round(truth.execution.capital).toLocaleString()}`} />
          <Row label="Capital (available)" value={`$${Math.round(truth.execution.available).toLocaleString()}`} />
          <Row label="Open trades" value={truth.execution.openTrades} />
          <Row label="Drawdown" value={`${(truth.execution.drawdownPct * 100).toFixed(1)}%`} muted={truth.execution.drawdownPct === 0} />
          <Row label="Trading paused" value={truth.execution.isPaused ? 'YES' : 'No'} />
          <Row label="Agent alive" value={<StatusDot ok={truth.execution.agentAlive} label={truth.execution.agentAlive ? 'Active' : (truth.agentRunner.neverStarted ? 'Never started' : 'Stalled')} />} />
          <Row label="Last agent tick" value={fmtMs(truth.agentRunner.msSinceLastTick)} muted={!truth.agentRunner.lastTickAt} />
          <Row label="Total cycles" value={truth.agentRunner.totalCycles ?? 0} muted />
          <Row label="Claude enabled" value={truth.agentRunner.claudeEnabled ? 'Yes' : 'No'} muted={!truth.agentRunner.claudeEnabled} />
        </Section>

        {/* Connectivity */}
        <Section title="Connectivity">
          <Row label="WebSocket clients" value={truth.websocket.connectedClients} />
          <Row label="WebSocket active" value={<StatusDot ok={truth.websocket.active} label={truth.websocket.active ? 'Connected' : 'No clients'} />} />
          <Row label="Kalshi API key" value={<StatusDot ok={truth.kalshi.hasApiKey ?? false} label={truth.kalshi.hasApiKey ? 'Set' : 'Missing'} />} />
          <Row label="Kalshi WS" value={<StatusDot ok={truth.kalshi.wsConnected ?? false} label={truth.kalshi.wsConnected ? 'Connected' : 'Disconnected'} />} />
          <Row label="Kalshi mode" value={truth.kalshi.mode ?? '—'} muted />
        </Section>

        {/* Database */}
        <Section title="Database">
          <Row label="SQLite" value={<StatusDot ok={truth.database.ok} label={truth.database.ok ? 'OK' : 'Error'} />} />
          <Row label="Tables" value={truth.database.tables ?? '—'} muted />
          <Row label="Total trades" value={truth.database.totalTrades ?? 0} muted={truth.database.totalTrades === 0} />
        </Section>

        {/* Learning */}
        <Section title="Learning Loop">
          <Row label="Lessons extracted" value={truth.learning.lessons ?? 0} />
          <Row label="Active vetoes" value={truth.learning.activeVetoes ?? 0} />
          <Row label="Agents tracked" value={truth.learning.agentsTracked ?? 0} />
          <Row label="Last consensus" value={truth.learning.lastConsensusDecision ?? '—'} muted={!truth.learning.lastConsensusDecision} />
        </Section>

        {/* Founder Mode */}
        <Section title="Founder Mode">
          <Row label="Mode" value={truth.founderMode.mode ?? '—'} />
          <Row label="Focus" value={truth.founderMode.focus ?? '—'} muted={!truth.founderMode.focus} />
          <Row label="Goal" value={truth.founderMode.goal ?? '—'} muted={!truth.founderMode.goal} />
          <Row label="Markets dept" value={truth.founderMode.deptMarkets ?? '—'} />
          <Row label="Crypto dept" value={truth.founderMode.deptCrypto ?? '—'} />
        </Section>

      </div>
    </main>
  );
}
