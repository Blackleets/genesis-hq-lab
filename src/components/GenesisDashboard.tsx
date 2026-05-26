// Dashboard — real-time metrics + active tasks + upgrades + module
// snapshot. Reads everything from the live store, no static seed.

import { useT, useLanguage } from '../i18n/languageStore';
import { useProgress } from '../lib/progressEngine';
import {
  useEvents,
  useTasks,
  useModules,
  useOfficeUpgrades,
  useHiringQueue,
} from '../state/genesisStore';
import { OFFICE_ROOMS } from '../data/officeRooms';
import { MODULE_BY_ID, stateTKey } from '../data/moduleRegistry';
import type { TKey } from '../i18n/translations';
import type { TaskStatus } from '../types/task';

interface Props {
  onOpenHQ: () => void;
}

function Stat({ label, value, hint, color = '#3da9fc' }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="border border-trim bg-carbon-200 px-4 py-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-2xl mt-1" style={{ color }}>{value}</div>
      {hint && <div className="font-mono text-[10px] text-zinc-600 mt-1">{hint}</div>}
    </div>
  );
}

function Bar({ label, value, color = '#22d3ee' }: { label: string; value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="border border-trim bg-carbon-200 px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
        <div className="font-mono text-sm text-zinc-200">{(pct * 100).toFixed(0)}%</div>
      </div>
      <div className="mt-2 h-2 bg-carbon-300 border border-trim">
        <div className="h-full" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function taskStatusKey(s: TaskStatus): TKey {
  return `task.status.${s}` as TKey;
}

export default function GenesisDashboard({ onOpenHQ }: Props) {
  const t = useT();
  const lang = useLanguage();
  const progress = useProgress();
  const events = useEvents();
  const tasks = useTasks();
  const modules = useModules();
  const upgrades = useOfficeUpgrades();
  const queue = useHiringQueue();

  const activeTasks = tasks.filter(
    (x) => x.status === 'assigned' || x.status === 'working' || x.status === 'moving',
  );
  const recentEvents = [...events].reverse().slice(0, 6);
  const nextHire = queue[0] ?? null;

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
              {t('header.title')}
            </div>
            <h1 className="font-mono text-2xl text-zinc-100">{t('dashboard.title')}</h1>
            <p className="font-mono text-[12px] text-zinc-500 mt-1 max-w-2xl">{t('dashboard.realtime')}</p>
          </div>
          <button
            type="button"
            onClick={onOpenHQ}
            className="font-mono text-[11px] uppercase tracking-wider px-4 py-2 border border-emerald-400/60 text-emerald-300 bg-carbon-200 hover:bg-emerald-400/10"
          >
            {t('dashboard.jumpToHQ')} →
          </button>
        </header>

        {/* Top metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <Stat label={t('metric.genesisAge')}     value={`${progress.ageHours.toFixed(1)}h`} color="#ffd24a" />
          <Stat label={t('metric.activeAgents')}   value={String(progress.activeAgents)} color="#00ff9c" />
          <Stat label="onboarding"                  value={String(progress.onboardingAgents)} color="#22d3ee" hint={t('onboarding.duration')} />
          <Stat label={t('metric.hiringQueue')}    value={String(progress.hiringQueue)} color="#7c5cff" />
          <Stat label={t('metric.modulesUnlocked')} value={`${progress.modulesUnlocked} / ${modules.length}`} color="#3da9fc" />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={`${t('feed.kind.task')} · queued`}    value={String(progress.tasksQueued)} color="#9ca3af" />
          <Stat label={`${t('feed.kind.task')} · active`}    value={String(progress.tasksActive)} color="#3da9fc" />
          <Stat label={`${t('feed.kind.task')} · completed`} value={String(progress.tasksCompleted)} color="#00ff9c" />
          <Stat label={t('metric.officeUpgrades')}            value={String(progress.officeUpgradesCompleted)} color="#ffb547" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Bar label={t('metric.learningLevel')} value={progress.learningLevel} color="#22d3ee" />
          <Bar label={t('metric.companyHealth')} value={progress.companyHealth} color="#00ff9c" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Active tasks */}
          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                {t('dashboard.section.tasks')}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{activeTasks.length}</span>
            </header>
            {activeTasks.length === 0 ? (
              <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">{t('dashboard.noTasks')}</div>
            ) : (
              <ul className="divide-y divide-trim">
                {activeTasks.slice(0, 8).map((task) => (
                  <li key={task.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <div className="font-mono text-sm text-zinc-100">{task.title[lang]}</div>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">
                        {t(taskStatusKey(task.status))}
                      </span>
                    </div>
                    <div className="font-mono text-[10px] text-zinc-600 mt-1">
                      {OFFICE_ROOMS[task.room].label[lang]} · {task.type}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Upgrades */}
          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim flex items-center justify-between">
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
                {t('dashboard.section.upgrades')}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{upgrades.length}</span>
            </header>
            {upgrades.length === 0 ? (
              <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">—</div>
            ) : (
              <ul className="divide-y divide-trim">
                {upgrades.slice(0, 5).map((u) => (
                  <li key={u.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-mono text-sm" style={{ color: OFFICE_ROOMS[u.room].color }}>{u.title[lang]}</div>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-400">{u.status}</span>
                    </div>
                    <div className="font-mono text-[10px] text-zinc-600 mt-1">{u.reason[lang]}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
              {t('dashboard.section.activity')}
            </header>
            <ul className="divide-y divide-trim">
              {recentEvents.map((e) => (
                <li key={e.id} className="px-4 py-2 font-mono text-[11px] text-zinc-300 leading-snug">
                  {e.message[lang]}
                </li>
              ))}
            </ul>
          </section>

          <section className="border border-trim bg-carbon-200">
            <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
              {t('dashboard.nextHire')}
            </header>
            {!nextHire ? (
              <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">{t('dashboard.nextHire.none')}</div>
            ) : (
              <div className="px-4 py-3">
                <div className="font-mono text-sm text-zinc-100">{nextHire.name[lang]}</div>
                <div className="font-mono text-[11px] text-zinc-400 mb-2">{nextHire.role[lang]}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-600 mb-1">
                  {t('hr.queue.condition')}
                </div>
                <div className="text-zinc-300 text-[12px] leading-snug">{nextHire.unlockReason[lang]}</div>
              </div>
            )}
          </section>
        </div>

        {/* Modules snapshot */}
        <section className="border border-trim bg-carbon-200">
          <header className="px-4 py-2.5 border-b border-trim font-mono text-[11px] uppercase tracking-wider text-zinc-300">
            {t('dashboard.section.modules')}
          </header>
          <ul className="divide-y divide-trim">
            {modules.map((m) => {
              const entry = MODULE_BY_ID[m.id];
              return (
                <li key={m.id} className="px-4 py-2.5 flex items-center justify-between gap-3 font-mono text-[12px]">
                  <span className="text-zinc-100">{t(entry.navKey)}</span>
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">{t(stateTKey(m.state))}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </main>
  );
}
