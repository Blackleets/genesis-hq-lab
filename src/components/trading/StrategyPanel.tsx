import { FlaskConical, ShieldCheck, Swords } from 'lucide-react';
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
  if (status === 'QUARANTINED' || status === 'NO_ROBUST_FINALIST' || status === 'FINALISTS_FAILED_HOLDOUT') return 'is-negative';
  if (status === 'VALIDATED' || status === 'VALIDATING' || status === 'SHADOW_CHALLENGER_FOUND') return 'is-positive';
  return '';
}

function challengerParams(winner: ChallengerWinner | null | undefined) {
  const params = winner?.params;
  if (!params) return 'NONE';
  const tp = params.targetPct == null ? '?' : `${(params.targetPct * 100).toFixed(1)}%`;
  const sl = params.stopPct == null ? '?' : `${(params.stopPct * 100).toFixed(1)}%`;
  return `D${params.period ?? '?'} · TP ${tp} · SL ${sl} · ${params.timeoutHours ?? '?'}H`;
}

export function StrategyPanel() {
  const { resource, runner } = useRunnerTelemetry();
  const extended = runner as (typeof runner & ExtendedRunner) | null | undefined;
  const stats = extended?.stats;
  const validation = extended?.validationEngine;
  const challengerLab = extended?.challengerLab;
  const sourceReady = resource.state === 'ready' && runner?.paperOnly === true && runner.liveOrders === false;

  return (
    <section className="strategy-panel" data-source="QVE + QCL · SUPABASE QUANT EVIDENCE" aria-label="Strategy validation and challenger engine">
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
    </section>
  );
}
