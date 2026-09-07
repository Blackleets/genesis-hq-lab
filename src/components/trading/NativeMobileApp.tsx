import { useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bot,
  ChevronRight,
  Database,
  FlaskConical,
  LockKeyhole,
  RefreshCw,
  Shield,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { MarketChart } from './MarketChart';
import { ActivePosition } from './ActivePosition';
import { useFounderState, useMarketData, useRunnerTelemetry, useRiskState } from './useTradingDesk';
import { formatPercent, formatPrice, shortSymbol, stateLabel } from './formatters';
import { TRADING_SYMBOLS, TRADING_TIMEFRAMES, type MarketTicker } from './tradingTypes';

type MobileView = 'markets' | 'trade' | 'research' | 'agents';
type TradeTab = 'chart' | 'data' | 'risk' | 'intel';

type ResearchEvent = {
  eventId?: string;
  family?: string;
  stage?: string;
  economicVerdict?: string | null;
  noveltyDecision?: string | null;
  researchComputeAuthority?: boolean;
};

type ExtendedRunner = {
  researchPipeline?: {
    engineVersion?: string | null;
    summary?: {
      proposalsTracked?: number;
      economicBlocked?: number;
      backtestAllowed?: number;
      ledgerSealed?: number;
      computeAuthorities?: number;
    } | null;
    latest?: ResearchEvent[];
  } | null;
  researchLedger?: {
    summary?: { experiments?: number; noGo?: number; researchGo?: number; sealedHoldouts?: number } | null;
  } | null;
};

type FounderAgent = {
  id?: string;
  name?: string;
  role?: string;
  desk?: string;
  mission?: string;
  status?: string;
  mode?: string;
  blockers?: string[];
};

type FounderConnector = {
  id?: string;
  name?: string;
  category?: string;
  status?: string;
  mode?: string;
  blockers?: string[];
};

function unavailableTicker(symbol: typeof TRADING_SYMBOLS[number]): MarketTicker {
  return { symbol, lastPrice: null, changePct: null, quoteVolume: null, updatedAt: null, state: 'unavailable', source: 'binance_spot_public' };
}

function compact(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
    : '—';
}

function timeLabel(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

function clean(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ').toUpperCase() : 'UNAVAILABLE';
}

function statusTone(value: string | null | undefined) {
  const status = (value ?? '').toLowerCase();
  if (status.includes('locked') || status.includes('block') || status.includes('missing')) return 'is-danger';
  if (status.includes('ready') || status.includes('online') || status.includes('active')) return 'is-positive';
  return 'is-muted';
}

export function NativeMobileApp({ onControl }: { onControl: () => void }) {
  const [view, setView] = useState<MobileView>('trade');
  const [tradeTab, setTradeTab] = useState<TradeTab>('chart');
  const { symbol, setSymbol, timeframe, setTimeframe, market, refresh } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const founder = useFounderState();
  const { truth } = useRiskState();

  const rows = market.data?.watchlist ?? TRADING_SYMBOLS.map(unavailableTicker);
  const selected = rows.find((row) => row.symbol === symbol) ?? rows[0];
  const change = selected?.changePct ?? market.data?.changePct ?? null;
  const positive = (change ?? 0) >= 0;
  const riskBand = truth.data?.execution?.globalRisk?.band ?? truth.data?.globalRisk?.band ?? 'UNVERIFIED';
  const extended = runner as (typeof runner & ExtendedRunner) | null | undefined;
  const pipeline = extended?.researchPipeline;
  const pipelineSummary = pipeline?.summary;
  const ledger = extended?.researchLedger?.summary;
  const researchEvents = Array.isArray(pipeline?.latest) ? pipeline.latest.slice(0, 4) : [];
  const agents = Array.isArray(founder.data?.agents) ? founder.data.agents as FounderAgent[] : [];
  const connectors = Array.isArray(founder.data?.connectors) ? founder.data.connectors as FounderConnector[] : [];
  const founderLocked = founder.data?.mode === 'live_locked' || founder.data?.cutover?.canExecute === false;
  const runnerReady = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const cards = useMemo(() => rows.slice(0, 4), [rows]);
  const sourceLabel = market.data?.market?.replaceAll('_', ' ').toUpperCase() ?? 'UNAVAILABLE';

  return (
    <main className="genesis-native-mobile genesis-exchange-mobile" data-ui="genesis-exchange-mobile-v2">
      <header className="gxv2-topbar">
        <button type="button" className="gxv2-wordmark" onClick={() => setView('markets')} aria-label="Open markets">
          <span>G</span>
          <div><strong>GENESIS</strong><small>QUANT FUTURES</small></div>
        </button>
        <div className="gxv2-topbar-actions">
          <button type="button" onClick={refresh} aria-label="Refresh market data"><RefreshCw size={20} /></button>
          <button type="button" onClick={onControl} aria-label="Open founder control"><Shield size={20} /></button>
        </div>
      </header>

      <div className="gxv2-scroll">
        {view === 'markets' ? (
          <section className="gxv2-screen gxv2-markets-screen">
            <div className="gxv2-page-title">
              <span>REAL MARKET DATA</span>
              <h1>Markets</h1>
              <p>Live reference prices. Trading authority remains PAPER only.</p>
            </div>

            <div className="gxv2-segmented" role="tablist" aria-label="Market categories">
              <button type="button" className="is-active">Futures</button>
              <button type="button">Watchlist</button>
              <button type="button">Research</button>
            </div>

            <div className="gxv2-market-cards" aria-label="Market highlights">
              {cards.map((row) => {
                const up = (row.changePct ?? 0) >= 0;
                return (
                  <button key={row.symbol} type="button" className="gxv2-market-card" onClick={() => { setSymbol(row.symbol); setTradeTab('chart'); setView('trade'); }}>
                    <div><span className="gxv2-token">{shortSymbol(row.symbol).slice(0, 1)}</span><strong>{shortSymbol(row.symbol)}</strong></div>
                    <b>{formatPrice(row.lastPrice)}</b>
                    <small className={row.changePct == null ? '' : up ? 'is-positive' : 'is-danger'}>{formatPercent(row.changePct)}</small>
                    <span className={`gxv2-spark ${up ? 'is-positive' : 'is-danger'}`}>{up ? <TrendingUp size={28} /> : <TrendingDown size={28} />}</span>
                  </button>
                );
              })}
            </div>

            <div className="gxv2-section-head"><div><span>MARKETS</span><h2>Futures universe</h2></div><small>{sourceLabel}</small></div>
            <div className="gxv2-market-list">
              {rows.map((row) => {
                const up = (row.changePct ?? 0) >= 0;
                return (
                  <button key={row.symbol} type="button" className="gxv2-market-row" onClick={() => { setSymbol(row.symbol); setTradeTab('chart'); setView('trade'); }}>
                    <span className="gxv2-token gxv2-token--list">{shortSymbol(row.symbol).slice(0, 1)}</span>
                    <div className="gxv2-market-name"><strong>{shortSymbol(row.symbol)}<small>/USDT</small></strong><span>{row.state.toUpperCase()} · PAPER</span></div>
                    <div className="gxv2-market-quote"><strong>{formatPrice(row.lastPrice)}</strong><span className={row.changePct == null ? '' : up ? 'is-positive' : 'is-danger'}>{formatPercent(row.changePct)}</span></div>
                    <ChevronRight size={20} />
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {view === 'trade' ? (
          <section className="gxv2-screen gxv2-trade-screen">
            <div className="gxv2-assetbar">
              <div className="gxv2-asset-identity">
                <span className="gxv2-token gxv2-token--hero">{shortSymbol(symbol).slice(0, 1)}</span>
                <div><strong>{shortSymbol(symbol)}<small>/USDT</small></strong><span>BINANCE REFERENCE · PAPER FUTURES</span></div>
              </div>
              <button type="button" className="gxv2-market-switch" onClick={() => setView('markets')}>Markets <ChevronRight size={17} /></button>
            </div>

            <nav className="gxv2-asset-tabs" aria-label="Asset detail tabs">
              {(['chart', 'data', 'risk', 'intel'] as TradeTab[]).map((tab) => <button key={tab} type="button" className={tradeTab === tab ? 'is-active' : ''} onClick={() => setTradeTab(tab)}>{tab[0].toUpperCase() + tab.slice(1)}</button>)}
            </nav>

            {tradeTab === 'chart' ? (
              <>
                <div className="gxv2-price-panel">
                  <div className="gxv2-price-main"><strong>{formatPrice(market.data?.lastPrice)}</strong><span className={change == null ? '' : positive ? 'is-positive' : 'is-danger'}>{formatPercent(change)}</span></div>
                  <div className="gxv2-price-meta">
                    <div><span>Data</span><strong>{stateLabel(market.state)}</strong></div>
                    <div><span>Volume</span><strong>{compact(selected?.quoteVolume)}</strong></div>
                    <div><span>Risk</span><strong>{riskBand}</strong></div>
                    <div><span>Updated</span><strong>{timeLabel(market.data?.updatedAt)}</strong></div>
                  </div>
                </div>

                <div className="gxv2-mode-strip">
                  <span className="is-paper">PAPER</span>
                  <span className={runnerReady ? 'is-positive' : 'is-muted'}>{runnerReady ? 'RUNNER READY' : 'RUNNER UNVERIFIED'}</span>
                  <span className={founderLocked ? 'is-danger' : 'is-muted'}><LockKeyhole size={13} /> {founderLocked ? 'LIVE LOCKED' : 'LIVE UNVERIFIED'}</span>
                </div>

                <div className="gxv2-timeframes" aria-label="Chart timeframe">
                  {TRADING_TIMEFRAMES.map((item) => <button key={item} type="button" className={timeframe === item ? 'is-active' : ''} onClick={() => setTimeframe(item)}>{item}</button>)}
                  <span>More</span>
                </div>

                <div className="gxv2-chart-shell"><MarketChart positionOverlay={false} chrome="canvas" /></div>
                <div className="gxv2-chart-tools"><span>CANDLES</span><span>VOLUME</span><span>PAPER OVERLAYS</span><strong>REAL DATA</strong></div>

                <div className="gxv2-section-head gxv2-section-head--position"><div><span>PAPER EXECUTION</span><h2>My position</h2></div><small>TRUTH LAYER</small></div>
                <div className="gxv2-position-shell"><ActivePosition /></div>
              </>
            ) : null}

            {tradeTab === 'data' ? (
              <div className="gxv2-detail-stack">
                <div className="gxv2-section-head"><div><span>MARKET DATA</span><h2>Verified snapshot</h2></div><Database size={20} /></div>
                <div className="gxv2-detail-grid">
                  <article><span>Last price</span><strong>{formatPrice(market.data?.lastPrice)}</strong><small>{shortSymbol(symbol)}/USDT</small></article>
                  <article><span>Change</span><strong className={change == null ? '' : positive ? 'is-positive' : 'is-danger'}>{formatPercent(change)}</strong><small>Market ticker</small></article>
                  <article><span>Quote volume</span><strong>{compact(selected?.quoteVolume)}</strong><small>Reference feed</small></article>
                  <article><span>Updated</span><strong>{timeLabel(market.data?.updatedAt)}</strong><small>{sourceLabel}</small></article>
                </div>
                <div className="gxv2-info-card"><Activity size={18} /><div><strong>{stateLabel(market.state)}</strong><span>No synthetic price or candle is rendered when the market feed is unavailable.</span></div></div>
              </div>
            ) : null}

            {tradeTab === 'risk' ? (
              <div className="gxv2-detail-stack">
                <div className="gxv2-section-head"><div><span>FOUNDER SAFETY</span><h2>Risk & execution</h2></div><Shield size={20} /></div>
                <div className="gxv2-risk-hero"><span>Current risk band</span><strong>{riskBand}</strong><small>System evidence only · not an investment recommendation</small></div>
                <div className="gxv2-detail-list">
                  <div><span>Mode</span><strong>PAPER</strong></div>
                  <div><span>Live execution</span><strong className="is-danger">{founderLocked ? 'LOCKED' : 'UNVERIFIED'}</strong></div>
                  <div><span>Founder readiness</span><strong>{founder.data?.readiness ?? 'UNAVAILABLE'}</strong></div>
                  <div><span>Can execute</span><strong className="is-danger">NO</strong></div>
                  <div><span>Runner</span><strong>{runnerReady ? 'VERIFIED PAPER' : 'UNVERIFIED'}</strong></div>
                </div>
              </div>
            ) : null}

            {tradeTab === 'intel' ? (
              <div className="gxv2-detail-stack">
                <div className="gxv2-section-head"><div><span>QUANT INTELLIGENCE</span><h2>Research state</h2></div><FlaskConical size={20} /></div>
                <div className="gxv2-detail-grid">
                  <article><span>Tracked</span><strong>{pipelineSummary?.proposalsTracked ?? '—'}</strong><small>Hypotheses</small></article>
                  <article><span>Backtest</span><strong>{pipelineSummary?.backtestAllowed ?? '—'}</strong><small>Research only</small></article>
                  <article><span>Sealed</span><strong>{pipelineSummary?.ledgerSealed ?? ledger?.experiments ?? '—'}</strong><small>Ledger</small></article>
                  <article><span>No-Go</span><strong className="is-danger">{ledger?.noGo ?? '—'}</strong><small>Preserved memory</small></article>
                </div>
                <button type="button" className="gxv2-primary-link" onClick={() => setView('research')}>Open research pipeline <ChevronRight size={18} /></button>
              </div>
            ) : null}
          </section>
        ) : null}

        {view === 'research' ? (
          <section className="gxv2-screen gxv2-research-screen">
            <div className="gxv2-page-title"><span>EVIDENCE FIRST</span><h1>Research</h1><p>Genesis kills weak hypotheses before capital. No near-miss becomes GO.</p></div>
            <div className="gxv2-research-summary">
              <article><span>Tracked</span><strong>{pipelineSummary?.proposalsTracked ?? '—'}</strong></article>
              <article><span>Economics blocked</span><strong className="is-danger">{pipelineSummary?.economicBlocked ?? '—'}</strong></article>
              <article><span>Backtest allowed</span><strong>{pipelineSummary?.backtestAllowed ?? '—'}</strong></article>
              <article><span>No-Go memory</span><strong className="is-danger">{ledger?.noGo ?? '—'}</strong></article>
            </div>
            <div className="gxv2-section-head"><div><span>{pipeline?.engineVersion?.toUpperCase() ?? 'QRP'}</span><h2>Latest pipeline</h2></div><small>READ ONLY</small></div>
            <div className="gxv2-event-list">
              {researchEvents.length ? researchEvents.map((event, index) => (
                <article key={event.eventId ?? `${event.family}-${index}`}>
                  <div><span className="gxv2-event-icon"><FlaskConical size={17} /></span><div><strong>{clean(event.family)}</strong><small>{clean(event.stage)}</small></div></div>
                  <div className="gxv2-event-verdict"><strong className={event.economicVerdict === 'FAIL_ECONOMICS' ? 'is-danger' : ''}>{clean(event.economicVerdict ?? event.noveltyDecision)}</strong><span>{event.researchComputeAuthority ? 'COMPUTE AUTHORIZED' : 'NO COMPUTE AUTHORITY'}</span></div>
                </article>
              )) : <div className="gxv2-empty">Research pipeline events unavailable. No opportunity inferred.</div>}
            </div>
          </section>
        ) : null}

        {view === 'agents' ? (
          <section className="gxv2-screen gxv2-agents-screen">
            <div className="gxv2-page-title"><span>OPERATIONS</span><h1>Agents</h1><p>Real founder-contract state. No simulated agent activity.</p></div>
            <div className="gxv2-agent-list">
              {agents.length ? agents.map((agent) => (
                <article key={agent.id ?? agent.name}>
                  <span className="gxv2-agent-mark">{(agent.name ?? agent.id ?? '?').slice(0, 1)}</span>
                  <div><strong>{agent.name ?? agent.id ?? 'UNAVAILABLE'}</strong><span>{agent.role ?? agent.desk ?? 'ROLE UNAVAILABLE'}</span><small>{agent.mission ?? 'No current mission reported'}</small></div>
                  <b className={statusTone(agent.status)}>{clean(agent.status)}</b>
                </article>
              )) : <div className="gxv2-empty">Agent state unavailable.</div>}
            </div>

            <div className="gxv2-section-head gxv2-section-head--connectors"><div><span>HERMES</span><h2>Connectors</h2></div><small>NO CREDENTIALS EXPOSED</small></div>
            <div className="gxv2-connector-list">
              {connectors.map((connector) => (
                <article key={connector.id ?? connector.name}>
                  <div><span className={`gxv2-dot ${statusTone(connector.status)}`} /><div><strong>{connector.name ?? connector.id ?? 'UNAVAILABLE'}</strong><small>{clean(connector.category)} · {clean(connector.mode)}</small></div></div>
                  <b className={statusTone(connector.status)}>{clean(connector.status)}</b>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <nav className="gxv2-bottomnav" aria-label="Genesis navigation">
        <button type="button" onClick={() => setView('markets')} className={view === 'markets' ? 'is-active' : ''}><TrendingUp size={22} /><span>Markets</span></button>
        <button type="button" onClick={() => setView('trade')} className={view === 'trade' ? 'is-active' : ''}><BarChart3 size={22} /><span>Trade</span></button>
        <button type="button" onClick={() => setView('research')} className={view === 'research' ? 'is-active' : ''}><FlaskConical size={22} /><span>Research</span></button>
        <button type="button" onClick={() => setView('agents')} className={view === 'agents' ? 'is-active' : ''}><Bot size={22} /><span>Agents</span></button>
        <button type="button" onClick={onControl}><Shield size={22} /><span>Control</span></button>
      </nav>
    </main>
  );
}
