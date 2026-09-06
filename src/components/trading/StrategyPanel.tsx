import { useMemo } from 'react';
import { FlaskConical } from 'lucide-react';
import { useExecutions } from './useTradingDesk';
import { finite, formatMoney, profileFromTrade } from './formatters';

const PROFILES = ['short_micro', 'short_core', 'short_alt', 'long_probe'] as const;

export function StrategyPanel() {
  const executions = useExecutions();
  const groups = useMemo(() => {
    const closed = (executions.data ?? []).filter((trade) => trade.status === 'closed');
    return PROFILES.map((profile) => {
      const rows = closed.filter((trade) => profileFromTrade(trade) === profile && finite(trade.pnl));
      const wins = rows.filter((trade) => trade.pnl! > 0).length;
      return {
        profile,
        trades: rows.length,
        winRate: rows.length ? (wins / rows.length) * 100 : null,
        pnl: rows.length ? rows.reduce((sum, trade) => sum + trade.pnl!, 0) : null,
      };
    });
  }, [executions.data]);

  return (
    <section className="strategy-panel" data-source="PAPER EXECUTION DATA" aria-label="Strategy performance">
      <div className="strategy-panel__notice">
        <FlaskConical size={13} />
        <span><strong>PAPER LEDGER WINDOW</strong>Research metrics remain unavailable until a verified research contract exists.</span>
      </div>
      <div className="strategy-panel__grid">
        {groups.map((group) => (
          <article key={group.profile} className="strategy-panel__card">
            <div><strong>{group.profile.replace('_', ' ').toUpperCase()}</strong><span>{group.trades ? 'PAPER WINDOW' : 'METRICS UNAVAILABLE'}</span></div>
            <dl>
              <div><dt>TRADES</dt><dd>{group.trades || 'UNAVAILABLE'}</dd></div>
              <div><dt>WIN RATE</dt><dd>{group.winRate == null ? 'UNAVAILABLE' : `${group.winRate.toFixed(1)}%`}</dd></div>
              <div><dt>REALIZED</dt><dd className={group.pnl == null ? '' : group.pnl >= 0 ? 'is-positive' : 'is-negative'}>{formatMoney(group.pnl)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}
