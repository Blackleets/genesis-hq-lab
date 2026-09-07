import { ArrowUpRight, Beaker, BookOpenCheck, FlaskConical, ShieldAlert } from 'lucide-react';
import { stateLabel } from './formatters';
import { useRunnerTelemetry } from './useTradingDesk';

type PipelineEvent = {
  eventId?: string;
  proposalId?: string;
  family?: string;
  stage?: string;
  noveltyDecision?: string | null;
  economicVerdict?: string | null;
  experimentKey?: string | null;
  researchComputeAuthority?: boolean;
  reason?: string | null;
  createdAt?: string | null;
};

type PipelineSummary = {
  proposalsTracked?: number;
  noveltyAccepted?: number;
  noveltyBlocked?: number;
  economicWaiting?: number;
  economicBlocked?: number;
  backtestAllowed?: number;
  ledgerSealed?: number;
  computeAuthorities?: number;
};

type ExtendedRunner = {
  researchPipeline?: {
    engineVersion?: string | null;
    summary?: PipelineSummary | null;
    latest?: PipelineEvent[];
    policy?: string | null;
  } | null;
  economicFeasibility?: {
    engineVersion?: string | null;
    summary?: {
      checks?: number;
      passPrefilter?: number;
      failEconomics?: number;
      noActiveSignal?: number;
      dataBlocked?: number;
    } | null;
  } | null;
  hypothesisGate?: {
    engineVersion?: string | null;
    latest?: { family?: string; decision?: string; createdAt?: string | null } | null;
  } | null;
  researchLedger?: {
    summary?: { experiments?: number; noGo?: number; researchGo?: number; sealedHoldouts?: number } | null;
  } | null;
};

function clean(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ').toUpperCase() : 'UNAVAILABLE';
}

function eventTone(event: PipelineEvent) {
  if (event.researchComputeAuthority && event.stage === 'BACKTEST_ALLOWED') return 'compute';
  if (event.stage === 'ECONOMIC_BLOCKED' || event.economicVerdict === 'FAIL_ECONOMICS' || event.stage === 'NOVELTY_BLOCKED') return 'blocked';
  if (event.stage === 'NOVELTY_ACCEPTED' || event.stage === 'ECONOMIC_WAITING') return 'waiting';
  if (event.stage === 'LEDGER_SEALED') return 'sealed';
  return 'neutral';
}

export function ResearchOpportunitySurface({ onOpenResearch }: { onOpenResearch: () => void }) {
  const { resource, runner } = useRunnerTelemetry();
  const extended = runner as (typeof runner & ExtendedRunner) | null | undefined;
  const pipeline = extended?.researchPipeline;
  const summary = pipeline?.summary;
  const ledger = extended?.researchLedger?.summary;
  const events = Array.isArray(pipeline?.latest) ? pipeline.latest.slice(0, 3) : [];
  const ready = resource.state === 'ready' && runner?.paperOnly === true && runner.liveOrders === false;
  const compute = summary?.computeAuthorities ?? 0;

  return (
    <section className="research-opportunity" data-source="QUANT RESEARCH PIPELINE · READ ONLY" aria-label="Research and opportunity surface">
      <div className="research-opportunity__identity">
        <div><FlaskConical size={13} /><span>RESEARCH / OPPORTUNITY</span></div>
        <strong>{ready ? pipeline?.engineVersion?.toUpperCase() ?? 'QRP UNAVAILABLE' : stateLabel(resource.state)}</strong>
        <small>{runner?.liveOrders === false ? 'LIVE ORDERS OFF' : 'LIVE STATE UNAVAILABLE'}</small>
      </div>

      <div className="research-opportunity__metrics">
        <div><span>TRACKED</span><strong>{summary?.proposalsTracked ?? '—'}</strong></div>
        <div><span>ECON BLOCKED</span><strong className="is-negative">{summary?.economicBlocked ?? '—'}</strong></div>
        <div><span>BACKTEST</span><strong className={(summary?.backtestAllowed ?? 0) > 0 ? 'is-positive' : ''}>{summary?.backtestAllowed ?? '—'}</strong></div>
        <div><span>LEDGER SEALED</span><strong>{summary?.ledgerSealed ?? ledger?.experiments ?? '—'}</strong></div>
        <div><span>COMPUTE AUTH</span><strong className={compute > 0 ? 'is-positive' : ''}>{compute}</strong></div>
        <div><span>NO GO MEMORY</span><strong className="is-negative">{ledger?.noGo ?? '—'}</strong></div>
      </div>

      <div className="research-opportunity__events" aria-label="Latest research pipeline events">
        {events.length ? events.map((event, index) => (
          <article key={event.eventId ?? `${event.family ?? 'event'}-${index}`} className={`research-event research-event--${eventTone(event)}`} title={event.reason ?? undefined}>
            <div><Beaker size={10} /><strong>{clean(event.family)}</strong></div>
            <span>{clean(event.stage)}</span>
            <small>{event.economicVerdict ? clean(event.economicVerdict) : event.noveltyDecision ? clean(event.noveltyDecision) : 'NO VERDICT YET'}</small>
            <b>{event.researchComputeAuthority ? 'COMPUTE AUTHORIZED' : 'NO COMPUTE AUTHORITY'}</b>
          </article>
        )) : (
          <div className="research-opportunity__empty"><ShieldAlert size={11} /> PIPELINE EVENTS UNAVAILABLE · NO OPPORTUNITY INFERRED</div>
        )}
      </div>

      <button type="button" className="research-opportunity__open" onClick={onOpenResearch}>
        <BookOpenCheck size={11} /> EVIDENCE <ArrowUpRight size={10} />
      </button>
    </section>
  );
}
