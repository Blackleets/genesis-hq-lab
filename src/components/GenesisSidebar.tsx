// Left-rail nav for Genesis HQ — full list of modules with state badges.
// Every entry is clickable and routes the App via onSelect.
// No dead buttons: locked modules open a useful ModulePlaceholder.

import { Building2, Boxes, Sparkles, Users, BrainCircuit, Activity, FileText, Settings, Gauge } from 'lucide-react';
import { useT } from '../i18n/languageStore';
import { MODULES, type ModuleId, stateTKey } from '../data/moduleRegistry';
import type { TKey } from '../i18n/translations';

interface Props {
  currentModule: ModuleId;
  onSelect: (id: ModuleId) => void;
}

const ICONS: Record<ModuleId, typeof Building2> = {
  dashboard:  Gauge,
  hq:         Building2,
  factory:    Boxes,
  auto:       Sparkles,
  hr:         Users,
  markets:    Activity,
  decisions:  BrainCircuit,
  progress:   FileText,
  settings:   Settings,
};

function stateColor(state: string): string {
  switch (state) {
    case 'ready':              return 'bg-emerald-400';
    case 'visual-only':        return 'bg-amber-400';
    case 'locked-backend':     return 'bg-zinc-500';
    case 'locked-polymarket':  return 'bg-violet-400';
    case 'disabled-phase-8':   return 'bg-red-400';
    default:                   return 'bg-zinc-500';
  }
}

export default function GenesisSidebar({ currentModule, onSelect }: Props) {
  const t = useT();
  return (
    <aside className="w-[184px] shrink-0 bg-carbon-200 border-r border-trim flex flex-col">
      <div className="px-3 py-3 border-b border-trim">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">
          {t('sidebar.workspace')}
        </div>
      </div>
      <nav className="flex-1 px-1.5 py-2 space-y-0.5 overflow-y-auto">
        {MODULES.map((m) => {
          const Icon = ICONS[m.id];
          const active = m.id === currentModule;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSelect(m.id)}
              className={`group w-full flex items-center gap-2.5 px-2.5 py-2 font-mono text-[12px] text-left border ${
                active
                  ? 'bg-carbon-300 border-trim text-zinc-100'
                  : 'bg-transparent border-transparent text-zinc-400 hover:text-zinc-100 hover:bg-carbon-300'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="flex-1 truncate">{t(m.navKey)}</span>
              <span
                className={`shrink-0 inline-block w-2 h-2 ${stateColor(m.state)}`}
                aria-label={t(stateTKey(m.state) as TKey)}
                title={t(stateTKey(m.state) as TKey)}
              />
            </button>
          );
        })}
      </nav>
      <footer className="px-3 py-3 border-t border-trim font-mono text-[9px] text-zinc-600 leading-snug whitespace-pre-line">
        {t('sidebar.footer')}
      </footer>
    </aside>
  );
}
