import { FlaskConical } from 'lucide-react';
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
};

type ExtendedRunnerStats = {
  sampleClosed?: number;
  sampleWinRate?: number | null;
  sampleRealizedPnl?: number | null;
  profitFactor?: number | null;
  expectancy?: number | null;
  maxDrawdown?: number | null;
  windowLimit?: number | null;
  cohorts?: Record<string, CohortStats>;
};

function ratio(value: number | null | undefined) {
  return value == null ? 'UNAVAILABLE' : value.toFixed(2);
}

function percent(value: number | null | undefined) {
  return value == null ? 'UNAVAILABLE' : `${(value * 100).toFixed(1)}%`;
}

export function StrategyPanel() {
  const { resource, runner } = useRunnerTelemetry();
  const stats = runner?.stats as ExtendedRunnerStats | null | undefined;
  const sourceReady = resource.state === 'ready' && runner?.paperOnly === true && runner.liveOrders === false;

  return (
    <section className="strategy-panel" data-source="SUPABASE PAPER FUTURES COHORTS" aria-label="Strategy cohort evidence">
      <div className="strategy-panel__notice">
        <FlaskConical size={13} />
        <span>
          <strong>COHORT ECONOMICS · {sourceReady ? `RECENT ≤ ${stats?.windowLimit ?? 80}` : stateLabel(resource.state)}</strong>
          PF, expectancy, payoff and drawdown are descriptive paper evidence only. No strategy is promoted from this panel and no live permission is created.
        </span>
      </div>
      <div className="strategy-panel__grid">
        {PROFILES.map((profile) => {
          const cohort = stats?.cohorts?.[profile];
          const realized = cohort?.realizedPnl;
          const expectancy = cohort?.expectancy;
          const pf = cohort?.profitFactor;
          return (
            <article key={profile} className="strategy-panel__card">
              <div><strong>{profile.replace('_', ' ').toUpperCase()}</strong><span>{cohort?.closed ? `N=${cohort.closed} CLOSED` : 'NO VERIFIED SAMPLE'}</span></div>
              <dl>
                <div><dt>CLOSED</dt><dd>{cohort?.closed ?? 'UNAVAILABLE'}</dd></div>
                <div><dt>WIN RATE</dt><dd>{percent(cohort?.winRate)}</dd></div>
                <div><dt>REALIZED</dt><dd className={realized == null ? '' : realized >= 0 ? 'is-positive' : 'is-negative'}>{formatMoney(realized)}</dd></div>
                <div><dt>PROFIT FACTOR</dt><dd className={pf == null ? '' : pf >= 1 ? 'is-positive' : 'is-negative'}>{ratio(pf)}</dd></div>
                <div><dt>EXPECTANCY</dt><dd className={expectancy == null ? '' : expectancy >= 0 ? 'is-positive' : 'is-negative'}>{formatMoney(expectancy)}</dd></div>
                <div><dt>PAYOFF</dt><dd>{ratio(cohort?.payoffRatio)}</dd></div>
                <div><dt>MAX DD</dt><dd>{formatMoney(cohort?.maxDrawdown)}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
