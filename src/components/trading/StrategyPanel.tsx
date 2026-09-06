import { FlaskConical, ShieldCheck } from 'lucide-react';
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

type ExtendedRunner = {
  validationEngine?: {
    ok?: boolean;
    engineVersion?: string | null;
    policy?: { version?: string } | null;
    validations?: Record<string, ValidationRecord>;
    blockedProfiles?: string[];
    evaluatedAt?: string | null;
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
  if (status === 'QUARANTINED') return 'is-negative';
  if (status === 'VALIDATED' || status === 'VALIDATING') return 'is-positive';
  return '';
}

export function StrategyPanel() {
  const { resource, runner } = useRunnerTelemetry();
  const extended = runner as (typeof runner & ExtendedRunner) | null | undefined;
  const stats = extended?.stats;
  const validation = extended?.validationEngine;
  const sourceReady = resource.state === 'ready' && runner?.paperOnly === true && runner.liveOrders === false;

  return (
    <section className="strategy-panel" data-source="QVE v1 · SUPABASE PAPER COHORTS" aria-label="Strategy validation engine">
      <div className="strategy-panel__notice">
        <FlaskConical size={13} />
        <span>
          <strong>QUANT VALIDATION ENGINE · {sourceReady ? validation?.engineVersion?.toUpperCase() ?? 'QVE V1' : stateLabel(resource.state)}</strong>
          Family history protects against repeated bad ideas. Clean version cohorts must independently earn validation. Capital eligibility remains founder-controlled and LIVE LOCKED.
        </span>
      </div>

      <div className="strategy-panel__grid">
        {PROFILES.map((profile) => {
          const family = stats?.cohorts?.[profile];
          const clean = stats?.versionCohorts?.[profile] ?? validation?.validations?.[profile]?.metrics;
          const verdict = validation?.validations?.[profile];
          const status = verdict?.status ?? clean?.status ?? 'UNAVAILABLE';
          const gates = verdict?.gates ?? [];
          const passedGates = gates.filter((gate) => gate.pass).length;
          const familyPf = family?.profitFactor;
          const cleanPf = clean?.profitFactor;
          const cleanEv = clean?.expectancy;

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
