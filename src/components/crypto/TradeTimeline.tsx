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
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${mo}/${da} ${h}:${mi}`;
  } catch {
    return '--';
  }
}

function fmtPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return value >= 1000 ? value.toFixed(2) : value.toFixed(4);
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
          {es ? 'Sin trades aun.' : 'No trades yet.'}
        </span>
      </div>
    );
  }

  return (
    <div className="gx-scroll" style={{ height: '100%', overflowY: 'auto', fontFamily: 'monospace' }}>
      {trades.map((trade) => {
        const symbol = trade.pair.replace('USDT', '');
        const isLong = trade.side === 'LONG';
        const sideColor = isLong ? '#22c55e' : '#a855f7';
        const badge = trade.exit_kind ? EXIT_BADGE[trade.exit_kind] ?? EXIT_BADGE.EXIT : null;
        const pnl = trade.pnl;
        const pnlColor = pnl == null ? '#6b7280' : pnl >= 0 ? '#22c55e' : '#ef4444';
        const selected = trade.id === selectedTradeId;

        return (
          <button
            key={trade.id}
            type="button"
            onClick={() => onSelect?.(selected ? null : trade.id)}
            style={{
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              padding: '8px 10px',
              border: 'none',
              borderBottom: '1px solid #0d1117',
              borderLeft: selected ? `2px solid ${sideColor}` : '2px solid transparent',
              background: selected ? 'rgba(168,85,247,0.08)' : 'transparent',
              fontFamily: 'monospace',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '78px 42px 1fr 74px 42px', gap: 6, alignItems: 'center' }}>
              <span style={{ color: '#4b5563', fontSize: 9 }}>{formatTime(trade.opened_at)}</span>
              <span style={{ color: sideColor, fontSize: 10, fontWeight: 700 }}>{isLong ? '▲L' : '▼S'}</span>
              <span style={{ color: '#e5e7eb', fontSize: 11, fontWeight: 700 }}>{symbol}</span>
              <span style={{ color: pnlColor, fontSize: 10, fontWeight: 700, textAlign: 'right' }}>
                {pnl == null ? '--' : pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
              </span>
              <span
                style={{
                  fontSize: 7,
                  fontWeight: 700,
                  textAlign: 'right',
                  color: badge ? badge.color : '#3b82f6',
                }}
              >
                {badge ? badge.label : 'OPEN'}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 9 }}>
              <span style={{ color: '#6b7280' }}>
                conf <span style={{ color: '#93c5fd' }}>{Math.round((trade.confidence ?? 0) * 100)}%</span>
              </span>
              <span style={{ color: '#6b7280' }}>
                in <span style={{ color: '#9ca3af' }}>${fmtPrice(trade.entry_price)}</span>
              </span>
              {trade.exit_price != null ? (
                <span style={{ color: '#6b7280' }}>
                  out <span style={{ color: '#9ca3af' }}>${fmtPrice(trade.exit_price)}</span>
                </span>
              ) : null}
              {trade.capital_used != null ? (
                <span style={{ color: '#6b7280' }}>
                  cap <span style={{ color: '#d4d4d8' }}>${Math.round(trade.capital_used)}</span>
                </span>
              ) : null}
              {trade.leverage && trade.leverage > 1 ? (
                <span style={{ color: '#6b7280' }}>
                  lev <span style={{ color: '#fbbf24' }}>x{trade.leverage}</span>
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}
