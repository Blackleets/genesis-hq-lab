// GenesisSidebar — left-rail nav with division groups.
// Modules are organized into 5 themed sections to reflect the company structure.

import { Building2, Boxes, Sparkles, Users, BrainCircuit, Activity, FileText, Settings, Gauge, Wallet, Megaphone, Code, Terminal, Workflow } from 'lucide-react';
import GenesisLockup from './GenesisLogo';
import { useT, useLanguage } from '../i18n/languageStore';
import { MODULES, type ModuleId } from '../data/moduleRegistry';
import type { TKey } from '../i18n/translations';

interface Props {
  currentModule: ModuleId;
  onSelect: (id: ModuleId) => void;
}

const ICONS: Record<ModuleId, typeof Building2> = {
  dashboard:    Gauge,
  hq:           Building2,
  factory:      Boxes,
  auto:         Sparkles,
  hr:           Users,
  markets:      Activity,
  decisions:    BrainCircuit,
  progress:     FileText,
  settings:     Settings,
  wallet:       Wallet,
  marketing:    Megaphone,
  tech:         Code,
  console:      Terminal,
  integrations: Workflow,
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


const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.id, m]));

export default function GenesisSidebar({ currentModule, onSelect }: Props) {
  const t = useT();
  const lang = useLanguage();

  return (
    <aside className="w-[196px] shrink-0 bg-carbon-200 border-r border-trim flex flex-col">
      {/* Company identity */}
      <div className="px-3.5 py-3 border-b border-trim relative overflow-hidden">
        <GenesisLockup size="sm" markSize={26} showTagline />
        {/* Ambient scan on identity block */}
        <div className="absolute inset-x-0 bottom-0 h-px genesis-scan-line-green pointer-events-none" />
      </div>

      {/* Grouped nav */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-4">
        {SIDEBAR_GROUPS.map((group) => {
          const groupModules = group.modules.map((id) => MODULE_MAP[id]).filter(Boolean);
          if (groupModules.length === 0) return null;

          return (
            <div key={group.labelEn}>
              {/* Section label */}
              <div
                className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] select-none"
                style={{ color: group.color, opacity: 0.6 }}
              >
                {lang === 'es' ? group.labelEs : group.labelEn}
              </div>

              {/* Items */}
              <div>
                {groupModules.map((m) => {
                  const Icon = ICONS[m.id];
                  const active = m.id === currentModule;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelect(m.id)}
                      className={`relative w-full flex items-center gap-3 px-4 py-2 text-[13px] text-left transition-all duration-200 ${active ? 'genesis-sidebar-active' : ''}`}
                      style={{
                        color: active ? '#f4f4f5' : '#71717a',
                        background: active ? `${group.color}08` : 'transparent',
                        borderLeft: active ? `2px solid ${group.color}` : '2px solid transparent',
                        boxShadow: active ? `inset 0 0 20px 0 ${group.color}06` : 'none',
                      }}
                      onMouseEnter={(e) => {
                        if (!active) {
                          const el = e.currentTarget as HTMLElement;
                          el.style.color = '#d4d4d8';
                          el.style.background = 'rgba(255,255,255,0.03)';
                          el.style.transform = 'translateX(1px)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!active) {
                          const el = e.currentTarget as HTMLElement;
                          el.style.color = '#71717a';
                          el.style.background = 'transparent';
                          el.style.transform = 'translateX(0)';
                        }
                      }}
                    >
                      <Icon
                        className="shrink-0 transition-all duration-200"
                        style={{
                          width: 15,
                          height: 15,
                          color: active ? group.color : 'currentColor',
                          opacity: active ? 1 : 0.65,
                        }}
                      />
                      <span className="flex-1 truncate font-medium leading-none">
                        {t(m.navKey as TKey)}
                      </span>
                      {/* Active right accent */}
                      {active && (
                        <span
                          className="w-1 h-1 rounded-full shrink-0 genesis-status-dot-slow"
                          style={{ background: group.color }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      {/* Footer with ambient particle cluster */}
      <footer className="px-4 py-2.5 border-t border-trim text-[10px] text-zinc-700 leading-snug relative genesis-particles overflow-hidden">
        {t('sidebar.footer')}
      </footer>
    </aside>
  );
}
