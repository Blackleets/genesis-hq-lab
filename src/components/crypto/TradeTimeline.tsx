// TradeTimeline.tsx — clickable trade history for the DeskPanel TRADES tab.
// Selecting a row drives the chart (markers highlight + replay pan) via onSelect.

import type { TradeStory } from '@services/cryptoClient';

const EXIT_BADGE: Record<string, { label: string; color: string }> = {
  TP:         { label: 'TP',   color: '#22c55e' },
  SL:         { label: 'SL',   color: '#ef4444' },
  TIMEOUT:    { label: 'TIME', color: '#f59e0b' },
  CONFIDENCE: { label: 'CONF', color: '#f97316' },
  EXIT:       { label: 'EXIT', color: '#9ca3af' },
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h  = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mo}/${da} ${h}:${mi}`;
  } catch { return '—'; }
}

interface Props {
  trades: TradeStory[];
  selectedTradeId: string | null;
  onSelect?: (id: string | null) => void;
  es: boolean;
}

export function TradeTimeline({ trades, selectedTradeId, onSelect, es }: Props) {
  if (trades.length === 0) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#374151', fontSize: 10, fontFamily: 'monospace' }}>
          {es ? 'Sin trades aún.' : 'No trades yet.'}
        </span>
      </div>
    );
  }

  return (
    <div className="gx-scroll" style={{ height: '100%', overflowY: 'auto', fontFamily: 'monospace' }}>
      {trades.map(t => {
        const sym    = t.pair.replace('USDT', '');
        const isLong = t.side === 'LONG';
        const sideColor = isLong ? '#22c55e' : '#a855f7';
        const badge  = t.exit_kind ? EXIT_BADGE[t.exit_kind] ?? EXIT_BADGE.EXIT : null;
        const pnl    = t.pnl;
        const pnlColor = pnl == null ? '#6b7280' : pnl >= 0 ? '#22c55e' : '#ef4444';
        const sel    = t.id === selectedTradeId;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect?.(sel ? null : t.id)}
            style={{
              width: '100%', textAlign: 'left', cursor: 'pointer',
              display: 'grid', gridTemplateColumns: '74px 40px 1fr 56px 36px',
              gap: 6, alignItems: 'center', padding: '5px 10px',
              border: 'none', borderBottom: '1px solid #0d1117',
              borderLeft: sel ? `2px solid ${sideColor}` : '2px solid transparent',
              background: sel ? 'rgba(168,85,247,0.08)' : 'transparent',
              fontFamily: 'monospace',
            }}
          >
            <span style={{ color: '#4b5563', fontSize: 9 }}>{formatTime(t.opened_at)}</span>
            <span style={{ color: sideColor, fontSize: 10, fontWeight: 700 }}>{isLong ? '▲' : '▼'}{t.side === 'LONG' ? 'L' : 'S'}</span>
            <span style={{ color: '#9ca3af', fontSize: 10 }}>
              {sym}
              <span style={{ color: '#374151', marginLeft: 4 }}>{Math.round((t.confidence ?? 0) * 100)}%</span>
            </span>
            <span style={{ color: pnlColor, fontSize: 10, fontWeight: 700, textAlign: 'right' }}>
              {pnl == null ? '—' : pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
            </span>
            <span style={{
              fontSize: 7, fontWeight: 700, textAlign: 'right',
              color: badge ? badge.color : '#3b82f6',
            }}>
              {badge ? badge.label : 'OPEN'}
            </span>
          </button>
        );
      })}
    </div>
  );
}
