import { useEffect, useState } from 'react';
import { Bot, Cpu, RadioTower, ShieldCheck, TriangleAlert } from 'lucide-react';
import { fetchPaperAgentSwarm, type PaperAgentSwarmSnapshot } from '@services/paperAgentSwarmClient';
import './paperAgentSwarm.css';

const POLL_MS = 30_000;
const STALE_MS = 5 * 60 * 60 * 1000;

type LoadState = 'loading' | 'ready' | 'error';

function ageLabel(timestamp: string | null | undefined) {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(parsed)) return 'UNAVAILABLE';
  const minutes = Math.max(0, Math.floor((Date.now() - parsed) / 60_000));
  if (minutes < 1) return '<1M AGO';
  if (minutes < 60) return `${minutes}M AGO`;
  const hours = Math.floor(minutes / 60);
  return `${hours}H ${minutes % 60}M AGO`;
}

function money(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'UNAVAILABLE';
  return `${value >= 0 ? '+' : '-'}$${Math.abs(value).toFixed(2)}`;
}

function isFresh(timestamp: string | null | undefined) {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  return Number.isFinite(parsed) && Date.now() - parsed <= STALE_MS;
}

export function PaperAgentSwarmPanel() {
  const [state, setState] = useState<LoadState>('loading');
  const [snapshot, setSnapshot] = useState<PaperAgentSwarmSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      controller?.abort();
      controller = new AbortController();
      try {
        const next = await fetchPaperAgentSwarm(controller.signal);
        if (!disposed) {
          setSnapshot(next);
          setState(next.ok ? 'ready' : 'error');
          setError(next.ok ? null : next.error ?? 'paper_swarm_unavailable');
        }
      } catch (caught) {
        if (!disposed && !(caught instanceof DOMException && caught.name === 'AbortError')) {
          setState('error');
          setError(caught instanceof Error ? caught.message : 'paper_swarm_unavailable');
        }
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  if (state === 'loading') {
    return (
      <section className="paper-agent-swarm paper-agent-swarm--pending" aria-label="Paper agent swarm">
        <RadioTower size={14} className="animate-pulse" />
        <strong>LOADING VERIFIED PAPER AGENT EVIDENCE</strong>
      </section>
    );
  }

  if (state === 'error' || !snapshot?.ok) {
    return (
      <section className="paper-agent-swarm paper-agent-swarm--error" aria-label="Paper agent swarm">
        <TriangleAlert size={14} />
        <div>
          <strong>PAPER AGENT EVIDENCE UNAVAILABLE</strong>
          <span>{error ?? 'No verified swarm snapshot is available yet.'}</span>
        </div>
      </section>
    );
  }

  const fresh = isFresh(snapshot.updatedAt);
  const providerLabel = snapshot.llmActive
    ? `${snapshot.llmProvider?.toUpperCase() ?? 'LLM'} ACTIVE`
    : 'DETERMINISTIC GUARDRAIL';
  const funding = snapshot.evidence?.funding;
  const capture = snapshot.evidence?.capture;
  const verdictTone = snapshot.final.verdict === 'STAND_DOWN' ? 'blocked' : 'watch';

  return (
    <section className={`paper-agent-swarm ${fresh ? 'is-fresh' : 'is-stale'}`} data-source="GITHUB PAPER AGENT TAPE" aria-label="Paper agent swarm">
      <header className="paper-agent-swarm__head">
        <div className="paper-agent-swarm__title">
          <span><Bot size={14} /> PAPER AGENT SWARM</span>
          <strong>ATLAS · NOVA · SENTINEL · CURATOR · ARBITER</strong>
          <small>VERIFIED CAPTURE TAPE · NO EXECUTION AUTHORITY · LIVE ORDERS OFF</small>
        </div>
        <div className="paper-agent-swarm__runtime">
          <span><Cpu size={12} /> {providerLabel}</span>
          <strong>{fresh ? 'FRESH' : 'STALE'} · {ageLabel(snapshot.updatedAt)}</strong>
          {snapshot.providerConfigured === false ? <small>Provider not configured</small> : <small>{snapshot.llmProvider?.toUpperCase() ?? 'RULE FALLBACK'}</small>}
        </div>
        <div className={`paper-agent-swarm__verdict is-${verdictTone}`}>
          <span><ShieldCheck size={12} /> ARBITER BOUNDARY</span>
          <strong>{snapshot.final.verdict.replaceAll('_', ' ')}</strong>
          <small>{snapshot.final.blockers.length ? snapshot.final.blockers.join(' · ').replaceAll('_', ' ') : 'PAPER REVIEW ONLY'}</small>
        </div>
      </header>

      <div className="paper-agent-swarm__metrics">
        <div><span>CAPTURE</span><strong>{capture?.scored ?? '—'} SCORED</strong><small>{capture?.quoted ?? '—'} quoted</small></div>
        <div><span>ECONOMIC P&L</span><strong>{money(funding?.economicPnlUsdt)}</strong><small>{funding?.feeLock ? `LOCK · ${funding.feeLockReason ?? 'FEE'}` : 'fee lock off'}</small></div>
        <div><span>AGENT ENGINE</span><strong>{snapshot.totals?.completedLlm ?? 0} LLM · {snapshot.totals?.fallback ?? 0} RULE</strong><small>{(snapshot.totals?.tokens.in ?? 0) + (snapshot.totals?.tokens.out ?? 0)} tokens</small></div>
        <div><span>AUTHORITY</span><strong>READ / REASON</strong><small>capital eligible: no</small></div>
      </div>

      <div className="paper-agent-swarm__agents">
        {snapshot.agents.map((agent) => (
          <article key={agent.id} className={`paper-agent-swarm__agent paper-agent-swarm__agent--${agent.id}`}>
            <div className="paper-agent-swarm__agent-head">
              <div><strong>{agent.name.toUpperCase()}</strong><span>{agent.role.toUpperCase()}</span></div>
              <b>{agent.engine === 'llm' ? `${agent.provider?.toUpperCase() ?? 'LLM'} · ${agent.status.replaceAll('_', ' ').toUpperCase()}` : `RULE FALLBACK · ${agent.status.replaceAll('_', ' ').toUpperCase()}`}</b>
            </div>
            <p>{agent.output ?? 'No verified agent output.'}</p>
            <footer>
              <span>{ageLabel(agent.completedAt)}</span>
              <span>{agent.engine === 'llm' ? `${agent.tokens.in + agent.tokens.out} TOKENS` : '0 TOKENS'}</span>
              {agent.error && agent.error !== 'Provider not configured' ? <span className="is-error">{agent.error}</span> : null}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
