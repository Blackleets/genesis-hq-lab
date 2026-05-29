// LiveActivityFeed — reads from the live event log in the store.

import { useState } from 'react';
import { useT, useLanguage } from '../i18n/languageStore';
import type { Lang } from '../i18n/translations';
import { tr } from '../i18n/translations';
import { useEvents } from '../state/genesisStore';
import type { EventKind, SystemEvent } from '../types/event';

type FeedTab = 'all' | 'tasks' | 'agents' | 'system';

function formatRelative(at: string, lang: Lang): string {
  const ms = Date.now() - Date.parse(at);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return tr('feed.timeJustNow', lang);
  if (m < 60) return `${m} ${tr('feed.timeMinutesAgo', lang)}`;
  const h = Math.floor(m / 60);
  return `${h} ${tr('feed.timeHoursAgo', lang)}`;
}

function kindTab(k: EventKind): FeedTab {
  if (k === 'task.created' || k === 'task.assigned' || k === 'task.moving' ||
      k === 'task.started' || k === 'task.progress' || k === 'task.blocked' ||
      k === 'task.completed' || k === 'task.failed') return 'tasks';
  if (k === 'agent.hired' || k === 'agent.fired' || k === 'agent.promoted' ||
      k === 'agent.suspended' || k === 'agent.retraining' || k === 'agent.warning' ||
      k === 'agent.moving' || k === 'agent.arrived' || k === 'agent.says' ||
      k === 'agent.onboarding.start' || k === 'agent.onboarding.end') return 'agents';
  return 'system';
}

function kindColor(k: EventKind): string {
  const tab = kindTab(k);
  if (tab === 'tasks')  return '#3da9fc';
  if (tab === 'agents') return '#00ff9c';
  return '#ffd24a';
}

function kindLabel(k: EventKind, lang: Lang): string {
  const labels: Partial<Record<EventKind, { es: string; en: string }>> = {
    'task.created':          { es: 'NUEVA TAREA',   en: 'NEW TASK' },
    'task.assigned':         { es: 'ASIGNADA',      en: 'ASSIGNED' },
    'task.moving':           { es: 'EN CAMINO',     en: 'MOVING' },
    'task.started':          { es: 'INICIADA',      en: 'STARTED' },
    'task.progress':         { es: 'PROGRESO',      en: 'PROGRESS' },
    'task.blocked':          { es: 'BLOQUEADA',     en: 'BLOCKED' },
    'task.completed':        { es: 'COMPLETADA',    en: 'DONE' },
    'task.failed':           { es: 'FALLIDA',       en: 'FAILED' },
    'agent.hired':           { es: 'CONTRATADO',    en: 'HIRED' },
    'agent.fired':           { es: 'DESPEDIDO',     en: 'FIRED' },
    'agent.promoted':        { es: 'PROMOVIDO',     en: 'PROMOTED' },
    'agent.suspended':       { es: 'SUSPENDIDO',    en: 'SUSPENDED' },
    'agent.retraining':      { es: 'REENTRENANDO',  en: 'RETRAINING' },
    'agent.warning':         { es: 'ALERTA',        en: 'WARNING' },
    'agent.moving':          { es: 'MOVIENDO',      en: 'MOVING' },
    'agent.arrived':         { es: 'LLEGÓ',         en: 'ARRIVED' },
    'agent.says':            { es: 'DICE',          en: 'SAYS' },
    'agent.onboarding.start':{ es: 'ONBOARDING',    en: 'ONBOARDING' },
    'agent.onboarding.end':  { es: 'ACTIVO',        en: 'ACTIVE' },
    'module.unlocked':       { es: 'MÓDULO',        en: 'MODULE' },
    'office.upgrade.requested':  { es: 'MEJORA',   en: 'UPGRADE' },
    'office.upgrade.in_progress':{ es: 'MEJORANDO', en: 'UPGRADING' },
    'office.upgrade.completed':  { es: 'MEJORADO',  en: 'UPGRADED' },
    'language.changed':      { es: 'IDIOMA',        en: 'LANG' },
    'system.boot':           { es: 'BOOT',          en: 'BOOT' },
  };
  return labels[k]?.[lang] ?? k.toUpperCase();
}

const TAB_LABELS: Record<FeedTab, { es: string; en: string }> = {
  all:    { es: 'TODO', en: 'ALL' },
  tasks:  { es: 'TAREAS', en: 'TASKS' },
  agents: { es: 'AGENTES', en: 'AGENTS' },
  system: { es: 'SISTEMA', en: 'SYSTEM' },
};

const TAB_COLORS: Record<FeedTab, string> = {
  all:    '#9ca3af',
  tasks:  '#3da9fc',
  agents: '#00ff9c',
  system: '#ffd24a',
};

function filterByTab(e: SystemEvent, tab: FeedTab): boolean {
  if (tab === 'all') return true;
  return kindTab(e.kind) === tab;
}

export default function LiveActivityFeed() {
  const t = useT();
  const lang = useLanguage();
  const events = useEvents();
  const [activeTab, setActiveTab] = useState<FeedTab>('all');

  const ordered = [...events]
    .reverse()
    .filter((e) => filterByTab(e, activeTab))
    .slice(0, 50);

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

      <div className="flex gap-0.5 px-2 py-1.5 border-b border-trim shrink-0">
        {(['all', 'tasks', 'agents', 'system'] as FeedTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className="font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 hover:bg-white/5"
            style={{
              color: activeTab === tab ? TAB_COLORS[tab] : '#6b7280',
              borderBottom: activeTab === tab ? `2px solid ${TAB_COLORS[tab]}` : '2px solid transparent',
            }}
          >
            {TAB_LABELS[tab][lang]}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {ordered.length === 0 ? (
          <div className="px-2 py-3 font-mono text-[11px] text-zinc-500">—</div>
        ) : (
          <ul className="space-y-1.5">
            {ordered.map((e) => (
              <li key={e.id} className="border border-trim bg-carbon-300 px-2.5 py-2 font-mono text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="uppercase tracking-wider text-[9px] shrink-0" style={{ color: kindColor(e.kind) }}>
                    {kindLabel(e.kind, lang)}
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
