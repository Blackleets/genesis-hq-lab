import { FlaskConical, LockKeyhole, ShieldCheck } from 'lucide-react';
import { durationLabel, stateLabel } from './formatters';
import { useRunnerTelemetry } from './useTradingDesk';

type ChallengerEvidence = {
  ok?: boolean;
  engineVersion?: string | null;
  mode?: string | null;
  executionAuthority?: boolean;
  paperOnly?: boolean;
  liveOrders?: boolean;
  survivorCount?: number;
  completedAt?: string | null;
};

type ResearchLedgerSummary = {
  experiments?: number;
  families?: number;
  noGo?: number;
  researchGo?: number;
  sealedHoldouts?: number;
  capitalEligible?: number;
  liveOrders?: number;
  latestAt?: string | null;
};

type ExtendedRunner = {
  challengerLab?: ChallengerEvidence | null;
  researchLedger?: {
    executionAuthority?: boolean;
    appendOnly?: boolean;
    summary?: ResearchLedgerSummary | null;
  } | null;
};

function clean(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ').toUpperCase() : 'UNAVAILABLE';
}

export function ChallengerEvidencePanel() {
  const { resource, runner } = useRunnerTelemetry();
  const extended = runner as (typeof runner & ExtendedRunner) | null | undefined;
  const challenger = extended?.challengerLab;
  const ledger = extended?.researchLedger;
  const summary = ledger?.summary;
  const evidenceReady = resource.state === 'ready' && challenger != null;
  const authorityOff = challenger?.executionAuthority === false && ledger?.executionAuthority !== true;
  const liveOff = challenger?.liveOrders === false && (summary?.liveOrders ?? 0) === 0;
  const paperOnly = challenger?.paperOnly === true;
  const safeReadOnly = authorityOff && liveOff;
  const completedAt = challenger?.completedAt ?? summary?.latestAt ?? null;

  return (
    <section className="challenger-evidence" data-source="CHALLENGER LAB · RESEARCH EVIDENCE ONLY" aria-label="Quant challenger evidence">
      <div className="challenger-evidence__identity">
        <div><FlaskConical size={12} /><span>CHALLENGER LAB</span></div>
        <strong>{evidenceReady ? clean(challenger?.engineVersion) : stateLabel(resource.state)}</strong>
        <small>{challenger?.mode ? clean(challenger.mode) : 'RESEARCH EVIDENCE'}</small>
      </div>

      <div className="challenger-evidence__metrics">
        <div><span>SURVIVORS</span><strong>{challenger?.survivorCount ?? '—'}</strong></div>
        <div><span>EXPERIMENTS</span><strong>{summary?.experiments ?? '—'}</strong></div>
        <div><span>FAMILIES</span><strong>{summary?.families ?? '—'}</strong></div>
        <div><span>RESEARCH GO</span><strong className={(summary?.researchGo ?? 0) > 0 ? 'is-positive' : ''}>{summary?.researchGo ?? '—'}</strong></div>
        <div><span>NO GO</span><strong className={(summary?.noGo ?? 0) > 0 ? 'is-negative' : ''}>{summary?.noGo ?? '—'}</strong></div>
        <div><span>SEALED HOLDOUTS</span><strong>{summary?.sealedHoldouts ?? '—'}</strong></div>
      </div>

      <div className="challenger-evidence__safety">
        <div className={safeReadOnly ? 'is-safe' : 'is-unverified'}>
          {safeReadOnly ? <ShieldCheck size={12} /> : <LockKeyhole size={12} />}
          <span>EXECUTION AUTHORITY</span>
          <strong>{authorityOff ? 'OFF' : 'UNVERIFIED'}</strong>
        </div>
        <div>
          <span>LIVE ORDERS</span>
          <strong>{liveOff ? 'OFF' : 'UNVERIFIED'}</strong>
        </div>
        <div>
          <span>MODE</span>
          <strong>{paperOnly ? 'PAPER ONLY' : 'RESEARCH ONLY'}</strong>
        </div>
        <small>{completedAt ? `LATEST EVIDENCE ${durationLabel(completedAt)} AGO` : 'EVIDENCE TIMESTAMP UNAVAILABLE'}</small>
      </div>
    </section>
  );
}