// PerformanceBadge — compact tier + score chip for TradingAgent display.
// Renders a color-coded tier label and optional 0–100 performance score.

import type { TradingAgent } from '@core/types/tradingAgent';
import { tradingPerformanceScore, TIER_LABELS, TIER_COLORS } from '@agents/utils/tradingAgentUtils';
import { useLanguage } from '@core/i18n/languageStore';

interface Props {
  agent: TradingAgent;
  showScore?: boolean;
  size?: 'sm' | 'md';
}

export default function PerformanceBadge({ agent, showScore = true, size = 'sm' }: Props) {
  const lang = useLanguage();
  const score = tradingPerformanceScore(agent.performanceMetrics);
  const color = TIER_COLORS[agent.tier];
  const label = TIER_LABELS[agent.tier][lang];
  const textClass = size === 'md' ? 'text-[11px]' : 'text-[9px]';

  return (
    <div className={`inline-flex items-center gap-1.5 font-mono ${textClass}`}>
      <span
        className="px-1.5 py-0.5 uppercase tracking-wider border"
        style={{ color, borderColor: `${color}66`, background: `${color}11` }}
      >
        {label}
      </span>
      {showScore && (
        <span>
          <span style={{ color }}>{score}</span>
          <span className="text-zinc-600">/100</span>
        </span>
      )}
    </div>
  );
}
