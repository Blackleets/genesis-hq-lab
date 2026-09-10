import { CoinLogo } from './CoinLogo';
import { useMemo } from 'react';
import { Activity, WifiOff } from 'lucide-react';
import QuantChart, { type ChartTrade } from '@workflows/QuantChart';
import { useExecutions, useMarketData, usePaperPositions, useRunnerTelemetry } from './useTradingDesk';
import { formatPercent, formatPrice, stateLabel } from './formatters';
import { TRADING_TIMEFRAMES } from './tradingTypes';
import { ActivePosition } from './ActivePosition';
import './mobileTradingFixes.css';

function readDecisionField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function MarketChart({ positionOverlay = true }: { positionOverlay?: boolean }) {
  const { symbol, timeframe, setTimeframe, market } = useMarketData();
  const executions = useExecutions();
  const positions = usePaperPositions();
  const { runner } = useRunnerTelemetry();
  const symbolPositions = (positions.data ?? []).filter((trade) => trade.pair === symbol);
  const symbolExecutions = (executions.data ?? []).filter((trade) => trade.pair === symbol && trade.status === 'closed');

  const trades = useMemo<ChartTrade[]>(() => {
    const byId = new Map([...(executions.data ?? []), ...(positions.data ?? [])].map((trade) => [trade.id, trade]));
    const decisions = Array.isArray(runner?.lastResult?.decisions) ? runner.lastResult.decisions : [];

    return [...byId.values()]
      .filter((trade) => trade.pair === symbol && trade.openedAt && trade.entryPrice != null)
      .map((trade) => {
        const latestPairDecision = decisions.find((decision) => {
          const decisionPair = readDecisionField(decision?.pair);
          const decisionSide = readDecisionField(decision?.side);
          return decisionPair === trade.pair && (!decisionSide || decisionSide.toUpperCase() === trade.side);
        }) ?? null;

        return {
          id: trade.id,
          pair: trade.pair,
          openedAt: trade.openedAt!,
          closedAt: trade.closedAt,
          side: trade.side,
          entry: trade.entryPrice!,
          exit: trade.exitPrice,
          reason: trade.exitReason,
          pnlUsd: trade.pnl,
          target: trade.targetPrice,
          stop: trade.stopPrice,
          status: trade.status,
          leverage: trade.leverage,
          capitalUsed: trade.capitalUsed,
          mode: trade.mode,
          tradeType: trade.tradeType,
          strategyVersionId: trade.strategyVersionId,
          entryRegime: trade.entryRegime,
          entrySession: trade.entrySession,
          runnerVersion: trade.runnerVersion,
          validationStatus: trade.validationStatus,
          latestDecisionReason: readDecisionField(latestPairDecision?.reason),
          latestDecisionStatus: readDecisionField(latestPairDecision?.status),
          decisionProfile: readDecisionField(latestPairDecision?.profile),
        };
      });
  }, [executions.data, positions.data, runner?.lastResult?.decisions, symbol]);

  const change = market.data?.changePct;

  return (
    <section className="market-chart" aria-label="Main trading chart" data-source="MARKET DATA">
      <div className="market-chart__toolbar">
        <div className="market-chart__instrument">
          <strong className="coin-identity"><CoinLogo symbol={symbol} />{symbol.replace('USDT', '/USDT')}</strong>
          <span>BINANCE SPOT REFERENCE</span>
          <i className={symbolPositions.length ? 'is-bot-active' : ''}>
            {symbolPositions.length
              ? `BOT ACTIVE · ${symbolPositions.length} OPEN · TRACE ON`
              : `${symbolExecutions.length} BOT TRADES · PAPER TRACE`}
          </i>
        </div>
        <div className="market-chart__timeframes" aria-label="Chart timeframe">
          {TRADING_TIMEFRAMES.map((item) => <button key={item} type="button" onClick={() => setTimeframe(item)} className={timeframe === item ? 'is-active' : ''} aria-pressed={timeframe === item}>{item}</button>)}
        </div>
        <div className="market-chart__quote">
          <strong>{formatPrice(market.data?.lastPrice)}</strong>
          <span className={change == null ? 'text-zinc-600' : change >= 0 ? 'text-emerald-300' : 'text-red-300'}>{formatPercent(change)} <small>{timeframe} WINDOW</small></span>
        </div>
        <span className={`market-chart__state market-chart__state--${market.state}`}><i />{stateLabel(market.state)}</span>
      </div>
      <div className="market-chart__canvas">
        {market.data?.candles.length ? <QuantChart candles={market.data.candles} trades={trades} seriesKey={`${symbol}:${timeframe}`} /> : (
          <div className="market-chart__empty">
            {market.state === 'error' ? <WifiOff size={20} /> : <Activity size={20} className="animate-pulse" />}
            <strong>{market.state === 'error' ? 'MARKET DATA ERROR' : market.state === 'loading' ? 'LOADING REAL CANDLES' : 'MARKET DATA UNAVAILABLE'}</strong>
            <span>NO SYNTHETIC CHART WILL BE RENDERED</span>
          </div>
        )}
        {positionOverlay ? <ActivePosition overlay /> : null}
        <div className="market-chart__legend">
          <span className="entry">BOT ENTRY</span>
          <span className="tp">TP</span>
          <span className="sl">SL</span>
          <span className="timeout">TIMEOUT</span>
          <b>EXECUTION TRACE · PAPER · REAL CANDLES</b>
        </div>
      </div>
      <div className="market-chart__provenance">
        <span>MARKET DATA</span><strong>{market.data?.market?.replaceAll('_', ' ').toUpperCase() ?? 'UNAVAILABLE'}</strong>
        <span>UPDATED</span><strong>{market.data?.updatedAt ? new Date(market.data.updatedAt).toLocaleTimeString() : 'UNAVAILABLE'}</strong>
        <span>FUTURES MARK</span><strong>UNAVAILABLE</strong>
      </div>
    </section>
  );
}