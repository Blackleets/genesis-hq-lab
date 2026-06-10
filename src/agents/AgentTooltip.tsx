// AgentTooltip — premium hover overlay for agents in the office world.
// Shows tier badge, level, status, current task, and quick performance stats.
// Bilingual. Accepts optional tradingData for trading-role agents.

import { tr } from '@core/i18n/translations';
import { useLanguage, useT } from '@core/i18n/languageStore';
import type { Agent, AgentStatus } from '@core/types/genesis';
import type { TKey } from '@core/i18n/translations';
import type { TradingAgent } from '@core/types/tradingAgent';
import { pickRole } from '@agents/agentHelpers';
import { agentEvolution } from '@animations/agentEvolution';
import AgentSpritePreview from '@agents/AgentSpritePreview';
import PerformanceBadge from '@agents/PerformanceBadge';
import { STATUS_COLORS, tradingPerformanceScore } from '@agents/utils/tradingAgentUtils';

interface Props {
  agent: Agent;
  x: number;
  y: number;
  /** Optional TradingAgent to show performance quick-stats */
  tradingData?: TradingAgent | null;
}

function statusKey(s: AgentStatus): TKey {
  return `status.${s}` as TKey;
}

export default function AgentTooltip({ agent, x, y, tradingData }: Props) {
  const t = useT();
  const lang = useLanguage();
  const ev = agentEvolution(agent);
  const accent = agent.visualProfile?.accent ?? '#3da9fc';
  const tierAccent = tradingData ? (STATUS_COLORS[tradingData.currentStatus] ?? accent) : accent;

  return (
    <div
      className="pointer-events-none fixed z-50 select-none"
      style={{ left: x + 14, top: y + 14 }}
    >
      <div
        className="shadow-2xl font-mono text-[11px] leading-tight"
        style={{
          background: 'rgba(14,14,14,0.96)',
          border: `1px solid ${accent}44`,
          boxShadow: `0 4px 24px ${accent}22, 0 0 0 1px ${accent}1a`,
          minWidth: 200,
          maxWidth: 280,
        }}
      >
        {/* Top strip: accent line */}
        <div className="h-0.5 w-full" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />

        <div className="flex gap-2.5 px-3 py-2.5">
          {/* Evolved sprite */}
          <div className="shrink-0 flex items-end" style={{ width: 50 }}>
            <AgentSpritePreview agent={agent} size={50} />
          </div>

          <div className="min-w-0 flex-1">
            {/* Name + tier row */}
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="text-zinc-100 truncate font-semibold">{agent.name}</div>
              <div className="shrink-0 flex items-center gap-1">
                {/* Active status dot */}
                {tradingData && (
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      background: tierAccent,
                      boxShadow: `0 0 5px ${tierAccent}`,
                    }}
                  />
                )}
                <span className="text-[9px] uppercase tracking-wider" style={{ color: accent }}>
                  {ev.tier.name[lang]} · {lang === 'es' ? 'Niv' : 'Lv'}&nbsp;{ev.level}
                </span>
              </div>
            </div>

            {/* Role */}
            <div className="text-zinc-500 truncate text-[10px] mb-1.5">{pickRole(agent.role, lang)}</div>

            {/* Status */}
            <div className="text-zinc-600">
              <span className="uppercase tracking-wider text-zinc-700">{t('inspector.status')}&nbsp;</span>
              <span className="text-zinc-300">{tr(statusKey(agent.status), lang)}</span>
            </div>

            {/* Current task */}
            {agent.currentTask && (
              <div className="text-zinc-600 mt-0.5 max-w-[220px]">
                <span className="uppercase tracking-wider text-zinc-700">{t('inspector.currentTask')}&nbsp;</span>
                <span className="text-zinc-400 leading-snug">{agent.currentTask[lang]}</span>
              </div>
            )}
          </div>
        </div>

        {/* Trading quick-stats — only shown for trading-role agents */}
        {tradingData && (
          <>
            <div className="h-px mx-3" style={{ background: `${accent}22` }} />
            <div className="px-3 py-2 flex items-center justify-between gap-3">
              <PerformanceBadge agent={tradingData} showScore size="sm" />
              {tradingData.performanceMetrics.completedTasks > 0 && (
                <div className="flex items-center gap-2 text-[9px] text-zinc-600">
                  <span>
                    <span className="text-zinc-400">{tradingData.performanceMetrics.completedTasks}</span>
                    {' '}tasks
                  </span>
                  {tradingData.performanceMetrics.winRate > 0 && (
                    <span>
                      <span style={{ color: '#00ff9c' }}>
                        {(tradingData.performanceMetrics.winRate * 100).toFixed(0)}%
                      </span>
                      {' '}win
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Active tools floating row */}
            {tradingData.visualTraits.activeTools.length > 0 && (
              <div className="px-3 pb-2 flex gap-1 flex-wrap">
                {tradingData.visualTraits.activeTools.map(tool => (
                  <span
                    key={tool}
                    className="text-[8px] px-1 py-0.5 uppercase tracking-wider"
                    style={{ color: accent, border: `1px solid ${accent}33`, background: `${accent}0d` }}
                  >
                    {tool}
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {/* Score bar — tier progress */}
        <div className="h-0.5 mx-0" style={{ background: '#1a1a1a' }}>
          <div
            className="h-full transition-all"
            style={{
              width: `${ev.tierProgress * 100}%`,
              background: `linear-gradient(90deg, ${accent}88, ${accent})`,
            }}
          />
        </div>
      </div>
    </div>
  );
}
