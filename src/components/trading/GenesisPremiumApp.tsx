import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  ChevronRight,
  Database,
  FlaskConical,
  LockKeyhole,
  RefreshCw,
  Search,
  Shield,
  SlidersHorizontal,
  Sparkles,
  WalletCards,
} from 'lucide-react';
import { MarketChart } from './MarketChart';
import { ActivePosition } from './ActivePosition';
import { useFounderState, useMarketData, useRunnerTelemetry, useRiskState } from './useTradingDesk';
import { formatPercent, formatPrice, shortSymbol, stateLabel } from './formatters';
import { TRADING_SYMBOLS, TRADING_TIMEFRAMES, type MarketTicker, type TradingSymbol } from './tradingTypes';
import './genesisPremiumApp.css';

const ControlDrawer = lazy(() => import('./ControlDrawer').then((module) => ({ default: module.ControlDrawer })));

type AppView = 'markets' | 'trade' | 'research' | 'agents' | 'control';

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
    summary?: {
      experiments?: number;
      noGo?: number;
      researchGo?: number;
      sealedHoldouts?: number;
    } | null;
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

type FounderSnapshot = {
  mode?: string;
  readiness?: string;
  cutover?: { canExecute?: boolean } | null;
  agents?: FounderAgent[];
  connectors?: FounderConnector[];
};

const NAV: Array<{ id: AppView; label: string; icon: typeof BarChart3 }> = [
  { id: 'markets', label: 'Markets', icon: BarChart3 },
  { id: 'trade', label: 'Trade', icon: SlidersHorizontal },
  { id: 'research', label: 'Research', icon: FlaskConical },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'control', label: 'Control', icon: Shield },
];

function unavailableTicker(symbol: TradingSymbol): MarketTicker {
  return { symbol, lastPrice: null, changePct: null, quoteVolume: null, updatedAt: null, state: 'unavailable', source: 'binance_spot_public' };
}

function compact(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
    : '—';
}

function clean(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ').toUpperCase() : 'UNAVAILABLE';
}

function timeLabel(value: string | null | undefined) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
}

function tone(value: string | null | undefined) {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('ready') || normalized.includes('active') || normalized.includes('online')) return 'is-positive';
  if (normalized.includes('locked') || normalized.includes('block') || normalized.includes('missing')) return 'is-danger';
  return 'is-muted';
}

function CoinLogo({ symbol, size = 38 }: { symbol: string; size?: number }) {
  const coin = shortSymbol(symbol).toUpperCase();
  const common = { width: size, height: size, viewBox: '0 0 32 32', role: 'img' as const, 'aria-label': `${coin} logo` };
  if (coin === 'BTC') return <svg {...common}><circle cx="16" cy="16" r="16" fill="#F7931A"/><path fill="#fff" d="M23.19 14.02c.31-2.1-1.28-3.22-3.47-3.98l.71-2.84-1.73-.43-.69 2.77-1.39-.33.7-2.78L15.6 6l-.71 2.84-3.49-.87-.46 1.85 1.26.31c.7.18.83.64.8 1l-.8 3.24.18.06-.18-.05-1.13 4.53c-.09.21-.3.53-.8.41l-1.26-.31-.86 1.98 2.25.56 1.23.32-.72 2.87 1.73.43.71-2.84 1.38.36-.71 2.83 1.73.43.71-2.87c2.95.56 5.16.33 6.1-2.33.75-2.15-.04-3.39-1.59-4.19 1.13-.26 1.98-1 2.21-2.54Zm-3.95 5.54c-.53 2.15-4.15.99-5.32.7l.95-3.81c1.17.29 4.93.87 4.37 3.11Zm.54-5.57c-.49 1.95-3.5.96-4.47.72l.86-3.45c.97.24 4.12.7 3.61 2.73Z"/></svg>;
  if (coin === 'ETH') return <svg {...common}><circle cx="16" cy="16" r="16" fill="#F5F5F5"/><path fill="#343434" d="m16.14 6-.14.46V19.68l.14.13 6.14-3.62L16.14 6Z"/><path fill="#8C8C8C" d="M16.14 6 10 16.19l6.14 3.62V6Z"/><path fill="#3C3C3B" d="m16.14 20.98-.08.09v4.71l.08.22 6.14-8.65-6.14 3.63Z"/><path fill="#8C8C8C" d="M16.14 26v-5.02L10 17.35 16.14 26Z"/></svg>;
  if (coin === 'SOL') return <svg {...common}><defs><linearGradient id="solA" x1="22" y1="6" x2="9" y2="26"><stop stopColor="#00FFA3"/><stop offset="1" stopColor="#DC1FFF"/></linearGradient></defs><circle cx="16" cy="16" r="16" fill="#050505"/><path fill="url(#solA)" d="M9.34 20.1a.65.65 0 0 1 .46-.19h15.79c.29 0 .43.35.23.55l-3.12 3.12a.65.65 0 0 1-.46.19H6.45a.32.32 0 0 1-.23-.55l3.12-3.12ZM9.34 8.45a.65.65 0 0 1 .46-.19h15.79c.29 0 .43.35.23.55l-3.12 3.12a.65.65 0 0 1-.46.19H6.45a.32.32 0 0 1-.23-.55l3.12-3.12ZM22.7 14.24a.65.65 0 0 0-.46-.19H6.45a.32.32 0 0 0-.23.55l3.12 3.12a.65.65 0 0 0 .46.19h15.79a.32.32 0 0 0 .23-.55l-3.12-3.12Z"/></svg>;
  if (coin === 'BNB') return <svg {...common}><circle cx="16" cy="16" r="16" fill="#F0B90B"/><path fill="#fff" d="m16.15 6-5.31 3.06 1.95 1.14 3.36-1.94 3.36 1.94 1.95-1.14L16.15 6Zm0 5.86-1.95-1.13 1.95-1.13 1.95 1.13-1.95 1.13Zm-3.36-.06-1.95 1.13v2.26l3.36 1.93v3.86l1.95 1.14 1.95-1.14v-3.86l3.36-1.93v-2.26l-1.95-1.13-3.36 1.93-3.36-1.93Z"/></svg>;
  if (coin === 'XRP') return <svg {...common}><circle cx="16" cy="16" r="16" fill="#23292F"/><path fill="#fff" d="M23.07 8h2.89l-6.02 5.96a5.62 5.62 0 0 1-7.89 0L6.04 8h2.89l4.57 4.52a3.56 3.56 0 0 0 5 0L23.07 8ZM8.9 24.56H6l6.05-5.99a5.62 5.62 0 0 1 7.89 0L26 24.56h-2.9L18.5 20a3.56 3.56 0 0 0-5 0l-4.6 4.56Z"/></svg>;
  if (coin === 'DOGE') return <svg {...common}><circle cx="16" cy="16" r="16" fill="#BA9F33"/><path fill="#fff" d="M16.38 10.54h-2.29v4.51h3.6v1.89h-3.6v4.51h2.4c.62 0 5.06.07 5.05-5.25-.01-5.31-4.31-5.66-5.16-5.66Zm.25 13.78h-5.8v-7.38H8.79v-1.89h2.04V7.7h4.98c1.18 0 8.98-.24 8.98 8.81 0 9.2-8.16 8.51-8.16 8.51v-.7Z" transform="scale(.8) translate(4 3)"/></svg>;
  return <span className="gp-token-fallback" style={{ width: size, height: size }}>{coin.slice(0, 1)}</span>;
}

function Brand() {
  return <div className="gp-brand"><span className="gp-brand-mark">G</span><div><strong>GENESIS HQ</strong><small>DISCIPLINE · DATA · AI · FREEDOM</small></div></div>;
}

function StatusStrip({ runnerReady, founderLocked, marketState }: { runnerReady: boolean; founderLocked: boolean; marketState: string }) {
  return <div className="gp-status-strip">
    <span className="is-paper">PAPER</span>
    <span className={marketState === 'ready' ? 'is-positive' : 'is-muted'}>MARKET {stateLabel(marketState as 'ready' | 'loading' | 'stale' | 'unavailable' | 'error')}</span>
    <span className={runnerReady ? 'is-positive' : 'is-muted'}>{runnerReady ? 'RUNNER VERIFIED' : 'RUNNER UNVERIFIED'}</span>
    <span className={founderLocked ? 'is-danger' : 'is-muted'}><LockKeyhole size={12}/> {founderLocked ? 'LIVE LOCKED' : 'LIVE UNVERIFIED'}</span>
  </div>;
}

function MarketRow({ row, active, onOpen }: { row: MarketTicker; active?: boolean; onOpen: () => void }) {
  const up = (row.changePct ?? 0) >= 0;
  return <button type="button" className={`gp-market-row ${active ? 'is-active' : ''}`} onClick={onOpen}>
    <CoinLogo symbol={row.symbol} size={38}/>
    <span className="gp-market-copy"><strong>{shortSymbol(row.symbol)}<small>/USDT</small></strong><em>{row.state.toUpperCase()} · PAPER</em></span>
    <span className="gp-market-price"><strong>{formatPrice(row.lastPrice)}</strong><em className={row.changePct == null ? '' : up ? 'is-positive' : 'is-danger'}>{formatPercent(row.changePct)}</em></span>
    <ChevronRight size={18}/>
  </button>;
}

export function GenesisPremiumApp() {
  const [view, setView] = useState<AppView>('trade');
  const [controlOpen, setControlOpen] = useState(false);
  const { symbol, setSymbol, timeframe, setTimeframe, market, refresh } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const founder = useFounderState();
  const { truth } = useRiskState();

  const rows = market.data?.watchlist ?? TRADING_SYMBOLS.map(unavailableTicker);
  const selected = rows.find((row) => row.symbol === symbol) ?? rows[0];
  const change = selected?.changePct ?? market.data?.changePct ?? null;
  const positive = (change ?? 0) >= 0;
  const founderData = founder.data as unknown as FounderSnapshot | null;
  const extended = runner as (typeof runner & ExtendedRunner) | null | undefined;
  const pipeline = extended?.researchPipeline;
  const ledger = extended?.researchLedger?.summary;
  const pipelineSummary = pipeline?.summary;
  const researchEvents = Array.isArray(pipeline?.latest) ? pipeline.latest.slice(0, 6) : [];
  const agents = Array.isArray(founderData?.agents) ? founderData.agents : [];
  const connectors = Array.isArray(founderData?.connectors) ? founderData.connectors : [];
  const founderLocked = founderData?.mode === 'live_locked' || founderData?.cutover?.canExecute === false;
  const runnerReady = runner?.agentAlive === true && runner?.paperOnly === true && runner?.liveOrders === false;
  const riskBand = truth.data?.execution?.globalRisk?.band ?? truth.data?.globalRisk?.band ?? 'UNVERIFIED';
  const highlights = useMemo(() => rows.slice(0, 3), [rows]);

  const openTrade = (next: TradingSymbol) => {
    setSymbol(next);
    setView('trade');
  };

  return <main className="genesis-premium-app" data-ui="genesis-premium-v5">
    <aside className="gp-sidebar">
      <Brand />
      <nav className="gp-desktop-nav" aria-label="Genesis navigation">
        {NAV.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={view === id ? 'is-active' : ''} onClick={() => setView(id)}><Icon size={18}/><span>{label}</span></button>)}
      </nav>
      <div className="gp-founder-card"><Shield size={18}/><div><strong>Founder control</strong><span>{founderLocked ? 'Execution locked' : 'State unverified'}</span></div></div>
    </aside>

    <div className="gp-app-shell">
      <header className="gp-topbar">
        <div className="gp-mobile-brand"><Brand /></div>
        <button type="button" className="gp-search" onClick={() => setView('markets')}><Search size={18}/><span>Markets, pairs, research…</span></button>
        <div className="gp-top-actions"><StatusStrip runnerReady={runnerReady} founderLocked={founderLocked} marketState={market.state}/><button type="button" onClick={refresh} aria-label="Refresh"><RefreshCw size={18}/></button><button type="button" aria-label="Notifications"><Bell size={18}/></button></div>
      </header>

      <div className="gp-content">
        {view === 'markets' ? <section className="gp-page gp-markets-page">
          <div className="gp-page-head"><div><span>REAL REFERENCE FEED</span><h1>Markets</h1><p>Fast market scanning with honest PAPER authority.</p></div><button type="button" className="gp-secondary-button" onClick={refresh}><RefreshCw size={16}/> Refresh</button></div>
          <div className="gp-highlight-grid">
            {highlights.map((row) => <button key={row.symbol} className="gp-highlight-card" type="button" onClick={() => openTrade(row.symbol)}><div><CoinLogo symbol={row.symbol} size={42}/><strong>{shortSymbol(row.symbol)}</strong></div><b>{formatPrice(row.lastPrice)}</b><span className={(row.changePct ?? 0) >= 0 ? 'is-positive' : 'is-danger'}>{formatPercent(row.changePct)}</span><small>{compact(row.quoteVolume)} volume</small></button>)}
          </div>
          <div className="gp-panel gp-market-universe"><div className="gp-panel-head"><div><span>WATCHLIST</span><h2>Futures universe</h2></div><small>BINANCE SPOT REFERENCE</small></div><div className="gp-market-list">{rows.map((row) => <MarketRow key={row.symbol} row={row} active={row.symbol === symbol} onOpen={() => openTrade(row.symbol)}/>)}</div></div>
        </section> : null}

        {view === 'trade' ? <section className="gp-page gp-trade-page">
          <aside className="gp-panel gp-watchlist-panel"><div className="gp-panel-head"><div><span>WATCHLIST</span><h2>Markets</h2></div><small>{rows.length} assets</small></div><div className="gp-market-list">{rows.map((row) => <MarketRow key={row.symbol} row={row} active={row.symbol === symbol} onOpen={() => openTrade(row.symbol)}/>)}</div></aside>

          <div className="gp-trade-main">
            <section className="gp-asset-hero">
              <div className="gp-asset-title"><CoinLogo symbol={symbol} size={48}/><div><strong>{shortSymbol(symbol)}<small>/USDT</small></strong><span>BINANCE REFERENCE · PAPER FUTURES</span></div></div>
              <div className="gp-quote"><strong>{formatPrice(market.data?.lastPrice)}</strong><span className={change == null ? '' : positive ? 'is-positive' : 'is-danger'}>{formatPercent(change)}</span></div>
              <div className="gp-metrics"><div><span>24h volume</span><strong>{compact(selected?.quoteVolume)}</strong></div><div><span>Risk</span><strong>{riskBand}</strong></div><div><span>Updated</span><strong>{timeLabel(market.data?.updatedAt)}</strong></div></div>
            </section>

            <div className="gp-timeframes">{TRADING_TIMEFRAMES.map((item) => <button key={item} type="button" className={timeframe === item ? 'is-active' : ''} onClick={() => setTimeframe(item)}>{item}</button>)}<span>Indicators</span></div>
            <div className="gp-chart"><MarketChart positionOverlay={false} chrome="canvas"/></div>
            <div className="gp-position-card"><div className="gp-panel-head"><div><span>PAPER EXECUTION</span><h2>Position</h2></div><small>TRUTH LAYER</small></div><ActivePosition /></div>
          </div>

          <aside className="gp-trade-aside">
            <section className="gp-panel gp-order-panel"><div className="gp-panel-head"><div><span>EXECUTION</span><h2>Paper order</h2></div><LockKeyhole size={18}/></div><div className="gp-order-toggle"><button type="button" disabled>Long</button><button type="button" disabled>Short</button></div><div className="gp-order-copy"><span>Execution authority</span><strong className="is-danger">LOCKED</strong><p>Controls remain disabled until Founder readiness and runner verification pass.</p></div><button type="button" className="gp-primary-button" onClick={() => setView('control')}>Review control gates</button></section>
            <section className="gp-panel gp-intel-panel"><div className="gp-panel-head"><div><span>GENESIS INTEL</span><h2>Research memory</h2></div><Sparkles size={18}/></div><div className="gp-intel-stats"><div><span>Tracked</span><strong>{pipelineSummary?.proposalsTracked ?? '—'}</strong></div><div><span>Backtest</span><strong>{pipelineSummary?.backtestAllowed ?? '—'}</strong></div><div><span>NO_GO</span><strong className="is-danger">{ledger?.noGo ?? '—'}</strong></div></div><button type="button" className="gp-text-link" onClick={() => setView('research')}>Open evidence <ChevronRight size={16}/></button></section>
          </aside>
        </section> : null}

        {view === 'research' ? <section className="gp-page gp-research-page">
          <div className="gp-page-head"><div><span>EVIDENCE BEFORE CAPITAL</span><h1>Research</h1><p>Hypotheses move through novelty, economics, validation and sealed evidence. No near-miss becomes GO.</p></div><FlaskConical size={28}/></div>
          <div className="gp-summary-grid"><article><span>Tracked</span><strong>{pipelineSummary?.proposalsTracked ?? '—'}</strong><small>hypotheses</small></article><article><span>Economic blocked</span><strong>{pipelineSummary?.economicBlocked ?? '—'}</strong><small>stopped early</small></article><article><span>Backtest allowed</span><strong>{pipelineSummary?.backtestAllowed ?? '—'}</strong><small>research only</small></article><article><span>NO_GO memory</span><strong className="is-danger">{ledger?.noGo ?? '—'}</strong><small>preserved forever</small></article></div>
          <div className="gp-panel"><div className="gp-panel-head"><div><span>PIPELINE</span><h2>Latest research events</h2></div><small>READ ONLY</small></div><div className="gp-research-list">{researchEvents.length ? researchEvents.map((event, index) => <article key={event.eventId ?? index}><span className={`gp-stage-dot ${tone(event.stage)}`}/><div><strong>{clean(event.family)}</strong><small>{clean(event.stage)} · {clean(event.economicVerdict ?? event.noveltyDecision)}</small></div><em className={event.researchComputeAuthority ? 'is-positive' : 'is-muted'}>{event.researchComputeAuthority ? 'COMPUTE' : 'READ ONLY'}</em></article>) : <div className="gp-empty"><Database size={20}/><strong>RESEARCH DATA UNAVAILABLE</strong><span>No opportunity inferred.</span></div>}</div></div>
        </section> : null}

        {view === 'agents' ? <section className="gp-page gp-agents-page">
          <div className="gp-page-head"><div><span>AI OPERATIONS</span><h1>Agents</h1><p>Every agent shows its real founder-contract state. No simulated activity.</p></div><Bot size={28}/></div>
          <div className="gp-agent-grid">{agents.length ? agents.map((agent) => <article key={agent.id ?? agent.name} className="gp-agent-card"><div className="gp-agent-sigil">{(agent.name ?? 'A').slice(0, 1)}</div><div className="gp-agent-copy"><span>{clean(agent.desk ?? agent.role)}</span><strong>{agent.name ?? 'UNNAMED AGENT'}</strong><p>{agent.mission ?? 'No mission telemetry available.'}</p></div><em className={tone(agent.status)}>{clean(agent.status)}</em></article>) : <div className="gp-empty"><Bot size={20}/><strong>AGENT STATE UNAVAILABLE</strong><span>No activity inferred.</span></div>}</div>
          <div className="gp-panel gp-connectors"><div className="gp-panel-head"><div><span>CONNECTORS</span><h2>Infrastructure rack</h2></div><small>{connectors.length} known</small></div><div className="gp-connector-grid">{connectors.map((connector) => <article key={connector.id ?? connector.name}><span><Database size={17}/></span><div><strong>{connector.name ?? 'UNKNOWN CONNECTOR'}</strong><small>{clean(connector.category)} · {clean(connector.mode)}</small></div><em className={tone(connector.status)}>{clean(connector.status)}</em></article>)}</div></div>
        </section> : null}

        {view === 'control' ? <section className="gp-page gp-control-page">
          <div className="gp-page-head"><div><span>FOUNDER SAFETY</span><h1>Control</h1><p>Capital and execution remain fail-closed. This surface reports state; it does not bypass gates.</p></div><Shield size={28}/></div>
          <div className="gp-control-grid"><article className="gp-system-card"><div><Activity size={19}/><span>System mode</span></div><strong>{clean(founderData?.mode)}</strong><small>{clean(founderData?.readiness)}</small></article><article className="gp-system-card"><div><Database size={19}/><span>Market feed</span></div><strong>{stateLabel(market.state)}</strong><small>{clean(market.data?.market)}</small></article><article className="gp-system-card"><div><Bot size={19}/><span>Runner</span></div><strong>{runnerReady ? 'VERIFIED PAPER' : 'UNVERIFIED'}</strong><small>{runner?.agentAlive === true ? 'heartbeat present' : 'heartbeat unavailable'}</small></article><article className="gp-system-card"><div><LockKeyhole size={19}/><span>Execution</span></div><strong className="is-danger">{founderLocked ? 'LIVE LOCKED' : 'UNVERIFIED'}</strong><small>canExecute = false</small></article></div>
          <div className="gp-panel gp-founder-panel"><div className="gp-panel-head"><div><span>FOUNDER CONTROL</span><h2>Protected actions</h2></div><Shield size={19}/></div><p>Open the existing Founder Control drawer to review pause, emergency and cutover gates. No action is executed from this summary surface.</p><button type="button" className="gp-primary-button" onClick={() => setControlOpen(true)}>Open Founder Control</button></div>
        </section> : null}
      </div>

      <nav className="gp-bottom-nav" aria-label="Mobile navigation">{NAV.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={view === id ? 'is-active' : ''} onClick={() => setView(id)}><Icon size={19}/><span>{label}</span></button>)}</nav>
    </div>

    <Suspense fallback={null}><ControlDrawer open={controlOpen} onClose={() => setControlOpen(false)}/></Suspense>
  </main>;
}
