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

function compactLabel(value: unknown) {
  const text = readDecisionField(value);
  return text ? text.replaceAll('_', ' ').replaceAll('-', ' ').toUpperCase() : null;
}

type BotTone = 'active' | 'watch' | 'offline';

export function MarketChart({ positionOverlay = true }: { positionOverlay?: boolean }) {
  const { symbol, timeframe, setTimeframe, market } = useMarketData();
  const executions = useExecutions();
  const positions = usePaperPositions();
  const { resource: runnerResource, runner } = useRunnerTelemetry();
  const symbolPositions = (positions.data ?? []).filter((trade) => trade.pair === symbol);

  const decisions = useMemo(
    () => Array.isArray(runner?.lastResult?.decisions) ? runner.lastResult.decisions : [],
    [runner?.lastResult?.decisions],
  );

  const latestSymbolDecision = useMemo(
    () => decisions.find((decision) => readDecisionField(decision?.pair) === symbol) ?? null,
    [decisions, symbol],
  );

  const runnerReady = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const activePosition = symbolPositions[0] ?? null;

  const botState = useMemo<{ title: string; detail: string; tone: BotTone }>(() => {
    if (!runnerReady) {
      return {
        title: 'BOT NOT VERIFIED',
        detail: `${stateLabel(runnerResource.state)} · NO EXECUTION`,
        tone: 'offline',
      };
    }

    if (activePosition) {
      const entry = formatPrice(activePosition.entryPrice);
      const target = formatPrice(activePosition.targetPrice);
      const stop = formatPrice(activePosition.stopPrice);
      return {
        title: `POSITION OPEN · ${activePosition.side}`,
        detail: `ENTRY ${entry} · TP ${target} · SL ${stop} · PAPER`,
        tone: 'active',
      };
    }

    if (latestSymbolDecision) {
      const status = compactLabel(latestSymbolDecision.status) ?? 'EVALUATED';
      const reason = compactLabel(latestSymbolDecision.reason) ?? 'NO ENTRY';
      return {
        title: `SCANNING · ${status}`,
        detail: `${reason} · PAPER ONLY`,
        tone: 'watch',
      };
    }

    return {
      title: 'SCANNING · WAITING SIGNAL',
      detail: `RUNNER ACTIVE · NO ENTRY FOR ${symbol.replace('USDT', '/USDT')}`,
      tone: 'watch',
    };
  }, [activePosition, latestSymbolDecision, runnerReady, runnerResource.state, symbol]);

  const trades = useMemo<ChartTrade[]>(() => {
    const byId = new Map([...(executions.data ?? []), ...(positions.data ?? [])].map((trade) => [trade.id, trade]));

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
  }, [decisions, executions.data, positions.data, symbol]);

  const change = market.data?.changePct;

  return (
    <section className="market-chart" aria-label="Main trading chart" data-source="MARKET DATA">
      <div className="market-chart__toolbar">
        <div className="market-chart__instrument">
          <strong className="coin-identity market-chart__symbol"><CoinLogo symbol={symbol} />{symbol.replace('USDT', '/USDT')}</strong>
          <span className="market-chart__venue market-chart__venue--desktop">BINANCE SPOT REFERENCE</span>
          <span className="market-chart__venue market-chart__venue--mobile">BINANCE · SPOT</span>
          <i className={botState.tone === 'active' ? 'is-bot-active' : ''}>{botState.title}</i>
        </div>
        <div className="market-chart__quote">
          <strong>{formatPrice(market.data?.lastPrice)}</strong>
          <span className={change == null ? 'text-zinc-600' : change >= 0 ? 'text-emerald-300' : 'text-red-300'}>{formatPercent(change)} <small>{timeframe} WINDOW</small></span>
        </div>
        <div className="market-chart__timeframes" aria-label="Chart timeframe">
          {TRADING_TIMEFRAMES.map((item) => <button key={item} type="button" onClick={() => setTimeframe(item)} className={timeframe === item ? 'is-active' : ''} aria-pressed={timeframe === item}>{item}</button>)}
        </div>
        <div className={`market-chart__bot-state market-chart__bot-state--${botState.tone}`} data-source="SYSTEM / DECISION DATA" aria-live="polite">
          <span><Activity size={11} aria-hidden="true" /> BOT</span>
          <strong>{botState.title}</strong>
          <small>{botState.detail}</small>
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
