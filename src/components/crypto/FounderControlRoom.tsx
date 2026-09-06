import { useEffect, useState } from 'react';
import { canReviewCutover, fetchFounderSnapshot, type FounderSnapshot } from '@services/founderClient';

const panel = 'border border-zinc-800 bg-[#10131a] p-4';
const usd = (n: number | null | undefined) => n == null ? 'Not defined' : `$${n.toLocaleString('en-US')}`;
function Status({ value }: { value: string }) {
  const good = ['online', 'verified', 'evaluated'].includes(value);
  const bad = ['BLOCKED', 'blocking', 'locked', 'live_locked', 'unverified', 'missing_credentials'].includes(value);
  return <span className={`inline-block border px-2 py-1 text-[10px] font-mono break-all ${good ? 'border-emerald-500/40 text-emerald-300' : bad ? 'border-red-500/40 text-red-300' : 'border-amber-500/40 text-amber-300'}`}>{value}</span>;
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
      } finally { window.clearTimeout(timeout); pending = false; }
    };
    void load();
    const poll = window.setInterval(() => void load(), 15_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { disposed = true; controller?.abort(); window.clearInterval(poll); window.clearInterval(clock); };
  }, [refresh]);
  const ready = canReviewCutover(snapshot, now);
  const expired = !!snapshot && (now - Date.parse(snapshot.updatedAt) >= 60_000
    || (snapshot.readiness === 'READY_FOR_EXTERNAL_CUTOVER' && !ready));
  const blockers = snapshot?.blockers ?? ['Founder readiness unavailable — live remains blocked'];
  return <div className="space-y-4 min-w-0">
    <section className={`${panel} border-t-2 ${ready ? 'border-t-amber-400' : 'border-t-red-400'}`} aria-labelledby="founder-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="founder-heading" className="text-lg font-semibold">Founder Live Control</h2>
        <Status value={ready ? 'READY_FOR_EXTERNAL_CUTOVER' : 'BLOCKED'} />
      </div>
      <p className="text-xs text-zinc-400 mt-2">Preparation for external owner review. This console cannot submit orders.</p>
      <dl className="grid grid-cols-2 gap-3 my-4 text-xs">
        <div><dt className="text-zinc-400">Owner / wallet</dt><dd className="mt-1">{snapshot?.owner.status ?? 'unverified'} / {snapshot?.owner.wallet.status ?? 'unverified'}</dd></div>
        <div><dt className="text-zinc-400">Mode</dt><dd className="mt-1">{ready ? snapshot?.mode : 'live_locked'}</dd></div>
        <div><dt className="text-zinc-400">Max daily loss · USD</dt><dd className="mt-1 font-mono">{usd(snapshot?.risk.maxDailyLoss)}</dd></div>
        <div><dt className="text-zinc-400">Max order notional · USD</dt><dd className="mt-1 font-mono">{usd(snapshot?.risk.maxOrderNotional)}</dd></div>
        <div><dt className="text-zinc-400">Kill switch</dt><dd className="mt-1">{snapshot?.risk.killSwitchArmed && snapshot.risk.killSwitchTested ? 'Armed · tested' : 'Missing / untested'}</dd></div>
        <div><dt className="text-zinc-400">Strategy approval</dt><dd className="mt-1">{snapshot?.risk.strategyApproved ? 'Verified for current scope' : 'Missing'}</dd></div>
        <div><dt className="text-zinc-400">Broker health</dt><dd className="mt-1">{snapshot?.connectors.find(c => c.id === 'execution_broker')?.health ?? 'unverified'}</dd></div>
        <div><dt className="text-zinc-400">Founder emergency pause</dt><dd className="mt-1">{snapshot?.risk.founderPaused !== false ? 'Active / unknown' : 'Clear'}</dd></div>
      </dl>
      <ul className="divide-y divide-zinc-800 text-xs" aria-label="Cutover checklist">
        {snapshot?.cutover.checks.map(check => <li key={check.id} className="flex gap-2 py-2">
          <span className={check.passed && !expired ? 'text-emerald-300' : 'text-red-300'}>{check.passed && !expired ? 'PASS' : 'BLOCK'}</span>
          <span>{check.label}</span>
        </li>)}
      </ul>
      <div id="founder-blockers" className="mt-3 text-xs text-red-200" aria-live="polite">
        {error && <p>Backend unavailable. No cached readiness is trusted.</p>}
        {expired && <p>Readiness evidence expired. Refresh and repeat server-side preflight.</p>}
        {blockers.length > 0 && <><h3 className="font-semibold mb-2">Live blockers</h3><ul className="list-disc pl-4 space-y-1">{blockers.map(b => <li key={b}>{b}</li>)}</ul></>}
      </div>
      <div className="flex flex-wrap gap-2 mt-4">
        <button type="button" disabled={!ready} aria-describedby="founder-blockers" onClick={() => setReview(true)} className="border border-amber-400/50 text-amber-200 px-3 py-2 text-xs disabled:opacity-40 disabled:cursor-not-allowed">Review external cutover</button>
        <button type="button" onClick={() => { setSnapshot(null); setReview(false); setRefresh(n => n + 1); }} className="border border-zinc-600 px-3 py-2 text-xs">Refresh readiness</button>
      </div>
      {review && ready && <div className="mt-3 border border-amber-500/30 p-3 text-xs text-amber-200" role="status">
        Readiness is evidence for review, not permission to trade. The owner must separately approve the exact venue/account, strategy version and limits through a reviewed server-side cutover procedure. No confirmation or execution endpoint is installed here.
      </div>}
      <p className="text-[10px] text-zinc-400 mt-3">{snapshot ? `Checked ${new Date(snapshot.updatedAt).toLocaleTimeString()} · expires ${snapshot.cutover.evidenceExpiresAt ? new Date(snapshot.cutover.evidenceExpiresAt).toLocaleTimeString() : 'no valid evidence'}` : 'Waiting for server readiness'} · Wallet identity only; no custody.</p>
    </section>

    <section className={panel} aria-labelledby="connectors-heading">
      <h2 id="connectors-heading" className="text-base font-semibold">Hermes Connector Registry</h2>
      <p className="text-xs text-zinc-400 mt-1 mb-3">Credentials present does not mean connected. Health requires fresh server evidence.</p>
      {!snapshot && <p className="text-xs text-zinc-400">Registry unavailable</p>}
      <div className="space-y-2">{snapshot?.connectors.map(c => <details key={c.id} className="border border-zinc-800 p-3 text-xs">
        <summary className="cursor-pointer"><span className="font-medium mr-2">{c.name}</span><Status value={expired ? 'unverified' : c.status} /><span className="block text-zinc-400 mt-1">{c.mode} · {c.permissions.join(', ')}</span></summary>
        <div className="mt-3 space-y-2 break-words">
          {c.status === 'missing_credentials' && <p className="text-amber-300">Provider not configured</p>}
          <p>Required server variables: {c.requiredEnv.join(', ') || 'No private credentials for scanning'}</p>
          <p>Last verified check: {c.lastCheck ?? 'never'}</p>
          {c.blockers.map(b => <p key={b} className="text-amber-200">{b}</p>)}
        </div>
      </details>)}</div>
    </section>

    <section className={panel} aria-labelledby="agents-heading">
      <h2 id="agents-heading" className="text-base font-semibold">Agent Operating Floor</h2>
      <p className="text-xs text-zinc-400 mt-1">Registered roles; activity is reported only when a runner provides evidence.</p>
      {[...new Set(snapshot?.agents.map(a => a.desk))].map(desk => <div key={desk} className="mt-4">
        <h3 className="text-[10px] uppercase tracking-widest text-cyan-300 mb-2">{desk} desk</h3>
        <div className="space-y-2">{snapshot?.agents.filter(a => a.desk === desk).map(a => <details key={a.id} className="border border-zinc-800 p-3 text-xs">
          <summary className="cursor-pointer"><span className="font-mono mr-2">{a.name}</span><Status value={expired ? 'unverified' : a.status} /><span className="block text-zinc-400 mt-1">{a.role}</span></summary>
          <div className="space-y-2 mt-3 text-zinc-300 break-words"><p>{a.mission}</p><p>Task: {a.currentTask ?? 'No running task'}</p><p>Permissions: {a.permissions.join(', ')}</p><p>Connected to: {a.connectedTo.join(', ')}</p><p>Metrics source: {a.metrics.source} · Gate checks: {a.metrics.evaluatedGates ?? '—'} · Net P&L: {a.metrics.netPnl ?? 'No attributed evidence'}</p><p>Memory: {a.memory.policy}</p>{a.blockers.map(b => <p key={b} className="text-amber-200">{b}</p>)}</div>
        </details>)}</div>
      </div>)}
    </section>
  </div>;
}
