import { lazy, Suspense, useCallback, useState } from 'react';
import { Activity, Bot, CandlestickChart, ListChecks, Shield, Target } from 'lucide-react';
import { TradingDeskProvider } from './TradingDeskProvider';
import { TradingHeader } from './TradingHeader';
import { MarketWatchlist } from './MarketWatchlist';
import { MarketChart } from './MarketChart';
import { ActivePosition } from './ActivePosition';
import { EngineTelemetry } from './EngineTelemetry';
import { DecisionTape } from './DecisionTape';
import { RiskPanel } from './RiskPanel';
import { PositionsTable } from './PositionsTable';
import { ExecutionTable } from './ExecutionTable';
import './tradingWorkspace.css';

const StrategyPanel = lazy(() => import('./StrategyPanel').then((module) => ({ default: module.StrategyPanel })));
const AgentBar = lazy(() => import('./AgentBar').then((module) => ({ default: module.AgentBar })));
const ControlDrawer = lazy(() => import('./ControlDrawer').then((module) => ({ default: module.ControlDrawer })));

type TerminalTab = 'positions' | 'executions' | 'decisions' | 'strategies' | 'agents';

const TABS: Array<{ id: TerminalTab; label: string }> = [
  { id: 'positions', label: 'POSITIONS' },
  { id: 'executions', label: 'EXECUTIONS' },
  { id: 'decisions', label: 'DECISIONS' },
  { id: 'strategies', label: 'STRATEGIES' },
  { id: 'agents', label: 'AGENTS' },
];

function LoadingPanel() {
  return <div className="terminal-empty"><Activity size={13} className="animate-pulse" /> LOADING VERIFIED SURFACE</div>;
}

function TradingWorkspaceContent() {
  const [tab, setTab] = useState<TerminalTab>('positions');
  const [controlOpen, setControlOpen] = useState(false);
  const closeControl = useCallback(() => setControlOpen(false), []);
  const showTab = (next: TerminalTab) => {
    setTab(next);
    window.requestAnimationFrame(() => document.getElementById('desk-terminal')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  return (
    <main className="trading-workspace">
      <TradingHeader onControl={() => setControlOpen(true)} />
      <MarketWatchlist mobile />
      <div className="trading-workspace__body">
        <MarketWatchlist />
        <div id="desk-chart" className="trading-workspace__chart"><MarketChart /></div>
        <div className="trading-workspace__right">
          <EngineTelemetry />
          <RiskPanel />
          <DecisionTape onViewAll={() => showTab('decisions')} />
        </div>
        <div className="trading-workspace__mobile-position"><ActivePosition /></div>
      </div>
      <section id="desk-terminal" className="desk-terminal" aria-label="Trading desk terminal">
        <nav className="desk-terminal__tabs">
          {TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={tab === item.id ? 'is-active' : ''} aria-selected={tab === item.id}>{item.label}</button>)}
          <span>REAL SOURCES ONLY</span>
        </nav>
        <div className="desk-terminal__content">
          {tab === 'positions' ? <PositionsTable /> : null}
          {tab === 'executions' ? <ExecutionTable /> : null}
          {tab === 'decisions' ? <DecisionTape limit={8} /> : null}
          {tab === 'strategies' ? <Suspense fallback={<LoadingPanel />}><StrategyPanel /></Suspense> : null}
          {tab === 'agents' ? <Suspense fallback={<LoadingPanel />}><AgentBar /></Suspense> : null}
        </div>
      </section>
      <nav className="trading-mobile-nav" aria-label="Mobile trading navigation">
        <button type="button" onClick={() => document.getElementById('desk-chart')?.scrollIntoView({ behavior: 'smooth' })}><CandlestickChart size={15} />CHART</button>
        <button type="button" onClick={() => showTab('positions')}><Target size={15} />POSITIONS</button>
        <button type="button" onClick={() => showTab('executions')}><ListChecks size={15} />TRADES</button>
        <button type="button" onClick={() => showTab('agents')}><Bot size={15} />AGENTS</button>
        <button type="button" onClick={() => setControlOpen(true)}><Shield size={15} />CONTROL</button>
      </nav>
      <Suspense fallback={null}><ControlDrawer open={controlOpen} onClose={closeControl} /></Suspense>
    </main>
  );
}

export function TradingWorkspace() {
  return <TradingDeskProvider><TradingWorkspaceContent /></TradingDeskProvider>;
}
