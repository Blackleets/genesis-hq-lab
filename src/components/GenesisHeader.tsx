// Top header bar for Genesis HQ.
// Shows the current module title, "seed data" badge, and a language
// toggle (ES / EN). No SaaS gradients — pixel-tone surfaces only.

import { ShieldAlert } from 'lucide-react';
import { setLanguage, useLanguage, useT } from '../i18n/languageStore';
import { MODULE_BY_ID, type ModuleId } from '../data/moduleRegistry';

interface Props {
  currentModule: ModuleId;
}

export default function GenesisHeader({ currentModule }: Props) {
  const t = useT();
  const lang = useLanguage();
  const entry = MODULE_BY_ID[currentModule];

  return (
    <header className="h-12 shrink-0 bg-carbon-200 border-b border-trim flex items-center justify-between px-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-7 h-7 grid place-items-center bg-carbon-300 border border-trim shrink-0">
          <span className="font-mono text-emerald-400 text-sm">G</span>
        </div>
        <div className="leading-tight min-w-0">
          <div className="font-mono text-[13px] tracking-wide text-zinc-100 truncate">
            {t('header.title')} · {t(entry.navKey)}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500 truncate">
            {t('header.subtitle')}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <div className="hidden sm:flex items-center gap-2 font-mono text-[10px] text-zinc-400 uppercase tracking-wider">
          <span className="inline-block w-2 h-2 bg-emerald-400" />
          {t('header.officeStatus')}
        </div>
        <div className="hidden md:flex items-center gap-2 font-mono text-[10px] text-amber-300 uppercase tracking-wider">
          <ShieldAlert className="w-3.5 h-3.5" />
          {t('header.seedBadge')}
        </div>
        {/* language toggle */}
        <div className="flex border border-trim bg-carbon-300 font-mono text-[10px] uppercase tracking-wider">
          <button
            type="button"
            onClick={() => setLanguage('es')}
            className={`px-2 py-1 ${lang === 'es' ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            aria-pressed={lang === 'es' ? 'true' : 'false'}
          >
            ES
          </button>
          <button
            type="button"
            onClick={() => setLanguage('en')}
            className={`px-2 py-1 border-l border-trim ${lang === 'en' ? 'bg-emerald-500/20 text-emerald-200' : 'text-zinc-400 hover:text-zinc-200'}`}
            aria-pressed={lang === 'en' ? 'true' : 'false'}
          >
            EN
          </button>
        </div>
      </div>
    </header>
  );
}
