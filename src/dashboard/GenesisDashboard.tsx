// Dashboard — real-time metrics + active tasks + upgrades + module
// snapshot. Reads everything from the live store, no static seed.

import { useState } from 'react';
import { useT, useLanguage } from '@core/i18n/languageStore';
import { useProgress } from '@workflows/progressEngine';
import {
  useActiveAgents,
  useEvents,
  useOnboardingAgents,
  useTasks,
  useModules,
  useOfficeUpgrades,
  useHiringQueue,
} from '@core/store/genesisStore';
import { useLiveTrading } from '@dashboard/hooks/useLiveTrading';
import { useTruthLayer } from '@hooks/useTruthLayer';
import type { Agent } from '@core/types/genesis';
import CapitalChart from '@dashboard/charts/CapitalChart';
import AgentPerformanceChart from '@dashboard/charts/AgentPerformanceChart';
import AgentLivePanel from '@dashboard/AgentLivePanel';
import { FuturesDeskPanel } from '@components/crypto/FuturesDeskPanel';
import SkillsPanel from '@dashboard/SkillsPanel';
import ResearchSignalsPanel from '@dashboard/ResearchSignalsPanel';
import { OFFICE_ROOMS } from '@animations/officeRooms';
import { MODULE_BY_ID, stateTKey } from '@core/data/moduleRegistry';
import type { TKey } from '@core/i18n/translations';
import type { TaskStatus } from '@core/types/task';
import { describeSystemStatus } from '@ui/systemStatus';

interface Props {
  onOpenHQ: () => void;
}

function Bar({ label, value, color = '#22d3ee' }: { label: string; value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="gx-card px-4 py-3">
      <div className="flex items-baseline justify-between">
        <div className="gx-label">{label}</div>
        <div className="font-mono text-sm text-zinc-200">{(pct * 100).toFixed(0)}%</div>
      </div>
      <div className="mt-2 h-2 gx-tile">
        <div className="h-full" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function taskStatusKey(s: TaskStatus): TKey {
  return `task.status.${s}` as TKey;
}

function agentDotColor(a: Agent): string {
  switch (a.status) {
    case 'working':    return '#00ff9c';
    case 'moving':     return '#3da9fc';
    case 'onboarding': return '#ffd24a';
    case 'warning':    return '#ff4757';
    case 'suspended':  return '#ff4757';
    case 'retraining': return '#22d3ee';
    default:           return '#4a5568';
  }
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

  const activeAgents = useActiveAgents();
  const onboardingAgents = useOnboardingAgents();
  const allAgentsForUtil = [...activeAgents, ...onboardingAgents];
  const live = useLiveTrading();
  const { truth } = useTruthLayer();
  const systemStatus = describeSystemStatus(truth);
  const [showPerfChart, setShowPerfChart] = useState(false);

  const activeTasks = tasks.filter(
    (x) => x.status === 'assigned' || x.status === 'working' || x.status === 'moving',
  );
  const completedTasks = tasks.filter((x) => x.status === 'completed');
  const failedTasks = tasks.filter((x) => x.status === 'failed');
  const recentEvents = [...events].reverse().slice(0, 6);
  const criticalEvent = [...events].reverse().find((e) => e.severity === 'critical' || e.severity === 'warn');
  const nextHire = queue[0] ?? null;

  const tradingAgents = activeAgents.filter((a) =>
    ['Market Room', 'Risk Office', 'Strategy Lab', 'Execution Desk'].includes(a.department)
  );
  const marketingAgents = activeAgents.filter((a) =>
    ['Growth Room', 'Design Studio'].includes(a.department)
  );

  const totalPnL = live.totalPnL;
  const taskHealth = completedTasks.length + failedTasks.length > 0
    ? completedTasks.length / (completedTasks.length + failedTasks.length)
    : null;

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Executive header */}
        <header>
          {/* Ticker bar */}
          <div className="gx-card px-4 py-2 flex items-center justify-between gap-6 mb-4 overflow-x-auto">
            <div className="flex items-center gap-2 shrink-0">
              <span className="font-mono text-[13px] font-bold text-emerald-400 tracking-wider">GNSS</span>
              <span className="font-mono text-[11px] text-zinc-500">·</span>
              <span className="font-mono text-[11px] text-zinc-300">Genesis HQ Corp</span>
            </div>
            <div className="flex items-center gap-6 font-mono text-[10px] shrink-0">
              <span className="text-zinc-500">
                {lang === 'es' ? 'EDAD' : 'AGE'}: <span className="text-amber-400">{progress.ageHours.toFixed(1)}h</span>
              </span>
              <span className="text-zinc-500">
                CAP: <span style={{ color: live.online && live.capital >= 10000 ? '#00ff9c' : live.online ? '#ff4757' : '#71717a' }}>
                  {live.online ? `$${live.capital.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
                </span>
              </span>
              <span className="text-zinc-500">
                P&L: <span style={{ color: live.online ? (totalPnL >= 0 ? '#00ff9c' : '#ff4757') : '#71717a' }}>
                  {live.online ? `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}` : '—'}
                </span>
              </span>
              <span className="text-zinc-500">
                {lang === 'es' ? 'SALUD' : 'HEALTH'}: <span style={{ color: progress.companyHealth >= 0.7 ? '#00ff9c' : progress.companyHealth >= 0.4 ? '#ffd24a' : '#ff4757' }}>
                  {(progress.companyHealth * 100).toFixed(0)}%
                </span>
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenHQ}
              className="font-mono text-[10px] uppercase tracking-wider px-3 py-1 border border-emerald-400/60 text-emerald-300 hover:bg-emerald-400/10 shrink-0"
            >
              {t('dashboard.jumpToHQ')} →
            </button>
          </div>

          <h1 className="font-mono text-3xl font-bold text-zinc-100 tracking-tight">{t('dashboard.title')}</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">{t('dashboard.realtime')}</p>
        </header>

        <div
          className="border px-4 py-2.5 font-mono text-[11px] leading-snug"
          style={{
            borderColor: systemStatus.tone === 'live' ? 'rgba(0,255,156,0.28)' : systemStatus.tone === 'warn' ? 'rgba(251,191,36,0.28)' : 'rgba(255,71,87,0.28)',
            background: systemStatus.tone === 'live' ? 'rgba(0,255,156,0.05)' : systemStatus.tone === 'warn' ? 'rgba(251,191,36,0.06)' : 'rgba(255,71,87,0.07)',
            color: systemStatus.tone === 'live' ? '#b6f7da' : systemStatus.tone === 'warn' ? '#fde68a' : '#fecaca',
          }}
        >
          <div className="uppercase tracking-[0.18em] text-[10px] mb-1">
            {lang === 'es' ? 'Estado operativo' : 'Operating status'}
          </div>
          <div>{systemStatus.label[lang]}</div>
          <div className="text-zinc-400 mt-1">
            {systemStatus.detail[lang]}
          </div>
        </div>

        {/* Critical alert */}
        {criticalEvent && (
          <div className="border border-amber-400/40 bg-amber-500/5 px-4 py-2.5 flex items-center gap-3">
            <span className="font-mono text-[9px] uppercase tracking-widest text-amber-400 shrink-0">
              {lang === 'es' ? '⚡ ALERTA' : '⚡ ALERT'}
            </span>
            <span className="font-mono text-[11px] text-amber-200 truncate">{criticalEvent.message[lang]}</span>
          </div>
        )}

        {/* Live trading — futures desk in production (futures-only / serverless
            snapshot), legacy prediction-market agent panel when that runner is
            active (local dev). useLiveTrading().futuresMode is the mode signal. */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <span className="gx-overline">
              {lang === 'es' ? 'Agente de Trading · En Vivo' : 'Trading Agent · Live'}
            </span>
            <div className="flex-1 h-px bg-trim" />
          </div>
          {live.futuresMode
            ? <FuturesDeskPanel futuresDesk={live.futuresDesk} es={lang === 'es'} />
            : <AgentLivePanel />}
        </section>

        {/* Research signals + agent skills (live from backend) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ResearchSignalsPanel />
          <SkillsPanel />
        </div>

        {/* 4 Division cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Trading */}
          <div className="border bg-carbon-200 p-4" style={{ borderColor: '#00ff9c44' }}>
            <div className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: '#00ff9c88' }}>
              {lang === 'es' ? 'Trading & Riesgo' : 'Trading & Risk'}
            </div>
            <div className="font-mono text-2xl font-bold" style={{ color: totalPnL >= 0 ? '#00ff9c' : '#ff4757' }}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(0)}
            </div>
            <div className="font-mono text-[9px] text-zinc-500 mt-1">
              P&L · {live.openTrades.length} pos · {live.totalTrades} trades
            </div>
            <div className="mt-2 h-1 bg-carbon-300">
              <div style={{ width: `${Math.min((live.winRate ?? 0) * 100, 100)}%`, background: '#00ff9c', height: '100%' }} />
            </div>
            <div className="font-mono text-[9px] text-zinc-600 mt-1">
              {tradingAgents.length} {lang === 'es' ? 'agentes' : 'agents'} · win rate {live.totalTrades > 0 ? `${(live.winRate * 100).toFixed(0)}%` : '—'}
            </div>
          </div>

          {/* Marketing */}
          <div className="border bg-carbon-200 p-4" style={{ borderColor: '#f59e0b44' }}>
            <div className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: '#f59e0b88' }}>
              {lang === 'es' ? 'Marketing & Growth' : 'Marketing & Growth'}
            </div>
            <div className="font-mono text-2xl font-bold" style={{ color: '#f59e0b' }}>
              {marketingAgents.length > 0 ? `${marketingAgents.length}` : '—'}
            </div>
            <div className="font-mono text-[9px] text-zinc-500 mt-1">
              {lang === 'es' ? 'agentes activos' : 'active agents'}
            </div>
            <div className="mt-2 h-1 bg-carbon-300">
              <div style={{ width: marketingAgents.length > 0 ? '40%' : '0%', background: '#f59e0b', height: '100%' }} />
            </div>
            <div className="font-mono text-[9px] text-zinc-600 mt-1">
              {marketingAgents.length === 0
                ? (lang === 'es' ? 'Sin división — contratar CMO' : 'No division — hire CMO')
                : (lang === 'es' ? 'División activa' : 'Division active')}
            </div>
          </div>

          {/* Tech */}
          <div className="border bg-carbon-200 p-4" style={{ borderColor: '#3da9fc44' }}>
            <div className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: '#3da9fc88' }}>
              {lang === 'es' ? 'Tech & Operaciones' : 'Tech & Operations'}
            </div>
            <div className="font-mono text-2xl font-bold" style={{ color: '#3da9fc' }}>
              {activeTasks.length}
            </div>
            <div className="font-mono text-[9px] text-zinc-500 mt-1">
              {lang === 'es' ? 'tareas activas' : 'active tasks'}
            </div>
            <div className="mt-2 h-1 bg-carbon-300">
              <div style={{
                width: taskHealth !== null ? `${(taskHealth * 100).toFixed(0)}%` : '0%',
                background: '#3da9fc', height: '100%'
              }} />
            </div>
            <div className="font-mono text-[9px] text-zinc-600 mt-1">
              {taskHealth !== null
                ? `${(taskHealth * 100).toFixed(0)}% ${lang === 'es' ? 'tasa de éxito' : 'success rate'}`
                : (lang === 'es' ? 'Sin historial aún' : 'No history yet')}
            </div>
          </div>

          {/* People */}
          <div className="border bg-carbon-200 p-4" style={{ borderColor: '#a855f744' }}>
            <div className="font-mono text-[9px] uppercase tracking-widest mb-2" style={{ color: '#a855f788' }}>
              {lang === 'es' ? 'People & Talento' : 'People & Talent'}
            </div>
            <div className="font-mono text-2xl font-bold" style={{ color: '#a855f7' }}>
              {progress.activeAgents}
            </div>
            <div className="font-mono text-[9px] text-zinc-500 mt-1">
              {lang === 'es' ? 'agentes totales' : 'total agents'}
            </div>
            <div className="mt-2 h-1 bg-carbon-300">
              <div style={{ width: `${(progress.learningLevel * 100).toFixed(0)}%`, background: '#a855f7', height: '100%' }} />
            </div>
            <div className="font-mono text-[9px] text-zinc-600 mt-1">
              {(progress.learningLevel * 100).toFixed(0)}% {lang === 'es' ? 'nivel aprendizaje' : 'learning level'} · {queue.length} {lang === 'es' ? 'en cola' : 'queued'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Bar label={t('metric.learningLevel')} value={progress.learningLevel} color="#22d3ee" />
          <Bar label={t('metric.companyHealth')} value={progress.companyHealth} color="#00ff9c" />
        </div>

        {/* Capital & P&L */}
        <section className="gx-card">
          <header className="gx-card-head flex items-center justify-between">
            <span className="gx-card-title">
              {lang === 'es' ? 'Capital & P&L' : 'Capital & P&L'}
            </span>
            <span className="font-mono text-[11px]" style={{ color: live.online && live.capital >= 10_000 ? '#00ff9c' : live.online ? '#ff4757' : '#71717a' }}>
              {live.online ? `$${live.capital.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
            </span>
          </header>
          <CapitalChart />
          <div className="grid grid-cols-3 gap-3 px-4 pb-3 border-t border-trim pt-3">
            <div className="gx-tile px-3 py-2">
              <div className="gx-label">P&L total</div>
              <div
                className="font-mono text-lg mt-0.5"
                style={{ color: live.online ? (live.totalPnL >= 0 ? '#00ff9c' : '#ff4757') : '#71717a' }}
              >
                {live.online ? `${live.totalPnL >= 0 ? '+' : ''}$${live.totalPnL.toFixed(2)}` : '—'}
              </div>
            </div>
            <div className="gx-tile px-3 py-2">
              <div className="gx-label">
                {lang === 'es' ? 'Posiciones' : 'Positions'}
              </div>
              <div className="font-mono text-lg mt-0.5" style={{ color: '#3da9fc' }}>
                {live.online ? live.openTrades.length : '—'}
              </div>
            </div>
            <div className="gx-tile px-3 py-2">
              <div className="gx-label">Win rate</div>
              <div className="font-mono text-lg mt-0.5" style={{ color: '#ffd24a' }}>
                {live.online && live.totalTrades > 0 ? `${(live.winRate * 100).toFixed(0)}%` : '—'}
              </div>
            </div>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Active tasks */}
          <section className="gx-card">
            <header className="gx-card-head flex items-center justify-between">
              <span className="gx-card-title">
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
          <section className="gx-card">
            <header className="gx-card-head flex items-center justify-between">
              <span className="gx-card-title">
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
          <section className="gx-card">
            <header className="gx-card-head gx-card-title">
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

          <section className="gx-card">
            <header className="gx-card-head gx-card-title">
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
        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
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

        {/* Agent utilization */}
        <section className="gx-card">
          <header className="gx-card-head flex items-center justify-between">
            <span className="gx-card-title">
              {lang === 'es' ? 'Utilización de agentes' : 'Agent utilization'}
            </span>
            <div className="flex gap-3 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
              {[
                { color: '#00ff9c', label: lang === 'es' ? 'trabajando' : 'working' },
                { color: '#3da9fc', label: lang === 'es' ? 'moviendo'   : 'moving' },
                { color: '#ffd24a', label: 'onboarding' },
                { color: '#ff4757', label: lang === 'es' ? 'alerta'     : 'alert' },
                { color: '#4a5568', label: lang === 'es' ? 'inactivo'   : 'idle' },
              ].map(({ color, label }) => (
                <span key={label} className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
          </header>
          {allAgentsForUtil.length === 0 ? (
            <div className="px-4 py-4 font-mono text-[11px] text-zinc-500">—</div>
          ) : (
            <div className="px-4 py-4 flex flex-wrap gap-2">
              {allAgentsForUtil.map((a) => (
                <span
                  key={a.id}
                  title={`${a.name} · ${a.status}${(a.totalPnL ?? 0) !== 0 ? ` · P&L ${a.totalPnL! >= 0 ? '+' : ''}$${a.totalPnL!.toFixed(2)}` : ''}`}
                  className="inline-block w-3 h-3 rounded-full border border-black/20"
                  style={{ background: agentDotColor(a) }}
                />
              ))}
            </div>
          )}
          <div className="border-t border-trim">
            <button
              type="button"
              onClick={() => setShowPerfChart((v) => !v)}
              className="w-full px-4 py-2 gx-label hover:text-zinc-300 text-left"
            >
              {showPerfChart
                ? (lang === 'es' ? '▲ Ocultar rendimiento' : '▲ Hide performance')
                : (lang === 'es' ? '▼ Ver rendimiento por agente' : '▼ Agent performance chart')}
            </button>
            {showPerfChart && <AgentPerformanceChart />}
          </div>
        </section>
      </div>
    </main>
  );
}
