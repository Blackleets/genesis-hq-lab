import { setLanguage, useLanguage } from '@core/i18n/languageStore';
import type { ModuleId } from '@core/data/moduleRegistry';
import { useTruthLayer } from '@hooks/useTruthLayer';
import { describeSystemStatus } from '@ui/systemStatus';

interface Props { currentModule: ModuleId; }

const LABELS: Record<'es' | 'en', Record<string, string>> = {
  es: { hq: 'Command Center', markets: 'Market Intelligence', edge: 'Riesgo & Edge', system: 'Infraestructura' },
  en: { hq: 'Command Center', markets: 'Market Intelligence', edge: 'Risk & Edge', system: 'Infrastructure' },
};

export default function GenesisHeader({ currentModule }: Props) {
  const lang = useLanguage();
  const { truth } = useTruthLayer();
  const status = describeSystemStatus(truth);
  const statusClass = status.tone === 'live' ? 'text-emerald-300' : status.tone === 'warn' ? 'text-amber-300' : 'text-red-300';

  return (
    <header className="shrink-0 border-b border-zinc-800 bg-[#090c12] px-3 md:px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="w-8 h-8 shrink-0 border border-cyan-400/35 bg-cyan-400/5 flex items-center justify-center font-mono font-bold text-cyan-300">G</div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] md:text-[12px] font-mono font-semibold tracking-[0.12em] text-zinc-200 truncate">GENESIS HQ</span>
              <span className="text-zinc-700">/</span>
              <span className="text-[11px] text-zinc-400 truncate">{LABELS[lang][currentModule] ?? 'Command Center'}</span>
            </div>
            <div className="hidden sm:block mt-1 text-[9px] font-mono uppercase tracking-[0.16em] text-zinc-600 truncate">
              {lang === 'es' ? 'Quant research · capital control · evidence first' : 'Quant research · capital control · evidence first'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
          <span className="hidden sm:inline-flex border border-amber-400/35 bg-amber-400/5 px-2 py-1 text-[9px] font-mono text-amber-300">PAPER</span>
          <span className="inline-flex border border-red-400/35 bg-red-400/5 px-2 py-1 text-[9px] font-mono text-red-300">LIVE LOCKED</span>
          <span className={`hidden md:inline-flex items-center gap-1.5 border border-zinc-800 px-2 py-1 text-[9px] font-mono ${statusClass}`} title={status.detail[lang]}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />{status.label[lang]}
          </span>
          <div className="flex border border-zinc-800 text-[9px] font-mono">
            <button type="button" onClick={() => setLanguage('es')} className={`px-2 py-1 ${lang === 'es' ? 'text-cyan-200 bg-cyan-400/8' : 'text-zinc-600'}`}>ES</button>
            <button type="button" onClick={() => setLanguage('en')} className={`px-2 py-1 border-l border-zinc-800 ${lang === 'en' ? 'text-cyan-200 bg-cyan-400/8' : 'text-zinc-600'}`}>EN</button>
          </div>
        </div>
      </div>
    </header>
  );
}
