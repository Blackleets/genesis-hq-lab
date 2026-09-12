import { ShieldAlert } from 'lucide-react';
import { useMarketData, usePaperPositions, useRiskState, useRunnerTelemetry } from './useTradingDesk';
import { finite, formatMoney, stateLabel } from './formatters';

type ExtendedRunnerStats = {
  sampleRealizedPnl?: number | null;
  maxDrawdown?: number | null;
};

export function RiskPanel() {
  const positions = usePaperPositions();
  const { market } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const { truth, capture, founder } = useRiskState();
  const risk = truth.state === 'ready' ? truth.data?.execution?.globalRisk ?? truth.data?.globalRisk ?? null : null;
  const stats = runner?.stats as ExtendedRunnerStats | null | undefined;
  const exposure = positions.data && positions.data.every((position) => finite(position.capitalUsed) && finite(position.leverage))
    ? positions.data.reduce((sum, position) => sum + position.capitalUsed! * position.leverage!, 0)
    : null;
  const fundingEconomicPnl = capture.state === 'ready' ? capture.data?.funding?.economicPnlUsdt : null;
  const futuresSamplePnl = truth.state === 'ready' ? stats?.sampleRealizedPnl : null;
  const futuresMaxDrawdown = truth.state === 'ready' ? stats?.maxDrawdown : null;
  const liveLocked = truth.state === 'ready' && capture.state === 'ready' && founder.state === 'ready'
    && runner?.liveOrders === false && capture.data?.liveOff === true && founder.data?.cutover.canExecute === false;

  return (
    <section className="risk-panel" aria-label="Sentinel risk status" data-source="RISK + SLEEVE ECONOMIC TRUTH">
      <div className="terminal-panel-head">
        <div><span>SENTINEL</span><small>RISK + SLEEVE TRUTH</small></div>
        <ShieldAlert size={13} />
      </div>
      <div className="risk-panel__band"><span>RISK STATUS</span><strong className={risk?.band === 'HEALTHY' ? 'text-emerald-300' : risk?.band === 'WATCH' ? 'text-amber-300' : 'text-red-300'}>{risk?.band ?? 'NOT VERIFIED'}</strong></div>
      <dl className="telemetry-list">
        <div><dt>Paper notional</dt><dd>{formatMoney(exposure)}</dd></div>
        <div><dt>Open positions</dt><dd>{positions.data ? positions.data.length : 'UNAVAILABLE'}</dd></div>
        <div><dt>Futures sample P&amp;L</dt><dd className={finite(futuresSamplePnl) ? futuresSamplePnl >= 0 ? 'text-emerald-300' : 'text-red-300' : ''}>{truth.state === 'ready' ? formatMoney(futuresSamplePnl) : stateLabel(truth.state)}</dd></div>
        <div><dt>Futures sample max DD</dt><dd className={finite(futuresMaxDrawdown) && futuresMaxDrawdown > 0 ? 'text-amber-300' : ''}>{truth.state === 'ready' ? formatMoney(futuresMaxDrawdown) : stateLabel(truth.state)}</dd></div>
        <div><dt>Funding economic P&amp;L</dt><dd className={finite(fundingEconomicPnl) ? fundingEconomicPnl >= 0 ? 'text-emerald-300' : 'text-red-300' : ''}>{capture.state === 'ready' ? formatMoney(fundingEconomicPnl) : stateLabel(capture.state)}</dd></div>
        <div><dt>Company P&amp;L</dt><dd>NOT RECONCILED</dd></div>
        <div><dt>Feed freshness</dt><dd>{stateLabel(market.state)}</dd></div>
        <div><dt>Runner</dt><dd>{runner?.agentAlive === true ? 'OK' : runner ? 'STALE' : 'NOT VERIFIED'}</dd></div>
        <div><dt>Live execution</dt><dd className={liveLocked ? 'text-red-300' : 'text-amber-300'}>{liveLocked ? 'LOCKED' : 'NOT VERIFIED'}</dd></div>
      </dl>
    </section>
  );
}
