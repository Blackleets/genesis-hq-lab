// Generic module placeholder shown for modules that are not yet ready.
// Reads from MODULE_BY_ID and translates titles/status via i18n.
// Renders: title, current state badge, description, future actions,
// relation to Genesis HQ, and a "back to HQ" button. No dead links —
// the future-action list is a list, not buttons.

import { useLanguage, useT } from '@core/i18n/languageStore';
import type { Lang } from '@core/i18n/translations';
import { MODULE_BY_ID, type ModuleId, stateTKey } from '@core/data/moduleRegistry';

interface Props {
  module: ModuleId;
  onBack: () => void;
}

function stateBadge(state: string) {
  switch (state) {
    case 'ready':              return { bg: 'bg-emerald-500/15', border: 'border-emerald-400/50', text: 'text-emerald-200' };
    case 'visual-only':        return { bg: 'bg-amber-500/10',   border: 'border-amber-400/50',   text: 'text-amber-200'   };
    case 'locked-backend':     return { bg: 'bg-zinc-500/10',    border: 'border-zinc-400/40',    text: 'text-zinc-300'    };
    case 'locked-polymarket':  return { bg: 'bg-violet-500/10',  border: 'border-violet-400/40',  text: 'text-violet-200'  };
    case 'disabled-phase-8':   return { bg: 'bg-red-500/10',     border: 'border-red-400/40',     text: 'text-red-200'     };
    default:                   return { bg: 'bg-zinc-500/10',    border: 'border-zinc-400/40',    text: 'text-zinc-300'    };
  }
}

export default function ModulePlaceholder({ module, onBack }: Props) {
  const t = useT();
  const lang: Lang = useLanguage();
  const entry = MODULE_BY_ID[module];
  const badge = stateBadge(entry.state);

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-3xl mx-auto">
        <header className="mb-6">
          <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
            {t('header.title')}
          </div>
          <h1 className="font-mono text-2xl text-zinc-100 mb-3">
            {t(entry.navKey)}
          </h1>
          <div className={`inline-flex items-center px-2 py-1 font-mono text-[10px] uppercase tracking-wider border ${badge.bg} ${badge.border} ${badge.text}`}>
            {t('module.statusLabel')}: {t(stateTKey(entry.state))}
          </div>
        </header>

        <section className="gx-card p-5 mb-4">
          <div className="gx-label mb-2">
            {t('module.descriptionLabel')}
          </div>
          <p className="text-zinc-200 text-sm leading-relaxed">
            {entry.description[lang]}
          </p>
        </section>

        <section className="gx-card p-5 mb-4">
          <div className="gx-label mb-3">
            {t('module.futureActions')}
          </div>
          <ul className="space-y-2 text-sm text-zinc-300 list-none">
            {entry.futureActions.map((a, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1 inline-block w-2 h-2 bg-emerald-400/60 shrink-0" />
                <span>{a[lang]}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="gx-card p-5 mb-4">
          <div className="gx-label mb-2">
            {t('module.relationLabel')}
          </div>
          <p className="text-zinc-300 text-sm leading-relaxed">{entry.relation[lang]}</p>
        </section>

        <div className="font-mono text-[10px] text-zinc-600 leading-snug mb-6">
          {t('module.lockedNote')}
        </div>

        <button
          type="button"
          onClick={onBack}
          className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-emerald-400/60 text-emerald-300 bg-carbon-300 hover:bg-emerald-400/10"
        >
          ← {t('module.backToHQ')}
        </button>
      </div>
    </main>
  );
}
