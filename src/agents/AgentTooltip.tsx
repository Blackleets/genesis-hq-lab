// AgentTooltip — small HTML overlay shown when hovering an agent in the
// world. Bilingual.

import { tr } from '@core/i18n/translations';
import { useLanguage, useT } from '@core/i18n/languageStore';
import type { Agent, AgentStatus } from '@core/types/genesis';
import type { TKey } from '@core/i18n/translations';
import { pickRole } from '@agents/agentHelpers';
import { agentEvolution } from '@animations/agentEvolution';
import AgentSpritePreview from '@agents/AgentSpritePreview';

interface Props {
  agent: Agent;
  x: number;
  y: number;
}

function statusKey(s: AgentStatus): TKey {
  return `status.${s}` as TKey;
}

export default function AgentTooltip({ agent, x, y }: Props) {
  const t = useT();
  const lang = useLanguage();
  const ev = agentEvolution(agent);
  const accent = agent.visualProfile?.accent ?? '#3da9fc';
  return (
    <div
      className="pointer-events-none fixed z-50 select-none"
      style={{ left: x + 14, top: y + 14 }}
    >
      <div className="gx-tile shadow-lg px-3 py-2 font-mono text-[11px] leading-tight flex gap-2.5">
        {/* Live evolved sprite — instantly shows the agent's tier */}
        <div className="shrink-0 flex items-end" style={{ width: 50 }}>
          <AgentSpritePreview agent={agent} size={50} />
        </div>
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div className="text-zinc-100">{agent.name}</div>
            <span className="text-[9px] uppercase tracking-wider shrink-0" style={{ color: accent }}>
              {ev.tier.name[lang]} · {lang === 'es' ? 'Niv' : 'Lv'} {ev.level}
            </span>
          </div>
          <div className="text-zinc-400">{pickRole(agent.role, lang)}</div>
          <div className="text-zinc-500 mt-1">
            <span className="uppercase tracking-wider text-zinc-600">{t('inspector.status')}</span>{' '}
            <span className="text-zinc-300">{tr(statusKey(agent.status), lang)}</span>
          </div>
          {agent.currentTask && (
            <div className="text-zinc-500 max-w-[260px] mt-1">
              <span className="uppercase tracking-wider text-zinc-600">{t('inspector.currentTask')}</span>{' '}
              <span className="text-zinc-300">{agent.currentTask[lang]}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
