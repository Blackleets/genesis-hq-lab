// Genesis HQ — institutional app shell.
// The browser is a control/read surface, not a quant runner.
// Legacy lab modules remain in the repository for migration work but are not mounted here.

import { useEffect } from 'react';
import GenesisHeader from '@ui/GenesisHeader';
import GenesisSidebar from '@ui/GenesisSidebar';
import ToastContainer from '@ui/ToastContainer';
import HQView from '@ui/views/HQView';
import MarketsView from '@workflows/MarketsView';
import EdgeScorecardView from '@workflows/EdgeScorecardView';
import SystemHealthView from '@ui/views/SystemHealthView';
import { actions, useSelectedModule } from '@core/store/genesisStore';
import type { ModuleId } from '@core/data/moduleRegistry';
import { useLanguage } from '@core/i18n/languageStore';

const PUBLIC_MODULES: ModuleId[] = ['hq', 'markets', 'edge', 'system'];

const MOBILE_LABELS: Record<'es' | 'en', Record<string, string>> = {
  es: { hq: 'Command Center', markets: 'Mercados', edge: 'Riesgo & Edge', system: 'Infraestructura' },
  en: { hq: 'Command Center', markets: 'Markets', edge: 'Risk & Edge', system: 'Infrastructure' },
};

function ModuleRenderer({ module }: { module: ModuleId }) {
  switch (module) {
    case 'markets': return <MarketsView />;
    case 'edge': return <EdgeScorecardView />;
    case 'system': return <SystemHealthView />;
    case 'hq':
    default: return <HQView />;
  }
}

export default function App() {
  const selected = useSelectedModule();
  const lang = useLanguage();
  const currentModule = PUBLIC_MODULES.includes(selected) ? selected : 'hq';

  // Migrate browsers that persisted a legacy route (settings, wallet, bot lab, console, etc.).
  useEffect(() => {
    if (selected !== currentModule) actions.setSelectedModule(currentModule);
  }, [selected, currentModule]);

  return (
    <div className="h-dvh w-full max-w-full overflow-hidden flex flex-col bg-[#07090e] text-zinc-100">
      <GenesisHeader currentModule={currentModule} />

      <nav className="lg:hidden shrink-0 border-b border-zinc-800 bg-[#0b0e14] overflow-x-auto" aria-label="Genesis primary navigation">
        <div className="flex min-w-max px-2 py-2 gap-1.5">
          {PUBLIC_MODULES.map((id) => {
            const active = id === currentModule;
            return (
              <button
                key={id}
                type="button"
                onClick={() => actions.setSelectedModule(id)}
                className={`px-3 py-2 text-[11px] font-medium border transition-colors ${active ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : 'border-zinc-800 text-zinc-500 bg-[#0d1118]'}`}
              >
                {MOBILE_LABELS[lang][id]}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="flex-1 flex min-h-0">
        <div className="hidden lg:flex">
          <GenesisSidebar currentModule={currentModule} onSelect={actions.setSelectedModule} />
        </div>
        <ModuleRenderer module={currentModule} />
      </div>
      <ToastContainer />
    </div>
  );
}
