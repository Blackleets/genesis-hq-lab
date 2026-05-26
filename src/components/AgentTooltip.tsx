// AgentTooltip — small HTML overlay shown when hovering an agent in the
// world. Bilingual.

import { tr } from '../i18n/translations';
import { useLanguage, useT } from '../i18n/languageStore';
import type { Agent, AgentStatus } from '../types/genesis';
import type { TKey } from '../i18n/translations';
import { pickRole } from '../lib/agentHelpers';

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
  return (
    <div
      className="pointer-events-none fixed z-50 select-none"
      style={{ left: x + 14, top: y + 14 }}
    >
      <div className="bg-carbon-300 border border-trim shadow-lg px-3 py-2 font-mono text-[11px] leading-tight">
        <div className="text-zinc-100">{agent.name}</div>
        <div className="text-zinc-400">{pickRole(agent.role, lang)}</div>
        <div className="text-zinc-500 mt-1">
          <span className="uppercase tracking-wider text-zinc-600">{t('inspector.status')}</span>{' '}
          <span className="text-zinc-300">{tr(statusKey(agent.status), lang)}</span>
        </div>
        {agent.currentTask && (
          <div className="text-zinc-500 max-w-[260px] mt-1">
            <span className="uppercase tracking-wider text-zinc-600">{t('inspector.currentTask')}</span>{' '}
            <span className="text-zinc-300">{agent.currentTask}</span>
          </div>
        )}
      </div>
    </div>
  );
}
