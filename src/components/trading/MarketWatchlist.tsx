import { useMemo } from 'react';
import { Activity } from 'lucide-react';
import { useMarketData, useRunnerTelemetry } from './useTradingDesk';
import { formatPercent, formatPrice, shortSymbol, stateLabel } from './formatters';
import { TRADING_SYMBOLS, type MarketTicker } from './tradingTypes';

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 48},${18 - ((value - min) / range) * 16}`).join(' ');
  return <svg viewBox="0 0 48 20" role="img" aria-label="Recent real price movement"><polyline points={points} fill="none" stroke={positive ? '#34d399' : '#f87171'} strokeWidth="1.25" vectorEffect="non-scaling-stroke" /></svg>;
}

function unavailableTicker(symbol: typeof TRADING_SYMBOLS[number]): MarketTicker {
  return { symbol, lastPrice: null, changePct: null, quoteVolume: null, updatedAt: null, state: 'unavailable', source: 'binance_spot_public' };
}

export function MarketWatchlist({ mobile = false }: { mobile?: boolean }) {
  const { symbol, setSymbol, market } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const rows = market.data?.watchlist ?? TRADING_SYMBOLS.map(unavailableTicker);
  const tracked = useMemo(() => new Set((runner?.lastResult?.decisions ?? []).map((decision) => decision.pair)), [runner?.lastResult?.decisions]);
  const selectedValues = market.data?.candles.slice(-28).map((candle) => candle.close) ?? [];

  return (
    <section className={mobile ? 'market-selector-mobile' : 'market-watchlist'} aria-label="Market watchlist" data-source="MARKET DATA">
      {!mobile ? (
        <div className="terminal-panel-head">
          <div><span>WATCHLIST</span><small>BINANCE SPOT REF</small></div>
          <Activity size={13} className={market.state === 'ready' ? 'text-cyan-300' : 'text-zinc-600'} />
        </div>
      ) : null}
      <div className={mobile ? 'market-selector-mobile__track' : 'market-watchlist__rows'}>
        {rows.map((row) => {
          const active = row.symbol === symbol;
          const positive = (row.changePct ?? 0) >= 0;
          const isTracked = runner?.agentAlive === true && tracked.has(row.symbol);
          return (
            <button key={row.symbol} type="button" onClick={() => setSymbol(row.symbol)} className={`${mobile ? 'market-selector-mobile__item' : 'market-watchlist__row'} ${active ? 'is-active' : ''}`} aria-pressed={active}>
              <div className="market-watchlist__primary">
                <strong>{shortSymbol(row.symbol)}<span>USDT</span></strong>
                {!mobile && active ? <Sparkline values={selectedValues} positive={positive} /> : null}
                <b>{formatPrice(row.lastPrice)}</b>
              </div>
              <div className="market-watchlist__secondary">
                <span className={row.changePct == null ? 'text-zinc-600' : positive ? 'text-emerald-300' : 'text-red-300'}>{formatPercent(row.changePct)}</span>
                {!mobile ? <span className={isTracked ? 'is-watching' : ''}><i />{isTracked ? 'RUNNER WATCHING' : runner ? 'NO CYCLE SIGNAL' : 'STATUS UNAVAILABLE'}</span> : null}
                {mobile && row.state !== 'ready' ? <span>{stateLabel(row.state)}</span> : null}
              </div>
            </button>
          );
        })}
      </div>
      {!mobile ? <div className="market-watchlist__foot"><span>FUNDING</span><b>UNAVAILABLE</b><span>OI</span><b>UNAVAILABLE</b><span>SPREAD</span><b>UNAVAILABLE</b></div> : null}
    </section>
  );
}
