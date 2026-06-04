// AgentInspector — slide-in panel on the right that appears when an agent
// is clicked. Shows full data + action buttons. Bilingual.

import { useState } from 'react';
import { useT } from '@core/i18n/languageStore';
import { tr, type Lang, type TKey } from '@core/i18n/translations';
import { useLanguage } from '@core/i18n/languageStore';
import type { Agent, AgentStatus } from '@core/types/genesis';
import { pickRole } from '@agents/agentHelpers';
import { actions, useTaskById, useTasks } from '@core/store/genesisStore';
import type { TaskStatus } from '@core/types/task';
import { agentEvolution } from '@animations/agentEvolution';
import AgentSpritePreview from '@agents/AgentSpritePreview';

interface Props {
  agent: Agent | null;
  onClose: () => void;
  onAction?: (kind: 'assign' | 'promote' | 'retrain' | 'suspend' | 'fire', agent: Agent) => void;
}

function statusKey(s: AgentStatus): TKey {
  return `status.${s}` as TKey;
}

function Bar({ label, value, color = '#3da9fc' }: { label: string; value: number; color?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="font-mono text-[11px]">
      <div className="flex items-baseline justify-between">
        <span className="text-zinc-500 uppercase tracking-wider">{label}</span>
        <span className="text-zinc-200">{(pct * 100).toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-2 gx-tile">
        <div className="h-full" style={{ width: `${pct * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function ActionButton({ children, tone = 'default', onClick }: { children: React.ReactNode; tone?: 'default' | 'warn' | 'danger' | 'gold'; onClick?: () => void }) {
  const toneClass =
    tone === 'warn'   ? 'border-amber-400/60 text-amber-300 hover:bg-amber-400/10' :
    tone === 'danger' ? 'border-red-400/60 text-red-300 hover:bg-red-400/10' :
    tone === 'gold'   ? 'border-yellow-300/60 text-yellow-200 hover:bg-yellow-300/10' :
                        'border-trim text-zinc-200 hover:bg-white/5';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-mono text-[11px] uppercase tracking-wider px-3 py-1.5 border ${toneClass} bg-carbon-300`}
    >
      {children}
    </button>
  );
}

function taskStatusColor(s: TaskStatus): string {
  switch (s) {
    case 'working':   return '#00ff9c';
    case 'assigned':  return '#3da9fc';
    case 'moving':    return '#22d3ee';
    case 'blocked':   return '#ff4757';
    case 'completed': return '#9ca3af';
    case 'failed':    return '#ff4757';
    default:          return '#9ca3af';
  }
}

function EvolutionBadge({ agent, lang }: { agent: Agent; lang: Lang }) {
  const ev = agentEvolution(agent);
  const accent = agent.visualProfile?.accent ?? '#3da9fc';
  return (
    <section
      className="gx-tile p-3 relative overflow-hidden"
      style={{ boxShadow: `inset 0 0 24px -8px ${accent}55` }}
    >
      <div className="flex items-center gap-3">
        {/* Live sprite — the agent as it actually looks in-world at this tier */}
        <div className="shrink-0 flex items-end justify-center" style={{ width: 76 }}>
          <AgentSpritePreview agent={agent} size={76} />
        </div>
        <div className="flex-1 flex items-center justify-between">
          <div>
            <div className="font-mono text-[9px] uppercase tracking-[0.2em]" style={{ color: accent }}>
              {ev.tier.name[lang]}
            </div>
            <div className="font-mono text-[10px] text-zinc-500 mt-0.5">
              {lang === 'es' ? 'Nivel' : 'Level'} {ev.level}
            </div>
          </div>
          <div
            className="font-mono text-2xl font-bold tabular-nums"
            style={{ color: accent, textShadow: `0 0 12px ${accent}66` }}
          >
            {ev.level}
          </div>
        </div>
      </div>
      {/* Progress toward next tier */}
      <div className="mt-2.5 h-1 bg-carbon-300 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${ev.tierProgress * 100}%`, background: accent }}
        />
      </div>
      <div className="font-mono text-[8px] uppercase tracking-wider text-zinc-600 mt-1">
        {ev.tier.id === 'legendary'
          ? (lang === 'es' ? 'Tier máximo alcanzado' : 'Max tier reached')
          : `${Math.round(ev.tierProgress * 100)}% ${lang === 'es' ? 'al siguiente tier' : 'to next tier'}`}
      </div>
    </section>
  );
}

export default function AgentInspector({ agent, onClose, onAction }: Props) {
  const t = useT();
  const lang: Lang = useLanguage();
  const currentTask = useTaskById(agent?.currentTaskId);
  const allTasks = useTasks();
  const [assigning, setAssigning] = useState(false);

  const assignableTasks = allTasks.filter(
    (t) => t.status === 'queued' && (!t.assignedAgentIds?.length || t.assignedAgentIds.length === 0),
  );

  if (!agent) return null;

  return (
    <aside className="absolute top-0 right-0 bottom-0 w-[320px] z-40 bg-carbon-200 border-l border-trim shadow-2xl flex flex-col">
      <header className="flex items-start justify-between gap-3 px-4 py-3 border-b border-trim">
        <div className="min-w-0">
          <div className="font-mono text-sm text-zinc-100 truncate">{agent.name}</div>
          <div className="font-mono text-[11px] text-zinc-500 truncate">{pickRole(agent.role, lang)}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-100 font-mono text-xs px-2 py-1 border border-trim hover:border-zinc-500"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <EvolutionBadge agent={agent} lang={lang} />
        <section className="grid grid-cols-2 gap-3 font-mono text-[11px]">
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">{t('inspector.dept')}</div>
            <div className="text-zinc-200">{agent.department}</div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">{t('inspector.rank')}</div>
            <div className="text-zinc-200">{agent.rank}</div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">{t('inspector.status')}</div>
            <div className="text-zinc-200">{tr(statusKey(agent.status), lang)}</div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">{lang === 'es' ? 'Movimiento' : 'Movement'}</div>
            <div className="text-zinc-200">{agent.movementState ?? 'still'}</div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">{lang === 'es' ? 'Sala actual' : 'Current room'}</div>
            <div className="text-zinc-200 text-[10px]">{agent.currentRoom}</div>
          </div>
          <div>
            <div className="text-zinc-500 uppercase tracking-wider">{lang === 'es' ? 'Sala destino' : 'Target room'}</div>
            <div className="text-zinc-200 text-[10px]">{agent.targetRoom ?? '—'}</div>
          </div>
        </section>

        {currentTask ? (
          <section className="gx-tile p-3 font-mono text-[11px] space-y-1.5">
            <div className="text-zinc-500 uppercase tracking-wider">{t('inspector.currentTask')}</div>
            <div className="text-zinc-200 leading-snug">{currentTask.title[lang]}</div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="uppercase tracking-wider text-[9px] px-1.5 py-0.5 border border-trim" style={{ color: taskStatusColor(currentTask.status) }}>
                {currentTask.status}
              </span>
              <span className="text-zinc-600 text-[9px]">{currentTask.type}</span>
              <span className="text-zinc-600 text-[9px]">{currentTask.room}</span>
            </div>
          </section>
        ) : agent.currentTask ? (
          <section className="gx-tile p-3 font-mono text-[11px]">
            <div className="text-zinc-500 uppercase tracking-wider mb-1">{t('inspector.currentTask')}</div>
            <div className="text-zinc-200 leading-snug">{agent.currentTask[lang]}</div>
          </section>
        ) : null}

        <section className="space-y-3">
          <Bar label={t('inspector.trust')}    value={agent.trustScore}    color="#3da9fc" />
          <Bar label={t('inspector.learning')} value={agent.learningScore} color="#22d3ee" />
        </section>

        {(agent.mistakeCount ?? 0) > 0 && (
          <section className="border border-amber-400/50 bg-amber-500/10 px-3 py-2 font-mono text-[11px] text-amber-300">
            ⚠ {agent.mistakeCount} {lang === 'es' ? 'error(es) registrado(s)' : 'mistake(s) recorded'}
          </section>
        )}

        {((agent.tradeCount ?? 0) > 0 || (agent.totalPnL ?? 0) !== 0) && (
          <section>
            <div className="gx-label mb-2">
              {lang === 'es' ? 'Trading' : 'Trading'}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="gx-tile px-2 py-2">
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">P&L</div>
                <div
                  className="font-mono text-sm mt-0.5"
                  style={{ color: (agent.totalPnL ?? 0) >= 0 ? '#00ff9c' : '#ff4757' }}
                >
                  {(agent.totalPnL ?? 0) >= 0 ? '+' : ''}${(agent.totalPnL ?? 0).toFixed(2)}
                </div>
              </div>
              <div className="gx-tile px-2 py-2">
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                  {lang === 'es' ? 'Trades' : 'Trades'}
                </div>
                <div className="font-mono text-sm mt-0.5 text-zinc-100">{agent.tradeCount ?? 0}</div>
              </div>
              <div className="gx-tile px-2 py-2">
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-500">Win%</div>
                <div className="font-mono text-sm mt-0.5" style={{ color: '#ffd24a' }}>
                  {(agent.tradeCount ?? 0) > 0 ? `${((agent.winRate ?? 0) * 100).toFixed(0)}%` : '—'}
                </div>
              </div>
            </div>
          </section>
        )}

        {agent.capabilities.length > 0 && (
          <section>
            <div className="gx-label mb-2">
              {lang === 'es' ? 'Capacidades' : 'Capabilities'}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {agent.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="font-mono text-[9px] uppercase tracking-wider border border-trim px-1.5 py-0.5 text-zinc-400"
                >
                  {cap.replace(/_/g, ' ')}
                </span>
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="gx-label mb-2">
            {t('inspector.actionsTitle')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton onClick={() => setAssigning((v) => !v)}>{t('inspector.actionAssign')}</ActionButton>
            <ActionButton tone="gold" onClick={() => { actions.promoteAgent(agent.id); onAction?.('promote', agent); }}>{t('inspector.actionPromote')}</ActionButton>
            <ActionButton onClick={() => { actions.retrainAgent(agent.id); onAction?.('retrain', agent); }}>{t('inspector.actionRetrain')}</ActionButton>
            <ActionButton tone="warn" onClick={() => { actions.suspendAgent(agent.id); onAction?.('suspend', agent); }}>{t('inspector.actionSuspend')}</ActionButton>
            <ActionButton tone="danger" onClick={() => {
              actions.fireAgent(agent.id);
              onAction?.('fire', agent);
            }}>{t('inspector.actionFire')}</ActionButton>
          </div>
        </section>

        {assigning && (
          <section className="border border-[#3da9fc]/40 bg-carbon-300 p-3">
            <div className="font-mono text-[10px] uppercase tracking-wider text-[#3da9fc] mb-2">
              {lang === 'es' ? 'Asignar tarea' : 'Assign task'}
            </div>
            {assignableTasks.length === 0 ? (
              <div className="font-mono text-[11px] text-zinc-500">
                {lang === 'es' ? 'No hay tareas en cola sin asignar.' : 'No unassigned queued tasks.'}
              </div>
            ) : (
              <ul className="space-y-1.5">
                {assignableTasks.slice(0, 8).map((task) => (
                  <li key={task.id}>
                    <button
                      type="button"
                      className="w-full text-left font-mono text-[11px] px-2 py-1.5 border border-trim text-zinc-200 hover:bg-[#3da9fc]/10 hover:border-[#3da9fc]/50"
                      onClick={() => {
                        actions.assignTask(task.id, [agent.id]);
                        setAssigning(false);
                        onAction?.('assign', agent);
                      }}
                    >
                      <div className="truncate">{task.title[lang]}</div>
                      <div className="text-zinc-500 text-[9px] mt-0.5">{task.room} · {task.type}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button
              type="button"
              className="mt-2 font-mono text-[10px] text-zinc-500 hover:text-zinc-300"
              onClick={() => setAssigning(false)}
            >
              {lang === 'es' ? '↑ cancelar' : '↑ cancel'}
            </button>
          </section>
        )}
      </div>
    </aside>
  );
}
