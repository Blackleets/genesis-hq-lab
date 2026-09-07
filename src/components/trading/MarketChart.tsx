import { useMemo } from 'react';
import { Activity, WifiOff } from 'lucide-react';
import QuantChart, { type ChartTrade } from '@workflows/QuantChart';
import { useExecutions, useMarketData, usePaperPositions } from './useTradingDesk';
import { formatPercent, formatPrice, stateLabel } from './formatters';
import { TRADING_TIMEFRAMES } from './tradingTypes';
import { ActivePosition } from './ActivePosition';

export function MarketChart({ positionOverlay = true }: { positionOverlay?: boolean }) {
  const { symbol, timeframe, setTimeframe, market } = useMarketData();
  const executions = useExecutions();
  const positions = usePaperPositions();
  const trades = useMemo<ChartTrade[]>(() => {
    const byId = new Map([...(executions.data ?? []), ...(positions.data ?? [])].map((trade) => [trade.id, trade]));
    return [...byId.values()].filter((trade) => trade.pair === symbol && trade.openedAt && trade.entryPrice != null).map((trade) => ({
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
    }));
  }, [executions.data, positions.data, symbol]);
  const change = market.data?.changePct;

  return (
    <section className="market-chart" aria-label="Main trading chart" data-source="MARKET DATA">
      <div className="market-chart__toolbar">
        <div className="market-chart__instrument">
          <strong>{symbol.replace('USDT', '/USDT')}</strong>
          <span>BINANCE SPOT REFERENCE</span>
          <i>PAPER FUTURES OVERLAY</i>
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
        <div className="market-chart__legend"><span className="entry">ENTRY</span><span className="tp">TP</span><span className="sl">SL</span><span className="timeout">TIMEOUT</span><b>VOLUME · REAL CANDLES</b></div>
      </div>
      <div className="market-chart__provenance"><span>MARKET DATA</span><strong>{market.data?.market?.replaceAll('_', ' ').toUpperCase() ?? 'UNAVAILABLE'}</strong><span>UPDATED</span><strong>{market.data?.updatedAt ? new Date(market.data.updatedAt).toLocaleTimeString() : 'UNAVAILABLE'}</strong><span>FUTURES MARK</span><strong>UNAVAILABLE</strong></div>
    </section>
  );
}
