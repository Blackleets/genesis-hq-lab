import { formatMoney, heartbeatLabel, stateLabel } from './formatters';
import { useFounderState, useMarketData, useRunnerTelemetry } from './useTradingDesk';

type RailTone = 'good' | 'warn' | 'bad' | 'neutral';

function RailMetric({ label, value, tone = 'neutral' }: { label: string; value: string; tone?: RailTone }) {
  return (
    <div className={`desk-status-rail__metric desk-status-rail__metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function DeskStatusRail() {
  const { symbol, timeframe, market } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const founder = useFounderState();

  const runnerVerified = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const openPaper = runner?.stats?.openPositions ?? runner?.openPositions?.length ?? null;
  const samplePnl = runner?.stats?.sampleRealizedPnl;
  const samplePnlTone: RailTone = typeof samplePnl === 'number' && Number.isFinite(samplePnl)
    ? samplePnl > 0 ? 'good' : samplePnl < 0 ? 'bad' : 'neutral'
    : 'neutral';
  const marketInstrument = market.state === 'ready'
    ? `${symbol.replace('USDT', '')}/USDT · ${timeframe}`
    : stateLabel(market.state);
  const marketSource = market.data?.market === 'binance_spot_public' ? 'BINANCE SPOT REF' : 'UNAVAILABLE';
  const cutover = founder.state === 'ready' && founder.data
    ? founder.data.readiness.replaceAll('_', ' ')
    : stateLabel(founder.state);
  const cutoverTone: RailTone = founder.state === 'ready' && founder.data?.readiness === 'READY_FOR_EXTERNAL_CUTOVER' ? 'warn' : 'bad';

  return (
    <section className="desk-status-rail" aria-label="Verified desk tape" data-source="REAL WORKSTATION TELEMETRY">
      <div className="desk-status-rail__identity">
        <i />
        <span>GENESIS DESK TAPE</span>
      </div>
      <RailMetric label="MARKET" value={marketInstrument} tone={market.state === 'ready' ? 'good' : market.state === 'stale' ? 'warn' : 'bad'} />
      <RailMetric label="SOURCE" value={marketSource} />
      <RailMetric label="RUNNER" value={runnerVerified ? `CYCLE ${runner?.totalCycles ?? '—'}` : 'NOT VERIFIED'} tone={runnerVerified ? 'good' : 'bad'} />
      <RailMetric label="OPEN PAPER" value={openPaper == null ? 'UNAVAILABLE' : String(openPaper)} tone={openPaper && openPaper > 0 ? 'warn' : 'neutral'} />
      <RailMetric label="SAMPLE P&L" value={formatMoney(samplePnl)} tone={samplePnlTone} />
      <RailMetric label="HEARTBEAT" value={heartbeatLabel(runner?.lastTickAt)} tone={runnerVerified ? 'good' : 'bad'} />
      <RailMetric label="CUTOVER" value={cutover} tone={cutoverTone} />
    </section>
  );
}
