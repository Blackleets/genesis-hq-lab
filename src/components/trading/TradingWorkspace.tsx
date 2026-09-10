import { lazy, Suspense, useCallback, useState } from 'react';
import { Activity, Bot, CandlestickChart, ListChecks, Shield, Target } from 'lucide-react';
import { TradingDeskProvider } from './TradingDeskProvider';
import { TradingHeader } from './TradingHeader';
import { FounderCommandBar } from './FounderCommandBar';
import { MarketWatchlist } from './MarketWatchlist';
import { MarketChart } from './MarketChart';
import { ActivePosition } from './ActivePosition';
import { EngineTelemetry } from './EngineTelemetry';
import { DecisionTape } from './DecisionTape';
import { RiskPanel } from './RiskPanel';
import { PositionsTable } from './PositionsTable';
import { ExecutionTable } from './ExecutionTable';
import { DeskStatusRail } from './DeskStatusRail';
import { ResearchOpportunitySurface } from './ResearchOpportunitySurface';
import { ChallengerEvidencePanel } from './ChallengerEvidencePanel';
import { ProfitabilitySprintPanel } from './ProfitabilitySprintPanel';
import { EdgeFactoryPanel } from './EdgeFactoryPanel';
import { PositioningIntelligencePanel } from './PositioningIntelligencePanel';
import { ConnectorRack } from './ConnectorRack';
import { ProfitEngineRail } from './ProfitEngineRail';
import './tradingWorkspace.css';
import './workstationV2.css';
import './workstationV2Refinement.css';
import './exchangeLayout.css';
import './founderCommandBar.css';
import './challengerEvidence.css';

const StrategyPanel = lazy(() => import('./StrategyPanel').then((module) => ({ default: module.StrategyPanel })));
const EconomicTruthPanel = lazy(() => import('./EconomicTruthPanel').then((module) => ({ default: module.EconomicTruthPanel })));
const AgentBar = lazy(() => import('./AgentBar').then((module) => ({ default: module.AgentBar })));
const ControlDrawer = lazy(() => import('./ControlDrawer').then((module) => ({ default: module.ControlDrawer })));

type TerminalTab = 'positions' | 'executions' | 'decisions' | 'strategies' | 'truth' | 'agents' | 'research' | 'connections' | 'risk' | 'engine';

const TABS: Array<{ id: TerminalTab; label: string }> = [
  { id: 'positions', label: 'Posiciones' },
  { id: 'executions', label: 'Operaciones' },
  { id: 'decisions', label: 'Decisiones' },
  { id: 'strategies', label: 'Estrategias' },
  { id: 'truth', label: 'Resultados' },
  { id: 'agents', label: 'Agentes' },
  { id: 'research', label: 'Investigación' },
  { id: 'connections', label: 'Conexiones' },
  { id: 'risk', label: 'Riesgo' },
  { id: 'engine', label: 'Motor' },
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
    <main className="trading-workspace genesis-workstation-v2 genesis-exchange" data-ui="genesis-workstation-v2">
      <TradingHeader onControl={() => setControlOpen(true)} />
      <FounderCommandBar onOpen={showTab} />
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

      <ProfitEngineRail onOpen={showTab} />
      <section id="desk-terminal" className="desk-terminal" aria-label="Trading desk terminal">
        <nav className="desk-terminal__tabs" aria-label="Vistas de operaciones">
          {TABS.map((item) => <button key={item.id} type="button" onClick={() => setTab(item.id)} className={tab === item.id ? 'is-active' : ''} aria-pressed={tab === item.id}>{item.label}</button>)}
          <span>PAPER · CAPITAL REAL BLOQUEADO</span>
        </nav>
        <div className="desk-terminal__content">
          {tab === 'research' ? <><EdgeFactoryPanel /><PositioningIntelligencePanel /><ProfitabilitySprintPanel /><ResearchOpportunitySurface onOpenResearch={() => showTab('strategies')} /><ChallengerEvidencePanel /></> : null}
          {tab === 'connections' ? <ConnectorRack /> : null}
          {tab === 'engine' ? <EngineTelemetry /> : null}
          {tab === 'risk' ? <RiskPanel /> : null}
          {tab === 'positions' ? <PositionsTable /> : null}
          {tab === 'executions' ? <ExecutionTable /> : null}
          {tab === 'decisions' ? <DecisionTape limit={8} /> : null}
          {tab === 'strategies' ? <Suspense fallback={<LoadingPanel />}><StrategyPanel /></Suspense> : null}
          {tab === 'truth' ? <Suspense fallback={<LoadingPanel />}><EconomicTruthPanel /></Suspense> : null}
          {tab === 'agents' ? <Suspense fallback={<LoadingPanel />}><AgentBar /></Suspense> : null}
        </div>
      </section>
      <DeskStatusRail />
      <nav className="trading-mobile-nav" aria-label="Mobile trading navigation">
        <button type="button" onClick={() => document.getElementById('desk-chart')?.scrollIntoView({ behavior: 'smooth' })}><CandlestickChart size={15} />Trading</button>
        <button type="button" onClick={() => showTab('positions')}><Target size={15} />Posiciones</button>
        <button type="button" onClick={() => showTab('executions')}><ListChecks size={15} />Operaciones</button>
        <button type="button" onClick={() => showTab('agents')}><Bot size={15} />Agentes</button>
        <button type="button" onClick={() => setControlOpen(true)}><Shield size={15} />Control</button>
      </nav>
      <Suspense fallback={null}><ControlDrawer open={controlOpen} onClose={closeControl} /></Suspense>
    </main>
  );
}

export function TradingWorkspace() {
  return <TradingDeskProvider><TradingWorkspaceContent /></TradingDeskProvider>;
}
