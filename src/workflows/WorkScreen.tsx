// WorkScreen — room overlay. Wires EXISTING desks (capture, quant, scorecard)
// into the pixel office. Tasks/agents stay as a side rail. No invented PnL.

import { useEffect, useState } from 'react';
import { useLanguage, useT } from '@core/i18n/languageStore';
import { OFFICE_ROOMS } from '@animations/officeRooms';
import { useAgents, useTasksForRoom } from '@core/store/genesisStore';
import type { RoomId } from '@core/types/office';
import { pickRole } from '@agents/agentHelpers';
import type { Task, TaskStatus } from '@core/types/task';
import type { TKey } from '@core/i18n/translations';
import { CaptureDeskPanel } from '@components/crypto/CaptureDeskPanel';
import { QuantReadinessPanel } from '@components/crypto/QuantReadinessPanel';
import EdgeScorecardView from '@workflows/EdgeScorecardView';
import { useFundingBotState } from '@services/useFundingBotState';

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

function PaperStrip({ es }: { es: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] uppercase tracking-wider">
      <span className="px-1.5 py-0.5 border border-amber-500/50 text-amber-300">PAPER</span>
      <span className="px-1.5 py-0.5 border border-zinc-700 text-zinc-400">LIVE_OFF</span>
      <span className="px-1.5 py-0.5 border border-red-500/40 text-red-300">6 GATES NO-GO</span>
      <span className="text-zinc-600">{es ? 'sin dinero real' : 'no real money'}</span>
    </div>
  );
}

function BoardPaper({ es }: { es: boolean }) {
  const st = useFundingBotState();
  return (
    <div className="border border-zinc-800 bg-[#0b0f16] px-4 py-4">
      <div className="font-mono text-[9px] uppercase tracking-[0.22em] text-zinc-500">
        {es ? 'Tesorería paper · funding bot' : 'Paper treasury · funding bot'}
      </div>
      <div className="font-mono text-[22px] font-bold text-zinc-100 mt-1">
        ${st.equity.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      <div className="font-mono text-[11px] text-zinc-400 mt-1">
        {es ? 'cobrado' : 'accrued'} ${st.fundingPaid.toFixed(4)} · {st.openCount} pos · {st.trades.length} {es ? 'eventos' : 'events'}
      </div>
      <div className="font-mono text-[10px] text-amber-500/80 mt-2">PAPER · LIVE_OFF · {es ? 'no es un GO' : 'not a GO'}</div>
      {!st.booted && (
        <div className="font-mono text-[11px] text-zinc-600 mt-2">
          {es ? 'esperando feed real (gist). sin números de muestra.' : 'waiting on real feed (gist). no sample numbers.'}
        </div>
      )}
    </div>
  );
}

function RoomDesk({ room, es }: { room: RoomId; es: boolean }) {
  if (room === 'execution-desk') return <CaptureDeskPanel es={es} />;
  if (room === 'strategy-lab') return <QuantReadinessPanel es={es} />;
  if (room === 'memory-archive') {
    return (
      <div className="border border-zinc-800 overflow-hidden">
        <EdgeScorecardView />
      </div>
    );
  }
  if (room === 'board-room') return <BoardPaper es={es} />;
  if (room === 'risk-bunker') {
    return (
      <div className="border border-zinc-800 bg-[#0b0f16] px-4 py-4 font-mono text-[12px] text-zinc-300 space-y-2">
        <div className="text-[9px] uppercase tracking-[0.22em] text-zinc-500">{es ? 'Búnker de riesgo' : 'Risk bunker'}</div>
        <div>LIVE_OFF · PAPER · {es ? 'trading real bloqueado' : 'live trading blocked'}</div>
        <div className="text-zinc-500 text-[11px]">
          {es
            ? 'Las 6 gates viven en Laboratorio. Esta sala no inventa un GO ni un DD.'
            : 'The 6 gates live in the Lab. This room does not invent a GO or a drawdown.'}
        </div>
      </div>
    );
  }
  return null;
}

export default function WorkScreen({ room, onClose }: Props) {
  const t = useT();
  const lang = useLanguage();
  const es = lang === 'es';
  const meta = OFFICE_ROOMS[room];
  const tasks = useTasksForRoom(room);
  const agents = useAgents().filter((a) => a.currentRoom === room);
  const desk = <RoomDesk room={room} es={es} />;

  const isMarket = room === 'market-desk';

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-6 bg-carbon-300">
      <div className="max-w-6xl mx-auto space-y-4">
        <header className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500 mb-1">
              {t('work.title')}
            </div>
            <h1 className="font-mono text-2xl" style={{ color: meta.color }}>{meta.label[lang]}</h1>
            <div className="mt-2"><PaperStrip es={es} /></div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border border-trim text-zinc-300 hover:bg-white/5"
          >
            ← {t('work.close')}
          </button>
        </header>

        {isMarket && (
          <div className="border border-amber-400/40 bg-amber-500/10 px-4 py-3 font-mono text-[12px] text-amber-200">
            {t('work.marketReadonly')}
          </div>
        )}

        {desk}


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
