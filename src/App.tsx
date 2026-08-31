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
import HQView from '@ui/views/HQView';
import SettingsView from '@ui/views/SettingsView';
import MarketsView from '@workflows/MarketsView';
import CommandConsole from '@workflows/CommandConsole';
import { CommandBarProvider, useCommandBar } from '@workflows/CommandBar';
import EdgeScorecardView from '@workflows/EdgeScorecardView';
import CryptoLabView from '@workflows/CryptoLabView';
import SystemHealthView from '@ui/views/SystemHealthView';
import LiveExecutionsView from '@workflows/LiveExecutionsView';
import FundingBotView from '@workflows/FundingBotView';
import QuantBotView from '@workflows/QuantBotView';
import TerminalView from '@workflows/TerminalView';
import BotCreatorView from '@workflows/BotCreatorView';
// Disconnected theatrical views (visual-only, no real engine behind them).
// Files kept on disk on purpose; do not re-import without wiring a real backend:
//   MarketingView, TechView, IntegrationsView, HRView, ProgressView,
//   AgentCreator, AutoView, OperatorTimelineView, PredictionMarketsLab,
//   SolanaAlphaView, DecisionsView, GenesisDashboard, AgentExecutionView,
//   AlphaValidationView.
import WalletAuthProvider from '@core/auth/WalletAuthProvider';
import { actions, useSelectedModule } from '@core/store/genesisStore';
import { useLearningSync } from '@hooks/useLearningSync';
import type { ModuleId } from '@core/data/moduleRegistry';

const TICK_MS = 5000;

function ModuleRenderer({ module, setModule }: { module: ModuleId; setModule: (m: ModuleId) => void }) {
  switch (module) {
    case 'hq':            return <HQView />;
    case 'markets':       return <MarketsView />;
    case 'settings':      return <SettingsView />;
    case 'factory':       return <BotCreatorView />;
    case 'wallet':        return <WalletView />;
    case 'console':       return <CommandConsole />;
    case 'edge':        return <EdgeScorecardView />;
    case 'crypto':        return <CryptoLabView />;
    case 'system':        return <SystemHealthView />;
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
  // Wallet auth stays available for the Wallet module. It is NOT a product gate.
  // Public root is the HQ office (paper). ConnectWalletGate hid the desk behind
  // a 401 splash — that is not Genesis HQ.
  return (
    <WalletAuthProvider>
      <CommandBarProvider>
        <AppShell />
      </CommandBarProvider>
    </WalletAuthProvider>
  );
}
