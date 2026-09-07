import { RadioTower } from 'lucide-react';
import { useFounderState, usePaperPositions, useRunnerTelemetry } from './useTradingDesk';

const AGENTS = [
  { id: 'ATLAS', role: 'QUANT RESEARCH', sigil: '∆' },
  { id: 'ORACLE', role: 'MARKET REGIME', sigil: 'Ω' },
  { id: 'SENTINEL', role: 'RISK GOVERNOR', sigil: 'S' },
  { id: 'FORGE', role: 'STRATEGY CHALLENGER', sigil: 'F' },
  { id: 'EXECUTION', role: 'PAPER BOUNDARY', sigil: 'X' },
  { id: 'AUDITOR', role: 'ECONOMIC TRUTH', sigil: 'Σ' },
  { id: 'HERMES', role: 'CONNECTOR MESH', sigil: 'H' },
] as const;

function visibleStatus(status: string | undefined, fresh: boolean) {
  if (!fresh || !status) return 'STATUS UNAVAILABLE';
  return status.replaceAll('_', ' ').toUpperCase();
}

export function AgentBar() {
  const founder = useFounderState();
  const positions = usePaperPositions();
  const { runner } = useRunnerTelemetry();
  const fresh = founder.state === 'ready';

  return (
    <section className="agent-bar" data-source="REAL AGENT / SYSTEM STATE" aria-label="Genesis agent states">
      <div className="agent-bar__source"><RadioTower size={12} /><span>FOUNDER READINESS</span><strong>{fresh ? 'VERIFIED FEED' : founder.state.toUpperCase()}</strong></div>
      <div className="agent-bar__grid">
        {AGENTS.map(({ id, role, sigil }) => {
          const agent = founder.data?.agents.find((candidate) => candidate.id === id);
          const status = visibleStatus(agent?.status, fresh);
          const tone = status === 'LOCKED' || status === 'BLOCKING' ? 'blocked' : status === 'STATUS UNAVAILABLE' ? 'unknown' : 'idle';
          const detail = id === 'EXECUTION' && runner?.paperOnly === true && positions.data
            ? `${positions.data.length} OPEN PAPER`
            : agent?.currentTask ?? (agent?.metrics.evaluatedGates != null ? `${agent.metrics.evaluatedGates} GATES EVALUATED` : 'NO VERIFIED ACTIVITY');
          return (
            <article key={id} className={`agent-card agent-card--${tone}`}>
              <span className="agent-card__sigil" aria-hidden="true">{sigil}</span>
              <div><strong>{id}</strong><span>{role}</span></div>
              <div className="agent-card__state"><i />{status}</div>
              <p>{fresh && agent ? detail : 'STATUS UNAVAILABLE'}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}
