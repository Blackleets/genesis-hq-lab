import { BookOpenCheck, FlaskConical, ShieldCheck, Swords } from 'lucide-react';
import { useRunnerTelemetry } from './useTradingDesk';
import { formatMoney, stateLabel } from './formatters';

const PROFILES = ['short_micro', 'short_core', 'short_alt', 'long_probe'] as const;

type CohortStats = {
  trades?: number;
  closed?: number;
  wins?: number;
  losses?: number;
  winRate?: number | null;
  realizedPnl?: number | null;
  profitFactor?: number | null;
  expectancy?: number | null;
  avgWin?: number | null;
  avgLoss?: number | null;
  payoffRatio?: number | null;
  maxDrawdown?: number | null;
  sharpeProxy?: number | null;
  sortinoProxy?: number | null;
  tStat?: number | null;
  maxLossStreak?: number | null;
};

type VersionCohort = CohortStats & {
  strategyVersionId?: string;
  strategyId?: string;
  version?: string;
  status?: string;
  regimeBreakdown?: Record<string, CohortStats>;
  sessionBreakdown?: Record<string, CohortStats>;
};

type ValidationRecord = {
  profileId?: string;
  strategyId?: string;
  strategyVersionId?: string;
  runnerVersion?: string;
  status?: string;
  capitalEligible?: boolean;
  reason?: string;
  gates?: Array<{ code?: string; pass?: boolean; detail?: string }>;
  metrics?: VersionCohort;
};

type ChallengerMetrics = {
  trades?: number;
  winRate?: number | null;
  realizedPnl?: number | null;
  profitFactor?: number | null;
  expectancy?: number | null;
  maxDrawdownUsd?: number | null;
  tStat?: number | null;
};

type ChallengerWinner = {
  candidateId?: string;
  params?: { period?: number; targetPct?: number; stopPct?: number; timeoutHours?: number };
  train?: ChallengerMetrics;
  validation?: ChallengerMetrics;
  holdout?: ChallengerMetrics & { pass?: boolean };
  survivor?: boolean;
};

type ChallengerProfile = {
  status?: string;
  survivorCount?: number;
  winner?: ChallengerWinner | null;
  searchSpace?: { candidateCount?: number; holdoutUsedForRanking?: boolean };
};

type ResearchMetricBlock = {
  n?: number;
  pf?: number;
  tstat?: number;
  ev_pct?: number;
  win_rate?: number;
  max_dd_pct?: number;
  mc_p5_pct?: number;
  combined?: ResearchMetricBlock;
};

type ResearchExperiment = {
  experimentKey?: string;
  family?: string;
  strategyName?: string;
  strategyVersion?: string;
  stage?: string;
  verdict?: string;
  branch?: string | null;
  commitSha?: string | null;
  engineSha256?: string | null;
  workflowRunId?: number | null;
  artifactId?: number | null;
  artifactSha256?: string | null;
  dataSource?: string | null;
  dataStart?: string | null;
  dataEnd?: string | null;
  nAssets?: number | null;
  nDays?: number | null;
  validation?: ResearchMetricBlock | null;
  forwardEvidence?: ResearchMetricBlock | null;
  holdoutState?: string | null;
  capitalEligible?: boolean;
  liveOrders?: boolean;
  createdAt?: string | null;
};

type ResearchLedger = {
  ok?: boolean;
  ledgerVersion?: string;
  appendOnly?: boolean;
  executionAuthority?: boolean;
  summary?: {
    experiments?: number;
    families?: number;
    noGo?: number;
    researchGo?: number;
    sealedHoldouts?: number;
    capitalEligible?: number;
    liveOrders?: number;
    latestAt?: string | null;
  };
  experiments?: ResearchExperiment[];
};

type ExtendedRunner = {
  validationEngine?: {
    ok?: boolean;
    engineVersion?: string | null;
    policy?: { version?: string } | null;
    validations?: Record<string, ValidationRecord>;
    blockedProfiles?: string[];
    evaluatedAt?: string | null;
  } | null;
  challengerLab?: {
    ok?: boolean;
    engineVersion?: string | null;
    mode?: string | null;
    executionAuthority?: boolean;
    paperOnly?: boolean;
    liveOrders?: boolean;
    survivorCount?: number;
    profiles?: Record<string, ChallengerProfile>;
    completedAt?: string | null;
  } | null;
  researchLedger?: ResearchLedger | null;
  stats?: {
    sampleClosed?: number;
    sampleWinRate?: number | null;
    sampleRealizedPnl?: number | null;
    profitFactor?: number | null;
    expectancy?: number | null;
    maxDrawdown?: number | null;
    windowLimit?: number | null;
    cohorts?: Record<string, CohortStats>;
    versionCohorts?: Record<string, VersionCohort>;
  } | null;
};

function ratio(value: number | null | undefined) {
  return value == null ? 'UNAVAILABLE' : value.toFixed(2);
}

function percent(value: number | null | undefined) {
  return value == null ? 'UNAVAILABLE' : `${(value * 100).toFixed(1)}%`;
}

function pctPoints(value: number | null | undefined) {
  return value == null ? 'UNAVAILABLE' : `${value >= 0 ? '+' : ''}${value.toFixed(3)}%`;
}

function bestSegment(groups: Record<string, CohortStats> | undefined) {
  if (!groups) return 'NO CLEAN SAMPLE';
  const ranked = Object.entries(groups)
    .filter(([, metrics]) => (metrics.closed ?? 0) > 0 && metrics.expectancy != null)
    .sort((a, b) => Number(b[1].expectancy ?? -Infinity) - Number(a[1].expectancy ?? -Infinity));
  if (!ranked.length) return 'NO CLEAN SAMPLE';
  const [name, metrics] = ranked[0];
  return `${name.replaceAll('_', ' ')} · ${formatMoney(metrics.expectancy)}/T`;
}

function statusTone(status: string | undefined) {
  if (status === 'QUARANTINED' || status === 'NO_ROBUST_FINALIST' || status === 'FINALISTS_FAILED_HOLDOUT' || status === 'NO_GO') return 'is-negative';
  if (status === 'VALIDATED' || status === 'VALIDATING' || status === 'SHADOW_CHALLENGER_FOUND' || status === 'RESEARCH_GO') return 'is-positive';
  return '';
}

function challengerParams(winner: ChallengerWinner | null | undefined) {
  const params = winner?.params;
  if (!params) return 'NONE';
  const tp = params.targetPct == null ? '?' : `${(params.targetPct * 100).toFixed(1)}%`;
  const sl = params.stopPct == null ? '?' : `${(params.stopPct * 100).toFixed(1)}%`;
  return `D${params.period ?? '?'} · TP ${tp} · SL ${sl} · ${params.timeoutHours ?? '?'}H`;
}

function evidenceMetrics(experiment: ResearchExperiment) {
  const block = experiment.forwardEvidence ?? experiment.validation;
  return block?.combined ?? block ?? null;
}

function shortHash(value: string | null | undefined, length = 8) {
  return value ? value.slice(0, length) : 'UNAVAILABLE';
}

function dateRange(experiment: ResearchExperiment) {
  if (!experiment.dataStart && !experiment.dataEnd) return 'UNAVAILABLE';
  return `${experiment.dataStart ?? '?'} → ${experiment.dataEnd ?? '?'}`;
}

export function StrategyPanel() {
  const { resource, runner } = useRunnerTelemetry();
  const extended = runner as (typeof runner & ExtendedRunner) | null | undefined;
  const stats = extended?.stats;
  const validation = extended?.validationEngine;
  const challengerLab = extended?.challengerLab;
  const researchLedger = extended?.researchLedger;
  const sourceReady = resource.state === 'ready' && runner?.paperOnly === true && runner.liveOrders === false;
  const experiments = researchLedger?.experiments ?? [];
  const researchSummary = researchLedger?.summary;

  return (
    <section
      className="strategy-panel"
      style={{ gridTemplateColumns: 'minmax(0, 1fr)', alignContent: 'start' }}
      data-source="QVE + QCL + RESEARCH LEDGER · SUPABASE QUANT EVIDENCE"
      aria-label="Strategy validation, challenger engine, and research ledger"
    >
      <div className="strategy-panel__grid">
        <div className="strategy-panel__notice">
          <FlaskConical size={13} />
          <span>
            <strong>QUANT VALIDATION ENGINE · {sourceReady ? validation?.engineVersion?.toUpperCase() ?? 'QVE V1' : stateLabel(resource.state)}</strong>
            Family history protects against repeated bad ideas. Clean version cohorts must independently earn validation. Capital eligibility remains founder-controlled and LIVE LOCKED.
          </span>
        </div>

        <div className="strategy-panel__notice">
          <Swords size={13} />
          <span>
            <strong>CHALLENGER LAB · {challengerLab?.engineVersion?.toUpperCase() ?? 'QCL PENDING'} · {challengerLab?.mode ?? 'RESEARCH ONLY'}</strong>
            Train ranks candidates, validation and walk-forward filter them, and the final holdout never tunes parameters. Survivors are shadow challengers only; execution authority is {challengerLab?.executionAuthority ? 'ENABLED' : 'DISABLED'}.
          </span>
        </div>

        <div className="strategy-panel__notice">
          <BookOpenCheck size={13} />
          <span>
            <strong>RESEARCH LEDGER · {researchLedger?.ledgerVersion?.toUpperCase() ?? 'PENDING'} · {researchLedger?.appendOnly ? 'APPEND ONLY' : 'UNVERIFIED'}</strong>
            Negative evidence is institutional memory. Rejected families remain visible with provenance so ATLAS/FORGE cannot silently recycle falsified hypotheses.
          </span>
        </div>

        <article className="strategy-panel__card">
          <div>
            <strong>RESEARCH MEMORY</strong>
            <span>{researchLedger?.executionAuthority ? 'AUTHORITY ENABLED' : 'RESEARCH ONLY'}</span>
          </div>
          <dl>
            <div><dt>EXPERIMENTS</dt><dd>{researchSummary?.experiments ?? 'UNAVAILABLE'}</dd></div>
            <div><dt>FAMILIES</dt><dd>{researchSummary?.families ?? 'UNAVAILABLE'}</dd></div>
            <div><dt>NO GO</dt><dd className="is-negative">{researchSummary?.noGo ?? 'UNAVAILABLE'}</dd></div>
            <div><dt>RESEARCH GO</dt><dd className={researchSummary?.researchGo ? 'is-positive' : ''}>{researchSummary?.researchGo ?? 'UNAVAILABLE'}</dd></div>
            <div><dt>SEALED HOLDOUTS</dt><dd>{researchSummary?.sealedHoldouts ?? 'UNAVAILABLE'}</dd></div>
            <div><dt>CAPITAL ELIGIBLE</dt><dd className="is-negative">{researchSummary?.capitalEligible ?? 'UNAVAILABLE'}</dd></div>
            <div><dt>LIVE ORDERS</dt><dd className="is-negative">{researchSummary?.liveOrders ?? 'UNAVAILABLE'}</dd></div>
          </dl>
        </article>
      </div>

      <div className="strategy-panel__grid">
        {PROFILES.map((profile) => {
          const family = stats?.cohorts?.[profile];
          const clean = stats?.versionCohorts?.[profile] ?? validation?.validations?.[profile]?.metrics;
          const verdict = validation?.validations?.[profile];
          const challenger = challengerLab?.profiles?.[profile];
          const winner = challenger?.winner;
          const status = verdict?.status ?? clean?.status ?? 'UNAVAILABLE';
          const gates = verdict?.gates ?? [];
          const passedGates = gates.filter((gate) => gate.pass).length;
          const familyPf = family?.profitFactor;
          const cleanPf = clean?.profitFactor;
          const cleanEv = clean?.expectancy;
          const challengerStatus = challenger?.status ?? 'NOT RUN';
          const holdoutPf = winner?.holdout?.profitFactor;
          const holdoutEv = winner?.holdout?.expectancy;

          return (
            <article key={profile} className="strategy-panel__card">
              <div>
                <strong>{profile.replace('_', ' ').toUpperCase()}</strong>
                <span className={statusTone(status)}>
                  {clean?.version ?? verdict?.strategyVersionId?.split(':').at(-1) ?? 'VERSION UNAVAILABLE'} · {status}
                </span>
              </div>

              <dl>
                <div><dt>FAMILY CLOSED</dt><dd>{family?.closed ?? 'UNAVAILABLE'}</dd></div>
                <div><dt>FAMILY PF</dt><dd className={familyPf == null ? '' : familyPf >= 1 ? 'is-positive' : 'is-negative'}>{ratio(familyPf)}</dd></div>
                <div><dt>FAMILY EV</dt><dd className={family?.expectancy == null ? '' : family.expectancy >= 0 ? 'is-positive' : 'is-negative'}>{formatMoney(family?.expectancy)}</dd></div>
                <div><dt>CLEAN CLOSED</dt><dd>{clean?.closed ?? 0}</dd></div>
                <div><dt>CLEAN WR</dt><dd>{percent(clean?.winRate)}</dd></div>
                <div><dt>CLEAN PF</dt><dd className={cleanPf == null ? '' : cleanPf >= 1 ? 'is-positive' : 'is-negative'}>{ratio(cleanPf)}</dd></div>
                <div><dt>CLEAN EV</dt><dd className={cleanEv == null ? '' : cleanEv >= 0 ? 'is-positive' : 'is-negative'}>{formatMoney(cleanEv)}</dd></div>
                <div><dt>T-STAT</dt><dd>{ratio(clean?.tStat)}</dd></div>
                <div><dt>PAYOFF</dt><dd>{ratio(clean?.payoffRatio)}</dd></div>
                <div><dt>MAX DD</dt><dd>{formatMoney(clean?.maxDrawdown)}</dd></div>
                <div><dt>BEST REGIME</dt><dd>{bestSegment(clean?.regimeBreakdown)}</dd></div>
                <div><dt>BEST SESSION</dt><dd>{bestSegment(clean?.sessionBreakdown)}</dd></div>
                <div><dt>GATES</dt><dd>{gates.length ? `${passedGates}/${gates.length} PASS` : 'PENDING'}</dd></div>
                <div><dt>CAPITAL</dt><dd className="is-negative">{verdict?.capitalEligible ? 'ELIGIBLE · FOUNDER GATE' : 'LOCKED'}</dd></div>
                <div><dt>CHALLENGER</dt><dd className={statusTone(challengerStatus)}>{challengerStatus.replaceAll('_', ' ')}</dd></div>
                <div><dt>SEARCHED</dt><dd>{challenger?.searchSpace?.candidateCount ?? 'PENDING'}</dd></div>
                <div><dt>SHADOW PARAMS</dt><dd>{challengerParams(winner)}</dd></div>
                <div><dt>VALID PF</dt><dd>{ratio(winner?.validation?.profitFactor)}</dd></div>
                <div><dt>HOLDOUT PF</dt><dd className={holdoutPf == null ? '' : holdoutPf >= 1.1 ? 'is-positive' : 'is-negative'}>{ratio(holdoutPf)}</dd></div>
                <div><dt>HOLDOUT EV</dt><dd className={holdoutEv == null ? '' : holdoutEv > 0 ? 'is-positive' : 'is-negative'}>{formatMoney(holdoutEv)}</dd></div>
              </dl>

              {verdict?.reason ? (
                <p><ShieldCheck size={11} /> {verdict.reason}</p>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="strategy-panel__grid" aria-label="Research ledger experiments">
        {experiments.length ? experiments.map((experiment) => {
          const evidence = evidenceMetrics(experiment);
          const pf = evidence?.pf;
          const ev = evidence?.ev_pct;
          const tStat = evidence?.tstat;
          const verdict = experiment.verdict ?? 'UNAVAILABLE';
          return (
            <article key={experiment.experimentKey} className="strategy-panel__card">
              <div>
                <strong>{experiment.strategyName?.toUpperCase() ?? experiment.family?.replaceAll('_', ' ') ?? 'EXPERIMENT'}</strong>
                <span className={statusTone(verdict)}>{experiment.strategyVersion ?? '?'} · {verdict}</span>
              </div>
              <dl>
                <div><dt>FAMILY</dt><dd>{experiment.family?.replaceAll('_', ' ') ?? 'UNAVAILABLE'}</dd></div>
                <div><dt>STAGE</dt><dd>{experiment.stage?.replaceAll('_', ' ') ?? 'UNAVAILABLE'}</dd></div>
                <div><dt>HOLDOUT</dt><dd>{experiment.holdoutState?.replaceAll('_', ' ') ?? 'UNAVAILABLE'}</dd></div>
                <div><dt>PF</dt><dd className={pf == null ? '' : pf >= 1.3 ? 'is-positive' : 'is-negative'}>{ratio(pf)}</dd></div>
                <div><dt>T-STAT</dt><dd className={tStat == null ? '' : tStat >= 2 ? 'is-positive' : 'is-negative'}>{ratio(tStat)}</dd></div>
                <div><dt>EV</dt><dd className={ev == null ? '' : ev > 0 ? 'is-positive' : 'is-negative'}>{pctPoints(ev)}</dd></div>
                <div><dt>DATA</dt><dd>{dateRange(experiment)}</dd></div>
                <div><dt>ASSETS / DAYS</dt><dd>{experiment.nAssets ?? '?'} / {experiment.nDays ?? '?'}</dd></div>
                <div><dt>COMMIT</dt><dd>{shortHash(experiment.commitSha)}</dd></div>
                <div><dt>ENGINE HASH</dt><dd>{shortHash(experiment.engineSha256, 10)}</dd></div>
                <div><dt>ARTIFACT</dt><dd>{experiment.artifactId ?? 'UNAVAILABLE'}</dd></div>
                <div><dt>CAPITAL / LIVE</dt><dd className="is-negative">{experiment.capitalEligible ? 'ELIGIBLE' : 'LOCKED'} / {experiment.liveOrders ? 'ON' : 'OFF'}</dd></div>
              </dl>
            </article>
          );
        }) : (
          <article className="strategy-panel__card">
            <div><strong>RESEARCH LEDGER</strong><span>NO EVIDENCE LOADED</span></div>
            <dl><div><dt>STATE</dt><dd>UNAVAILABLE</dd></div></dl>
          </article>
        )}
      </div>
    </section>
  );
}
