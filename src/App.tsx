// Genesis HQ Lab — app shell. State lives in @core/store/genesisStore
// (persisted to localStorage). Every 5s actions.tick() advances movement,
// completes onboarding timers, starts/completes tasks, etc.
// Module views live in their own domain folders; this file only routes.

import { useEffect } from 'react';
import GenesisHeader from '@ui/GenesisHeader';
import GenesisSidebar from '@ui/GenesisSidebar';
import TopBar from '@ui/TopBar';
import ToastContainer from '@ui/ToastContainer';
import ModulePlaceholder from '@ui/ModulePlaceholder';
import WalletView from '@ui/WalletView';
import MarketingView from '@ui/MarketingView';
import TechView from '@ui/TechView';
import IntegrationsView from '@ui/IntegrationsView';
import HQView from '@ui/views/HQView';
import HRView from '@ui/views/HRView';
import SettingsView from '@ui/views/SettingsView';
import GenesisDashboard from '@dashboard/GenesisDashboard';
import ProgressView from '@dashboard/ProgressView';
import MarketsView from '@workflows/MarketsView';
import CommandConsole from '@workflows/CommandConsole';
import DecisionsView from '@workflows/DecisionsView';
import AutoView from '@workflows/AutoView';
import { CommandBarProvider, useCommandBar } from '@workflows/CommandBar';
import AgentExecutionView from '@agents/AgentExecutionView';
import AgentCreator from '@creator/AgentCreator';
import EdgeScorecardView from '@workflows/EdgeScorecardView';
import CryptoLabView from '@workflows/CryptoLabView';
import SystemHealthView from '@ui/views/SystemHealthView';
import OperatorTimelineView from '@workflows/OperatorTimelineView';
import AlphaValidationView from '@workflows/AlphaValidationView';
import LiveExecutionsView from '@workflows/LiveExecutionsView';
import FundingBotView from '@workflows/FundingBotView';
import QuantBotView from '@workflows/QuantBotView';
import TerminalView from '@workflows/TerminalView';
import PredictionMarketsLab from '@workflows/PredictionMarketsLab';
import SolanaAlphaView from './features/solana-alpha/SolanaAlphaView';
import { actions, useSelectedModule } from '@core/store/genesisStore';
import { useLearningSync } from '@hooks/useLearningSync';
import type { ModuleId } from '@core/data/moduleRegistry';

const TICK_MS = 5000;

function ModuleRenderer({ module, setModule }: { module: ModuleId; setModule: (m: ModuleId) => void }) {
  switch (module) {
    case 'hq':            return <HQView />;
    case 'dashboard':     return <GenesisDashboard onOpenHQ={() => setModule('hq')} />;
    case 'hr':            return <HRView />;
    case 'markets':       return <MarketsView />;
    case 'progress':      return <ProgressView />;
    case 'settings':      return <SettingsView />;
    case 'factory':       return <AgentCreator />;
    case 'decisions':     return <DecisionsView />;
    case 'auto':          return <AutoView />;
    case 'wallet':        return <WalletView />;
    case 'marketing':     return <MarketingView />;
    case 'tech':          return <TechView />;
    case 'console':       return <CommandConsole />;
    case 'integrations':  return <IntegrationsView />;
    case 'agents-live':   return <AgentExecutionView />;
    case 'edge':        return <EdgeScorecardView />;
    case 'crypto':        return <CryptoLabView />;
    case 'system':        return <SystemHealthView />;
    case 'operator':      return <OperatorTimelineView />;
    case 'alpha':         return <AlphaValidationView />;
    case 'pred-markets':   return <PredictionMarketsLab />;
    case 'solana-alpha':   return <SolanaAlphaView />;
    case 'live-exec':       return <LiveExecutionsView />;
    case 'funding-bot':     return <FundingBotView />;
    case 'quant-bot':       return <QuantBotView />;
    case 'terminal':        return <TerminalView />;
    default:
      return <ModulePlaceholder module={module} onBack={() => setModule('hq')} />;
  }
}

function AppShell() {
  const currentModule = useSelectedModule();
  const { open: openCommandBar } = useCommandBar();

  // Sync agent learning scores from backend every 30 seconds
  useLearningSync();

  useEffect(() => {
    actions.tick();
    const id = setInterval(() => actions.tick(), TICK_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="h-dvh w-full max-w-full overflow-hidden flex flex-col bg-carbon-300">
      <GenesisHeader
        currentModule={currentModule}
        onNavigate={actions.setSelectedModule}
        onOpenCommandBar={openCommandBar}
      />
      {currentModule !== 'hq' && <TopBar />}
      <div className="flex-1 flex min-h-0">
        <GenesisSidebar currentModule={currentModule} onSelect={actions.setSelectedModule} />
        <ModuleRenderer module={currentModule} setModule={actions.setSelectedModule} />
      </div>
      <ToastContainer />
    </div>
  );
}

export default function App() {
  return (
    <CommandBarProvider>
      <AppShell />
    </CommandBarProvider>
  );
}
