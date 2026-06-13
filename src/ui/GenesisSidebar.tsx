// GenesisSidebar — left-rail nav with division groups.
// Modules are organized into 5 themed sections to reflect the company structure.

import { Building2, Boxes, Sparkles, Users, BrainCircuit, Activity, FileText, Settings, Gauge, Wallet, Megaphone, Code, Terminal, Workflow, Bot, TrendingUp, Bitcoin, HeartPulse, ScrollText, FlaskConical, BarChart3, Zap } from 'lucide-react';
import GenesisLockup from '@ui/GenesisLogo';
import { useT, useLanguage } from '@core/i18n/languageStore';
import { MODULES, type ModuleId } from '@core/data/moduleRegistry';
import type { TKey } from '@core/i18n/translations';

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
  'agents-live':  Bot,
  edge:           TrendingUp,
  crypto:         Bitcoin,
  system:         HeartPulse,
  operator:       ScrollText,
  alpha:          FlaskConical,
  'pred-markets':  BarChart3,
  'solana-alpha':  Zap,
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
    modules: ['markets', 'decisions', 'edge', 'crypto', 'pred-markets', 'solana-alpha'],
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
    modules: ['agents-live', 'hr', 'factory', 'auto'],
  },
  {
    labelEs: 'Plataforma',
    labelEn: 'Platform',
    color: '#6b7280',
    modules: ['system', 'operator', 'alpha', 'integrations', 'progress', 'settings', 'wallet'],
  },
];


const MODULE_MAP = Object.fromEntries(MODULES.map((m) => [m.id, m]));

export default function GenesisSidebar({ currentModule, onSelect }: Props) {
  const t = useT();
  const lang = useLanguage();

  return (
    <aside className="w-[clamp(168px,14vw,196px)] shrink-0 bg-[#0b0e14] border-r border-[#242b3a] flex flex-col">
      {/* Company identity */}
      <div className="px-3.5 py-3 border-b border-[#242b3a] bg-[#0f131c]">
        <GenesisLockup size="sm" markSize={26} showTagline />
      </div>

      {/* Grouped nav */}
      <nav className="gx-scroll flex-1 overflow-y-auto px-2 py-2.5 space-y-3.5">
        {SIDEBAR_GROUPS.map((group) => {
          const groupModules = group.modules.map((id) => MODULE_MAP[id]).filter(Boolean);
          if (groupModules.length === 0) return null;

          return (
            <div key={group.labelEn}>
              {/* Section label */}
              <div
                className="px-2.5 pb-1.5 text-[9px] font-bold uppercase tracking-[0.18em] select-none"
                style={{ color: group.color, opacity: 0.82 }}
              >
                {lang === 'es' ? group.labelEs : group.labelEn}
              </div>

              {/* Items */}
              <div className="space-y-0.5">
                {groupModules.map((m) => {
                  const Icon = ICONS[m.id];
                  const active = m.id === currentModule;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => onSelect(m.id)}
                      className="group relative w-full flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[12px] text-left transition-all duration-150"
                      style={{
                        color: active ? '#f4f4f5' : '#7b8190',
                        background: active
                          ? `linear-gradient(90deg, ${group.color}24, rgba(255,255,255,0.035))`
                          : 'transparent',
                        boxShadow: active ? `inset 0 0 0 1px ${group.color}2e` : undefined,
                      }}
                      onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = '#c8ced8'; }}
                      onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.color = '#7b8190'; }}
                    >
                      {active && (
                        <span
                          className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 rounded-full"
                          style={{ background: group.color }}
                        />
                      )}
                      <Icon
                        className="shrink-0 transition-colors"
                        style={{
                          width: 14,
                          height: 14,
                          color: active ? group.color : 'currentColor',
                          opacity: active ? 1 : 0.58,
                        }}
                      />
                      <span className="flex-1 truncate font-semibold leading-none tracking-[-0.01em]">
                        {t(m.navKey as TKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <footer className="px-3.5 py-2.5 border-t border-[#242b3a] text-[9px] text-zinc-700 leading-snug bg-[#0f131c]">
        {t('sidebar.footer')}
      </footer>
    </aside>
  );
}
