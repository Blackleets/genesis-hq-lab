// AgentInspector — slide-in panel on the right that appears when an agent
// is clicked. Shows full data + action buttons. Actions are visual-only
// (no backend yet). Pixel-style chrome, hard borders. Bilingual.

import { useT } from '../i18n/languageStore';
import { tr, type Lang, type TKey } from '../i18n/translations';
import { useLanguage } from '../i18n/languageStore';
import type { Agent, AgentStatus } from '../types/genesis';
import { pickRole } from '../lib/agentHelpers';
import { actions } from '../state/genesisStore';

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
      <div className="mt-1 h-2 bg-carbon-300 border border-trim">
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

export default function AgentInspector({ agent, onClose, onAction }: Props) {
  const t = useT();
  const lang: Lang = useLanguage();
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
        {agent.isVisualSeed && (
          <div className="font-mono text-[10px] uppercase tracking-wider text-amber-300 border border-amber-300/40 bg-amber-300/5 px-2 py-1">
            {t('inspector.visualSeed')}
          </div>
        )}

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
            <div className="text-zinc-500 uppercase tracking-wider">{t('inspector.pose')}</div>
            <div className="text-zinc-200">{agent.position.pose ?? '—'}</div>
          </div>
        </section>

        {agent.currentTask && (
          <section className="border border-trim bg-carbon-300 p-3 font-mono text-[11px]">
            <div className="text-zinc-500 uppercase tracking-wider mb-1">{t('inspector.currentTask')}</div>
            <div className="text-zinc-200 leading-snug">{agent.currentTask}</div>
          </section>
        )}

        <section className="space-y-3">
          <Bar label={t('inspector.trust')}    value={agent.trustScore}    color="#3da9fc" />
          <Bar label={t('inspector.learning')} value={agent.learningScore} color="#22d3ee" />
        </section>

        <section>
          <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500 mb-2">
            {t('inspector.actionsTitle')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ActionButton onClick={() => onAction?.('assign', agent)}>{t('inspector.actionAssign')}</ActionButton>
            <ActionButton tone="gold" onClick={() => onAction?.('promote', agent)}>{t('inspector.actionPromote')}</ActionButton>
            <ActionButton onClick={() => onAction?.('retrain', agent)}>{t('inspector.actionRetrain')}</ActionButton>
            <ActionButton tone="warn" onClick={() => onAction?.('suspend', agent)}>{t('inspector.actionSuspend')}</ActionButton>
            <ActionButton tone="danger" onClick={() => {
              actions.fireAgent(agent.id);
              onAction?.('fire', agent);
            }}>{t('inspector.actionFire')}</ActionButton>
          </div>
          <div className="font-mono text-[10px] text-zinc-600 mt-2 leading-snug">
            {t('inspector.note')}
          </div>
        </section>
      </div>
    </aside>
  );
}
