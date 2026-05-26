// OfficeUpgradeEvent — small card showing one virtual-contractor event.
// Used by Dashboard and Progress modules.

import { useLanguage, useT } from '../i18n/languageStore';
import type { Lang } from '../i18n/translations';
import { OFFICE_UPGRADES } from '../data/officeEvents';

function stateBadge(s: string) {
  if (s === 'in-progress') return 'border-emerald-400/50 text-emerald-200 bg-emerald-500/10';
  if (s === 'done')        return 'border-zinc-400/40 text-zinc-300 bg-zinc-500/10';
  return 'border-amber-400/40 text-amber-200 bg-amber-500/10';
}

export default function OfficeUpgradeEventList() {
  const t = useT();
  const lang: Lang = useLanguage();
  return (
    <section className="border border-trim bg-carbon-200">
      <header className="px-4 py-2.5 border-b border-trim flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
          {t('upgrade.title')}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-amber-300">
          {t('feed.labBadge')}
        </span>
      </header>
      <p className="px-4 py-3 font-mono text-[11px] text-zinc-500 border-b border-trim leading-snug">
        {t('upgrade.intro')}
      </p>
      <ul className="divide-y divide-trim">
        {OFFICE_UPGRADES.map((u) => (
          <li key={u.id} className="px-4 py-3">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <div className="font-mono text-sm" style={{ color: u.color }}>{u.zone[lang]}</div>
              <span className={`font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 border ${stateBadge(u.state)}`}>
                {u.state}
              </span>
            </div>
            <div className="text-zinc-300 text-[12px] leading-snug">{u.request[lang]}</div>
            <div className="text-zinc-400 text-[12px] leading-snug mt-1">{u.contractorLine[lang]}</div>
            <div className="text-zinc-500 text-[11px] leading-snug mt-1 italic">{u.hrLine[lang]}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
