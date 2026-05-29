// GenesisSidebar — left-rail nav with division groups.
// Modules are organized into 5 themed sections to reflect the company structure.

import { Building2, Boxes, Sparkles, Users, BrainCircuit, Activity, FileText, Settings, Gauge, Wallet, Megaphone, Code, Terminal, Workflow, LayoutDashboard } from 'lucide-react';
import { useT, useLanguage } from '../i18n/languageStore';
import { MODULES, type ModuleId, stateTKey } from '../data/moduleRegistry';
import type { TKey } from '../i18n/translations';

interface Props {
  currentModule: ModuleId;
  onSelect: (id: ModuleId) => void;
}

const ICONS: Record<ModuleId, typeof Building2> = {
  dashboard:     Gauge,
  hq:            Building2,
  factory:       Boxes,
  auto:          Sparkles,
  hr:            Users,
  markets:       Activity,
  decisions:     BrainCircuit,
  progress:      FileText,
  settings:      Settings,
  wallet:        Wallet,
  marketing:     Megaphone,
  tech:          Code,
  console:       Terminal,
  integrations:  Workflow,
};

interface SidebarGroup {
  labelEs: string;
  labelEn: string;
  color: string;        // accent color for the group header
  modules: ModuleId[];
}

const SIDEBAR_GROUPS: SidebarGroup[] = [
  {
    labelEs: 'Workspace',
    labelEn: 'Workspace',
    color: '#e4e4e7',
    modules: ['dashboard', 'hq', 'console'],
  },
  {
    labelEs: 'Trading & Riesgo',
    labelEn: 'Trading & Risk',
    color: '#00ff9c',
    modules: ['markets', 'decisions'],
  },
  {
    labelEs: 'Negocios',
    labelEn: 'Business',
    color: '#f59e0b',
    modules: ['marketing', 'tech'],
  },
  {
    labelEs: 'People & Ops',
    labelEn: 'People & Ops',
    color: '#a855f7',
    modules: ['hr', 'factory', 'auto'],
  },
  {
    labelEs: 'Plataforma',
    labelEn: 'Platform',
    color: '#6b7280',
    modules: ['integrations', 'progress', 'settings', 'wallet'],
  },
];

function stateColor(state: string): string {
  switch (state) {
    case 'ready':             return 'bg-emerald-400';
    case 'visual-only':       return 'bg-amber-400';
    case 'locked-backend':    return 'bg-zinc-500';
    case 'locked-polymarket': return 'bg-violet-400';
    case 'disabled-phase-8':  return 'bg-red-400';
    default:                  return 'bg-zinc-500';
  }
}

const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.id, m]));

export default function GenesisSidebar({ currentModule, onSelect }: Props) {
  const t = useT();
  const lang = useLanguage();

  return (
    <aside className="w-[196px] shrink-0 bg-carbon-200 border-r border-trim flex flex-col">
      {/* Company identity */}
      <div className="px-4 py-3 border-b border-trim">
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-6 h-6 bg-emerald-500/20 border border-emerald-500/40 shrink-0">
            <LayoutDashboard className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div>
            <div className="font-mono text-[11px] font-bold tracking-wide text-zinc-100">GENESIS HQ</div>
            <div className="font-mono text-[8px] uppercase tracking-widest text-zinc-600">Corp · GNSS</div>
          </div>
        </div>
      </div>

      {/* Grouped nav */}
      <nav className="flex-1 overflow-y-auto py-1">
        {SIDEBAR_GROUPS.map((group) => {
          // Filter to only modules that exist in the registry
          const groupModules = group.modules
            .map((id) => MODULE_MAP[id])
            .filter(Boolean);
          if (groupModules.length === 0) return null;

          return (
            <div key={group.labelEn} className="mb-1">
              {/* Group header */}
              <div
                className="px-3 pt-2.5 pb-1 font-mono text-[8px] uppercase tracking-widest flex items-center gap-1.5"
                style={{ color: group.color }}
              >
                <span className="inline-block w-1 h-1 rounded-full" style={{ background: group.color }} />
                {lang === 'es' ? group.labelEs : group.labelEn}
              </div>

              {/* Group modules */}
              {groupModules.map((m) => {
                const Icon = ICONS[m.id];
                const active = m.id === currentModule;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelect(m.id)}
                    className={`group w-full flex items-center gap-2.5 px-3 py-1.5 font-mono text-[11px] text-left transition-colors ${
                      active
                        ? 'bg-carbon-300 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-200 hover:bg-carbon-300/50'
                    }`}
                  >
                    <Icon
                      className="w-3.5 h-3.5 shrink-0"
                      style={active ? { color: group.color } : undefined}
                    />
                    <span className="flex-1 truncate">{t(m.navKey as TKey)}</span>
                    <span
                      className={`shrink-0 inline-block w-1.5 h-1.5 rounded-full ${stateColor(m.state)}`}
                      title={t(stateTKey(m.state) as TKey)}
                    />
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      <footer className="px-3 py-2.5 border-t border-trim font-mono text-[8px] text-zinc-700 leading-snug">
        {t('sidebar.footer')}
      </footer>
    </aside>
  );
}
