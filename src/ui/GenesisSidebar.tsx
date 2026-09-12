import { Activity, Building2, HeartPulse, ShieldCheck } from 'lucide-react';
import GenesisLockup from '@ui/GenesisLogo';
import { useLanguage } from '@core/i18n/languageStore';
import type { ModuleId } from '@core/data/moduleRegistry';

interface Props {
  currentModule: ModuleId;
  onSelect: (id: ModuleId) => void;
}

const NAV: Array<{ id: ModuleId; icon: typeof Building2; es: string; en: string; metaEs: string; metaEn: string }> = [
  { id: 'hq', icon: Building2, es: 'Command Center', en: 'Command Center', metaEs: 'Capital · desks · founder', metaEn: 'Capital · desks · founder' },
  { id: 'markets', icon: Activity, es: 'Market Intelligence', en: 'Market Intelligence', metaEs: 'Feeds · oportunidades', metaEn: 'Feeds · opportunities' },
  { id: 'edge', icon: ShieldCheck, es: 'Riesgo & Edge', en: 'Risk & Edge', metaEs: 'Gates · validación · NO-GO', metaEn: 'Gates · validation · NO-GO' },
  { id: 'system', icon: HeartPulse, es: 'Infraestructura', en: 'Infrastructure', metaEs: 'Salud · datos · servicios', metaEn: 'Health · data · services' },
];

export default function GenesisSidebar({ currentModule, onSelect }: Props) {
  const lang = useLanguage();
  return (
    <aside className="w-[232px] shrink-0 bg-[#090c12] border-r border-zinc-800 flex flex-col">
      <div className="px-4 py-4 border-b border-zinc-800 bg-[#0c1017]">
        <GenesisLockup size="sm" markSize={28} showTagline={false} />
        <div className="mt-3 flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.16em]">
          <span className="border border-amber-400/40 bg-amber-400/5 px-2 py-1 text-amber-300">PAPER</span>
          <span className="border border-red-400/40 bg-red-400/5 px-2 py-1 text-red-300">LIVE LOCKED</span>
        </div>
      </div>

      <div className="px-4 pt-5 pb-2 text-[9px] uppercase tracking-[0.2em] text-zinc-600 font-semibold">
        {lang === 'es' ? 'Operación institucional' : 'Institutional operations'}
      </div>
      <nav className="px-2 flex-1 space-y-1" aria-label="Genesis institutional navigation">
        {NAV.map((item) => {
          const Icon = item.icon;
          const active = item.id === currentModule;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelect(item.id)}
              className={`w-full text-left border px-3 py-3 transition-colors ${active ? 'border-cyan-400/35 bg-cyan-400/8' : 'border-transparent hover:border-zinc-800 hover:bg-white/[0.02]'}`}
            >
              <div className="flex items-center gap-2.5">
                <Icon className={`w-4 h-4 ${active ? 'text-cyan-300' : 'text-zinc-600'}`} />
                <span className={`text-[12px] font-semibold ${active ? 'text-zinc-100' : 'text-zinc-400'}`}>{lang === 'es' ? item.es : item.en}</span>
              </div>
              <div className="pl-[26px] mt-1 text-[9px] font-mono text-zinc-600">{lang === 'es' ? item.metaEs : item.metaEn}</div>
            </button>
          );
        })}
      </nav>

      <footer className="px-4 py-4 border-t border-zinc-800 text-[9px] font-mono leading-relaxed text-zinc-600">
        <div>TRUTH LEDGER v2</div>
        <div>{lang === 'es' ? 'Sin P&L inventado · sin ejecución live desde UI' : 'No invented P&L · no live execution from UI'}</div>
      </footer>
    </aside>
  );
}
