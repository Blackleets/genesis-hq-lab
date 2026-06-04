import type { Agent } from '@core/types/genesis';
import type { Task } from '@core/types/task';
import type { PaperPosition } from '@core/types/trading';
import type { Lang } from '@core/i18n/translations';

interface Props {
  agent: Agent;
  visualX: number;
  visualY: number;
  task: Task | null;
  position: PaperPosition | null;
  lang: Lang;
  progress?: number;
}

// Compact single-line work label — replaces the noisy card overlay.
// Shows only what the agent is doing right now, nothing else.
export default function AgentWorkOverlay({ agent, visualX, visualY, task, position, lang, progress }: Props) {
  const taskTitle = task?.title[lang] ?? agent.currentTask?.[lang] ?? null;

  const unrealizedPnL = position
    ? (position.currentPrice - position.entryPrice) * position.shares * (position.outcome === 'YES' ? 1 : -1)
    : null;

  const label = taskTitle
    ? taskTitle.length > 24 ? taskTitle.slice(0, 23) + '…' : taskTitle
    : (lang === 'es' ? 'procesando…' : 'processing…');

  const W = 118;
  const px = Math.max(0, Math.min(800 - W, visualX - W / 2));
  const py = Math.max(2, visualY - 62);

  return (
    // translate="no" prevents Chrome auto-translate from turning "min" → "metros"
    <div
      translate="no"
      className="absolute pointer-events-none select-none"
      style={{
        left: px,
        top: py,
        width: W,
        fontFamily: 'monospace',
        fontSize: 8,
        background: 'rgba(8,11,20,0.84)',
        border: '1px solid rgba(61,169,252,0.25)',
        padding: '2px 4px 3px',
        lineHeight: 1.3,
      }}
    >
      {/* Agent name + progress % on one line */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 1 }}>
        <span style={{ color: '#e4e4e7', fontWeight: 'bold', fontSize: 7, letterSpacing: '0.06em' }}>
          {agent.name.split(' ')[0].toUpperCase()}
        </span>
        <span style={{ color: '#4a5568', fontSize: 7 }}>
          {progress !== undefined ? `${Math.round(progress * 100)}%` : '—'}
        </span>
      </div>

      {/* Task title */}
      <div style={{ color: '#6b7280', fontSize: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </div>

      {/* Polymarket P&L — only when there's an open position */}
      {position && unrealizedPnL !== null && (
        <div style={{ color: unrealizedPnL >= 0 ? '#00ff9c' : '#ff4757', fontSize: 7, marginTop: 1 }}>
          {position.outcome} {unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toFixed(2)}
        </div>
      )}

      {/* Slim progress bar */}
      {progress !== undefined && (
        <div style={{ marginTop: 2, height: 2, background: '#1e2535' }}>
          <div style={{ height: 2, width: `${Math.round(Math.min(progress, 1) * 100)}%`, background: '#00ff9c' }} />
        </div>
      )}
    </div>
  );
}
