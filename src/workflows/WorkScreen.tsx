// WorkScreen — generic workspace overlay/panel that opens when the user
// clicks a room (or a sidebar entry). Shows agents currently inside the
// room and tasks active in it. Acts as the entry point for future
// module-specific UIs.

import { useEffect, useState } from 'react';
import { useLanguage, useT } from '@core/i18n/languageStore';
import { OFFICE_ROOMS } from '@animations/officeRooms';
import { useAgents, useModuleById, useTasksForRoom } from '@core/store/genesisStore';
import type { RoomId } from '@core/types/office';
import { pickRole } from '@agents/agentHelpers';
import type { Task, TaskStatus } from '@core/types/task';
import type { TKey } from '@core/i18n/translations';

function formatMs(ms: number): string {
  if (ms <= 0) return '✓';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function taskBarColor(type: Task['type']): string {
  switch (type) {
    case 'market_scan':    return '#3da9fc';
    case 'risk_review':    return '#ff4757';
    case 'decision_review':return '#ffd24a';
    case 'memory_archive': return '#7c5cff';
    case 'hr_review':      return '#00ff9c';
    case 'agent_training': return '#22d3ee';
    default:               return '#9ca3af';
  }
}

function TaskProgressBar({ task }: { task: Task }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!task.startedAt || !task.estimatedMs) return;
    const update = () => setElapsed(Date.now() - new Date(task.startedAt!).getTime());
    update();
    const id = window.setInterval(update, 1000);
    return () => window.clearInterval(id);
  }, [task.startedAt, task.estimatedMs]);

  if (!task.startedAt || !task.estimatedMs) return null;

  const pct = Math.min(elapsed / task.estimatedMs, 1);
  const remaining = Math.max(0, task.estimatedMs - elapsed);
  const color = taskBarColor(task.type);

  return (
    <div className="mt-1.5">
      <div className="h-[2px] bg-carbon-300 w-full">
        <div className="h-full transition-none" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
      <div className="font-mono text-[9px] text-zinc-500 mt-0.5">
        {pct >= 1 ? '✓' : formatMs(remaining)}
      </div>
    </div>
  );
}

interface Props {
  room: RoomId;
  onClose: () => void;
}

function taskStatusKey(s: TaskStatus): TKey {
  return `task.status.${s}` as TKey;
}

function taskStatusColor(s: TaskStatus): string {
  switch (s) {
    case 'working':   return '#00ff9c';
    case 'assigned':  return '#3da9fc';
    case 'moving':    return '#22d3ee';
    case 'blocked':   return '#ff4757';
    case 'completed': return '#9ca3af';
    case 'failed':    return '#ff4757';
    default:           return '#9ca3af';
  }
}

export default function WorkScreen({ room, onClose }: Props) {
  const t = useT();
  const lang = useLanguage();
  const meta = OFFICE_ROOMS[room];
  const tasks = useTasksForRoom(room);
  const agents = useAgents().filter((a) => a.currentRoom === room);

  const isExec = room === 'execution-desk';
  const isMarket = room === 'market-desk';
  const decisionsModule = useModuleById('decisions');
  const isExecLocked = isExec && decisionsModule?.state === 'locked-backend';

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-5xl mx-auto space-y-5">
        <header className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
              {t('work.title')}
            </div>
            <h1 className="font-mono text-2xl" style={{ color: meta.color }}>{meta.label[lang]}</h1>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border border-trim text-zinc-300 hover:bg-white/5"
          >
            ← {t('work.close')}
          </button>
        </header>

        {isExecLocked && (
          <div className="border border-red-400/40 bg-red-500/10 px-4 py-3 font-mono text-[12px] text-red-200">
            {t('work.execLocked')}
          </div>
        )}
        {isMarket && (
          <div className="border border-amber-400/40 bg-amber-500/10 px-4 py-3 font-mono text-[12px] text-amber-200">
            {t('work.marketReadonly')}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section className="gx-card">
            <header className="gx-card-head flex items-center justify-between">
              <span className="gx-card-title">
                {t('work.tasksHere')}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{tasks.length}</span>
            </header>
            {tasks.length === 0 ? (
              <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">{t('work.noTasks')}</div>
            ) : (
              <ul className="divide-y divide-trim">
                {tasks.map((task) => (
                  <li key={task.id} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-mono text-sm text-zinc-100">{task.title[lang]}</div>
                      <span
                        className="font-mono text-[9px] uppercase tracking-wider px-2 py-0.5 border border-trim"
                        style={{ color: taskStatusColor(task.status) }}
                      >
                        {t(taskStatusKey(task.status))}
                      </span>
                    </div>
                    {task.status === 'working' && <TaskProgressBar task={task} />}
                    {task.description && (
                      <div className="font-mono text-[11px] text-zinc-400 mt-1">{task.description[lang]}</div>
                    )}
                    <div className="font-mono text-[10px] text-zinc-600 mt-1">{task.type}</div>
                    {task.blockedReason && (
                      <div className="font-mono text-[11px] text-red-300 mt-1">
                        {task.blockedReason[lang]}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="gx-card">
            <header className="gx-card-head flex items-center justify-between">
              <span className="gx-card-title">
                {t('work.agentsHere')}
              </span>
              <span className="font-mono text-[10px] text-zinc-500">{agents.length}</span>
            </header>
            {agents.length === 0 ? (
              <div className="px-4 py-6 font-mono text-[12px] text-zinc-500">{t('work.noAgents')}</div>
            ) : (
              <ul className="divide-y divide-trim">
                {agents.map((a) => (
                  <li key={a.id} className="px-4 py-3">
                    <div className="font-mono text-sm text-zinc-100">{a.name}</div>
                    <div className="font-mono text-[11px] text-zinc-400">{pickRole(a.role, lang)}</div>
                    <div className="font-mono text-[10px] text-zinc-600 mt-1">
                      {a.department} · {a.rank} · {a.status}
                    </div>
                    {a.currentTask && (
                      <div className="font-mono text-[11px] text-zinc-300 italic mt-1">"{a.currentTask[lang]}"</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
