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
import { MODULES, type ModuleId } from '@core/data/moduleRegistry';
import { useT } from '@core/i18n/languageStore';

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
  const t = useT();
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
      <nav className="md:hidden border-b border-zinc-800 px-4 py-2" aria-label="Mobile workspace navigation">
        <label className="text-xs text-zinc-400 flex items-center gap-3">Workspace
          <select aria-label="Workspace module" value={currentModule} onChange={event => actions.setSelectedModule(event.target.value as ModuleId)} className="flex-1 min-w-0 bg-[#10131a] text-zinc-200 border border-zinc-700 p-2">
            {MODULES.map(module => <option key={module.id} value={module.id}>{t(module.navKey)}</option>)}
          </select>
        </label>
      </nav>
      {currentModule !== 'hq' && <TopBar />}
      <div className="flex-1 flex min-h-0">
        <div className="hidden md:flex"><GenesisSidebar currentModule={currentModule} onSelect={actions.setSelectedModule} /></div>
        <ModuleRenderer module={currentModule} setModule={actions.setSelectedModule} />
      </div>
      <ToastContainer />
    </div>
  );
}

export default function App() {
  // Wallet auth stays available for the Wallet module. It is NOT a product gate.
  // Public root is the capture desk (paper). No wallet wall. No pixel office.
  return (
    <WalletAuthProvider>
      <CommandBarProvider>
        <AppShell />
      </CommandBarProvider>
    </WalletAuthProvider>
  );
}
