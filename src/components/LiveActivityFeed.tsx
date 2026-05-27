// LiveActivityFeed — reads from the live event log in the store.

import { useT, useLanguage } from '../i18n/languageStore';
import type { Lang, TKey } from '../i18n/translations';
import { tr } from '../i18n/translations';
import { useEvents } from '../state/genesisStore';
import type { SystemEvent } from '../types/event';

function kindLabelKey(k: SystemEvent['kind']): TKey {
  if (k === 'task.blocked' || k === 'agent.warning') return 'feed.kind.warning';
  if (k.startsWith('task.')) return 'feed.kind.task';
  if (k.startsWith('agent.')) return 'feed.kind.hr';
  if (k.startsWith('office.upgrade')) return 'feed.kind.upgrade';
  return 'feed.kind.system';
}

const COLOR = {
  task: '#3da9fc',
  warning: '#ffb547',
  hr: '#a855f7',
  system: '#9ca3af',
  upgrade: '#ffb547',
};

function colorForKind(k: SystemEvent['kind']): string {
  if (k === 'task.blocked' || k === 'agent.warning') return COLOR.warning;
  if (k.startsWith('task.')) return COLOR.task;
  if (k.startsWith('agent.')) return COLOR.hr;
  if (k.startsWith('office.upgrade')) return COLOR.upgrade;
  return COLOR.system;
}

function formatRelative(at: string, lang: Lang): string {
  const ms = Date.now() - Date.parse(at);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return tr('feed.timeJustNow', lang);
  if (m < 60) return `${m} ${tr('feed.timeMinutesAgo', lang)}`;
  const h = Math.floor(m / 60);
  return `${h} ${tr('feed.timeHoursAgo', lang)}`;
}

export default function LiveActivityFeed() {
  const t = useT();
  const lang = useLanguage();
  const events = useEvents();
  const ordered = [...events].reverse().slice(0, 50);

  return (
    <aside className="h-full w-[248px] xl:w-[260px] shrink-0 bg-carbon-200 border-l border-trim flex flex-col">
      <header className="px-3 py-2.5 border-b border-trim flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
          {t('feed.title')}
        </div>
        <span className="font-mono text-[9px] uppercase tracking-wider text-amber-300">
          {t('feed.labBadge')}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {ordered.length === 0 ? (
          <div className="px-2 py-3 font-mono text-[11px] text-zinc-500">—</div>
        ) : (
          <ul className="space-y-1.5">
            {ordered.map((e) => (
              <li key={e.id} className="border border-trim bg-carbon-300 px-2.5 py-2 font-mono text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="uppercase tracking-wider text-[9px] shrink-0" style={{ color: colorForKind(e.kind) }}>
                    {tr(kindLabelKey(e.kind), lang)}
                  </span>
                  <span className="text-zinc-600 text-[9px] shrink-0">{formatRelative(e.at, lang)}</span>
                </div>
                <div className="text-zinc-300 leading-snug mt-1">{e.message[lang]}</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
