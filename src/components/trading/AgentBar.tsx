import { RadioTower } from 'lucide-react';
import { useExecutions, useFounderState, useMarketData, usePaperPositions, useRiskState, useRunnerTelemetry } from './useTradingDesk';
import { finite, formatMoney } from './formatters';
import { PaperAgentSwarmPanel } from './PaperAgentSwarmPanel';

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
  const executions = useExecutions();
  const { market } = useMarketData();
  const { capture } = useRiskState();
  const { runner, resource } = useRunnerTelemetry();
  const fresh = founder.state === 'ready';
  const runnerActive = resource.state === 'ready' && runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const cycle = runner?.lastResult;
  const fundingPnl = capture.state === 'ready' ? capture.data?.funding?.economicPnlUsdt : null;

  const operationalEvidence = (id: typeof AGENTS[number]['id']) => {
    if (id === 'ATLAS' && runnerActive) return { status: 'SCANNING', detail: `${cycle?.scanned ?? 0} MARKETS · ${cycle?.qualified ?? 0} QUALIFIED`, tone: 'active' } as const;
    if (id === 'EXECUTION' && runnerActive) return { status: 'PAPER ACTIVE', detail: `${positions.data?.length ?? 0} OPEN · ${cycle?.executed ?? 0} THIS CYCLE`, tone: 'active' } as const;
    if (id === 'AUDITOR' && capture.state === 'ready') return { status: 'LEDGER ONLINE', detail: `ECONOMIC P&L ${formatMoney(fundingPnl)}`, tone: finite(fundingPnl) && fundingPnl >= 0 ? 'active' : 'watch' } as const;
    if (id === 'HERMES' && market.state === 'ready') return { status: 'FEED ONLINE', detail: 'BINANCE SPOT PUBLIC · FRESH', tone: 'active' } as const;
    if (id === 'SENTINEL' && fresh) return { status: 'GUARDING', detail: `${founder.data?.cutover.checks.filter((check) => !check.passed).length ?? 0} CUTOVER GATES BLOCKED`, tone: 'blocked' } as const;
    if (id === 'FORGE' && runner && 'validationEngine' in runner) return { status: 'EVIDENCE LOADED', detail: 'QVE STRATEGY VALIDATION', tone: 'idle' } as const;
    if (id === 'ORACLE' && runnerActive && (cycle?.decisions?.length ?? 0) > 0) return { status: 'CYCLE EVIDENCE', detail: `${cycle?.decisions?.length ?? 0} VERIFIED DECISIONS`, tone: 'idle' } as const;
    if (id === 'EXECUTION' && executions.data) return { status: 'PAPER IDLE', detail: `${executions.data.filter((trade) => trade.status === 'closed').length} CLOSED IN SAMPLE`, tone: 'idle' } as const;
    return null;
  };

  return (
    <section className="agent-bar" data-source="REAL AGENT / SYSTEM STATE" aria-label="Genesis agent states">
      <div className="agent-bar__source"><RadioTower size={12} /><span>FOUNDER READINESS</span><strong>{fresh ? 'VERIFIED FEED' : founder.state.toUpperCase()}</strong></div>
      <div className="agent-bar__grid">
        {AGENTS.map(({ id, role, sigil }) => {
          const agent = founder.data?.agents.find((candidate) => candidate.id === id);
          const evidence = operationalEvidence(id);
          const status = evidence?.status ?? visibleStatus(agent?.status, fresh);
          const tone = evidence?.tone ?? (status === 'LOCKED' || status === 'BLOCKING' ? 'blocked' : status === 'STATUS UNAVAILABLE' ? 'unknown' : 'idle');
          const detail = evidence?.detail ?? agent?.currentTask ?? (agent?.metrics.evaluatedGates != null ? `${agent.metrics.evaluatedGates} GATES EVALUATED` : 'NO VERIFIED ACTIVITY');
          return (
            <article key={id} className={`agent-card agent-card--${tone}`} data-evidence={evidence ? 'operational' : 'founder-readiness'}>
              <span className="agent-card__sigil" aria-hidden="true">{sigil}</span>
              <div><strong>{id}</strong><span>{role}</span></div>
              <div className="agent-card__state"><i />{status}</div>
              <p>{evidence ? detail : fresh && agent ? detail : 'STATUS UNAVAILABLE'}</p>
            </article>
          );
        })}
      </div>
      <PaperAgentSwarmPanel />
    </section>
  );
}
