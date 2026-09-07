import { useMemo, useState } from 'react';
import {
  BarChart3,
  Bot,
  ChevronRight,
  FlaskConical,
  LockKeyhole,
  RefreshCw,
  Shield,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { MarketChart } from './MarketChart';
import { ActivePosition } from './ActivePosition';
import { AgentBar } from './AgentBar';
import { ConnectorRack } from './ConnectorRack';
import { ResearchOpportunitySurface } from './ResearchOpportunitySurface';
import { useFounderState, useMarketData, useRunnerTelemetry, useRiskState } from './useTradingDesk';
import { formatPercent, formatPrice, shortSymbol, stateLabel } from './formatters';
import { TRADING_SYMBOLS, type MarketTicker } from './tradingTypes';

type MobileView = 'markets' | 'trade' | 'research' | 'agents';

function unavailableTicker(symbol: typeof TRADING_SYMBOLS[number]): MarketTicker {
  return { symbol, lastPrice: null, changePct: null, quoteVolume: null, updatedAt: null, state: 'unavailable', source: 'binance_spot_public' };
}

function SectionTitle({ eyebrow, title, action }: { eyebrow: string; title: string; action?: string }) {
  return (
    <div className="native-mobile-section-title">
      <div><span>{eyebrow}</span><strong>{title}</strong></div>
      {action ? <small>{action}</small> : null}
    </div>
  );
}

export function NativeMobileApp({ onControl }: { onControl: () => void }) {
  const [view, setView] = useState<MobileView>('trade');
  const { symbol, setSymbol, market, refresh } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const founder = useFounderState();
  const { truth } = useRiskState();
  const rows = market.data?.watchlist ?? TRADING_SYMBOLS.map(unavailableTicker);
  const selected = rows.find((row) => row.symbol === symbol) ?? rows[0];
  const change = selected?.changePct ?? market.data?.changePct ?? null;
  const positive = (change ?? 0) >= 0;
  const runnerReady = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const founderLocked = founder.data?.mode === 'live_locked' || founder.data?.cutover?.canExecute === false;
  const riskBand = truth.data?.execution?.globalRisk?.band ?? truth.data?.globalRisk?.band ?? 'UNVERIFIED';
  const sourceLabel = market.data?.market?.replaceAll('_', ' ').toUpperCase() ?? 'MARKET SOURCE UNAVAILABLE';
  const cards = useMemo(() => rows.slice(0, 6), [rows]);

  return (
    <main className="genesis-native-mobile" data-ui="genesis-native-mobile-v1">
      <header className="native-mobile-topbar">
        <div className="native-mobile-brand">
          <div className="native-mobile-brand__mark" aria-hidden="true"><span>G</span></div>
          <div><strong>GENESIS</strong><small>QUANT FUTURES</small></div>
        </div>
        <div className="native-mobile-topbar__actions">
          <button type="button" onClick={refresh} aria-label="Refresh market data"><RefreshCw size={18} /></button>
          <button type="button" onClick={onControl} aria-label="Open founder control"><Shield size={18} /></button>
        </div>
      </header>

      <div className="native-mobile-statusbar">
        <span className="is-paper"><i /> PAPER</span>
        <span className={market.state === 'ready' ? 'is-good' : 'is-warn'}><i /> {stateLabel(market.state)}</span>
        <span className={runnerReady ? 'is-good' : 'is-warn'}><i /> {runnerReady ? 'RUNNER ACTIVE' : 'RUNNER UNVERIFIED'}</span>
        <span className={founderLocked ? 'is-locked' : 'is-warn'}><LockKeyhole size={11} /> {founderLocked ? 'LIVE LOCKED' : 'LIVE STATE UNVERIFIED'}</span>
      </div>

      <section className="native-mobile-content">
        {view === 'markets' ? (
          <div className="native-mobile-screen native-mobile-markets-screen">
            <SectionTitle eyebrow="REAL MARKET DATA" title="Markets" action={sourceLabel} />
            <div className="native-mobile-market-cards" aria-label="Market shortcuts">
              {cards.slice(0, 3).map((row) => {
                const up = (row.changePct ?? 0) >= 0;
                return (
                  <button key={`card-${row.symbol}`} type="button" onClick={() => { setSymbol(row.symbol); setView('trade'); }} className="native-mobile-market-card">
                    <div><strong>{shortSymbol(row.symbol)}</strong><span>/USDT</span></div>
                    <b>{formatPrice(row.lastPrice)}</b>
                    <small className={row.changePct == null ? '' : up ? 'is-positive' : 'is-negative'}>{formatPercent(row.changePct)}</small>
                    <span className="native-mobile-market-card__spark">{up ? <TrendingUp size={23} /> : <TrendingDown size={23} />}</span>
                  </button>
                );
              })}
            </div>

            <SectionTitle eyebrow="WATCHLIST" title="Futures universe" action="SPOT REFERENCE · PAPER ONLY" />
            <div className="native-mobile-market-list">
              {rows.map((row) => {
                const up = (row.changePct ?? 0) >= 0;
                return (
                  <button key={row.symbol} type="button" onClick={() => { setSymbol(row.symbol); setView('trade'); }} className="native-mobile-market-row">
                    <span className="native-mobile-token-mark">{shortSymbol(row.symbol).slice(0, 1)}</span>
                    <div className="native-mobile-market-row__name"><strong>{shortSymbol(row.symbol)}</strong><span>USDT · {row.state.toUpperCase()}</span></div>
                    <div className="native-mobile-market-row__quote"><strong>{formatPrice(row.lastPrice)}</strong><span className={row.changePct == null ? '' : up ? 'is-positive' : 'is-negative'}>{formatPercent(row.changePct)}</span></div>
                    <ChevronRight size={18} />
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {view === 'trade' ? (
          <div className="native-mobile-screen native-mobile-trade-screen">
            <div className="native-mobile-instrument-hero">
              <div className="native-mobile-instrument-hero__top">
                <div>
                  <span className="native-mobile-token-mark native-mobile-token-mark--hero">{shortSymbol(symbol).slice(0, 1)}</span>
                  <div><strong>{shortSymbol(symbol)}<small>/USDT</small></strong><span>BINANCE SPOT REFERENCE · PAPER FUTURES</span></div>
                </div>
                <button type="button" onClick={() => setView('markets')}>MARKETS <ChevronRight size={15} /></button>
              </div>
              <div className="native-mobile-price-block">
                <strong>{formatPrice(market.data?.lastPrice)}</strong>
                <span className={change == null ? '' : positive ? 'is-positive' : 'is-negative'}>{formatPercent(change)}</span>
              </div>
              <div className="native-mobile-instrument-meta">
                <span>RISK <b>{riskBand}</b></span>
                <span>MODE <b>PAPER</b></span>
                <span>LIVE <b className="is-danger">LOCKED</b></span>
              </div>
            </div>

            <div className="native-mobile-symbol-strip" aria-label="Quick symbol selector">
              {rows.map((row) => <button key={`chip-${row.symbol}`} type="button" onClick={() => setSymbol(row.symbol)} className={row.symbol === symbol ? 'is-active' : ''}><strong>{shortSymbol(row.symbol)}</strong><span className={(row.changePct ?? 0) >= 0 ? 'is-positive' : 'is-negative'}>{formatPercent(row.changePct)}</span></button>)}
            </div>

            <div className="native-mobile-chart-card"><MarketChart positionOverlay={false} /></div>

            <section className="native-mobile-position-card">
              <SectionTitle eyebrow="PAPER EXECUTION" title="My position" action="TRUTH LAYER" />
              <ActivePosition />
            </section>
          </div>
        ) : null}

        {view === 'research' ? (
          <div className="native-mobile-screen native-mobile-research-screen">
            <SectionTitle eyebrow="EVIDENCE FIRST" title="Research" action="NO-GO MEMORY PRESERVED" />
            <div className="native-mobile-research-hero">
              <div className="native-mobile-research-icon"><FlaskConical size={22} /></div>
              <div><strong>Quant Research Pipeline</strong><span>Novelty → Economics → Backtest → Ledger</span></div>
              <Sparkles size={18} />
            </div>
            <ResearchOpportunitySurface onOpenResearch={() => undefined} />
            <div className="native-mobile-research-note"><LockKeyhole size={15} /><span>Research compute never grants capital or LIVE execution authority.</span></div>
          </div>
        ) : null}

        {view === 'agents' ? (
          <div className="native-mobile-screen native-mobile-agents-screen">
            <SectionTitle eyebrow="OPERATIONS" title="Agents" action="REAL FOUNDER CONTRACT STATES" />
            <div className="native-mobile-agents-hero"><Bot size={22} /><div><strong>Genesis Agent Floor</strong><span>ATLAS · ORACLE · SENTINEL · FORGE · EXECUTION · AUDITOR · HERMES</span></div></div>
            <AgentBar />
            <ConnectorRack />
          </div>
        ) : null}
      </section>

      <nav className="native-mobile-bottomnav" aria-label="Genesis mobile navigation">
        <button type="button" onClick={() => setView('markets')} className={view === 'markets' ? 'is-active' : ''}><TrendingUp size={20} /><span>Markets</span></button>
        <button type="button" onClick={() => setView('trade')} className={view === 'trade' ? 'is-active' : ''}><BarChart3 size={20} /><span>Trade</span></button>
        <button type="button" onClick={() => setView('research')} className={view === 'research' ? 'is-active' : ''}><FlaskConical size={20} /><span>Research</span></button>
        <button type="button" onClick={() => setView('agents')} className={view === 'agents' ? 'is-active' : ''}><Bot size={20} /><span>Agents</span></button>
        <button type="button" onClick={onControl}><Shield size={20} /><span>Control</span></button>
      </nav>
    </main>
  );
}
