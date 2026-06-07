// TradeStoryCard.tsx — floating story overlay for a selected trade on the chart.
// Shows only real, persisted per-trade data. risk/regime are not persisted → shown "—".

import type { TradeStory } from '@services/cryptoClient';

const EXIT_BADGE: Record<string, { label: string; color: string }> = {
  TP:         { label: 'TP HIT',              color: '#22c55e' },
  SL:         { label: 'SL HIT',              color: '#ef4444' },
  TIMEOUT:    { label: 'TIMEOUT EXIT',        color: '#f59e0b' },
  CONFIDENCE: { label: 'CONFIDENCE COLLAPSE', color: '#f97316' },
  EXIT:       { label: 'CLOSED',              color: '#9ca3af' },
};

function durationLabel(open: string, close: string | null): string {
  try {
    const a = Date.parse(open);
    const b = close ? Date.parse(close) : Date.now();
    const m = Math.floor((b - a) / 60_000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d`;
  } catch { return '—'; }
}

function fmt(n: number): string {
  return n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toFixed(4);
}

interface Props {
  trade: TradeStory;
  onClose: () => void;
}

export function TradeStoryCard({ trade, onClose }: Props) {
  const sym  = trade.pair.replace('USDT', '');
  const isLong = trade.side === 'LONG';
  const sideColor = isLong ? '#22c55e' : '#a855f7';
  const badge = trade.exit_kind ? EXIT_BADGE[trade.exit_kind] ?? EXIT_BADGE.EXIT : null;
  const pnl = trade.pnl;
  const pnlColor = pnl == null ? '#6b7280' : pnl >= 0 ? '#22c55e' : '#ef4444';

  return (
    <div style={{
      position: 'absolute', top: 8, right: 8, width: 236, zIndex: 5,
      background: 'rgba(10,14,26,0.94)', border: '1px solid #1e2a3a', borderRadius: 8,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)', fontFamily: 'monospace',
      backdropFilter: 'blur(4px)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px',
        borderBottom: '1px solid #1e2a3a',
      }}>
        <span style={{ color: sideColor, fontSize: 11, fontWeight: 800, letterSpacing: 0.5 }}>
          {isLong ? '▲' : '▼'} {trade.side}
        </span>
        <span style={{ color: '#e5e7eb', fontSize: 11, fontWeight: 700 }}>{sym}</span>
        {badge && (
          <span style={{
            marginLeft: 'auto', fontSize: 7, fontWeight: 700, letterSpacing: 0.5,
            padding: '2px 5px', borderRadius: 3, background: `${badge.color}1a`, color: badge.color,
          }}>
            {badge.label}
          </span>
        )}
        {!badge && <span style={{ marginLeft: 'auto', fontSize: 8, color: '#3b82f6' }}>OPEN</span>}
        <button type="button" onClick={onClose} style={{
          marginLeft: 4, background: 'transparent', border: 'none',
          color: '#4b5563', cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0,
        }}>✕</button>
      </div>

      {/* Price flow + pnl */}
      <div style={{ padding: '7px 10px', borderBottom: '1px solid #111827', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: '#9ca3af', fontSize: 10 }}>${fmt(trade.entry_price)}</span>
        <span style={{ color: '#374151', fontSize: 10 }}>→</span>
        <span style={{ color: '#9ca3af', fontSize: 10 }}>
          {trade.exit_price != null ? `$${fmt(trade.exit_price)}` : '…'}
        </span>
        <span style={{ marginLeft: 'auto', color: pnlColor, fontSize: 11, fontWeight: 800 }}>
          {pnl == null ? '—' : pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
        </span>
      </div>

      {/* AI context grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#111827' }}>
        <Cell label="CONFIDENCE" value={`${Math.round((trade.confidence ?? 0) * 100)}%`} color="#60a5fa" />
        <Cell label="DURATION" value={durationLabel(trade.opened_at, trade.closed_at)} color="#9ca3af" />
        <Cell label="RISK" value="—" color="#4b5563" />
        <Cell label="REGIME" value="—" color="#4b5563" />
      </div>

      {/* Reason (the thesis) */}
      {trade.reason && (
        <div style={{ padding: '7px 10px', borderTop: '1px solid #111827' }}>
          <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.8, marginBottom: 3 }}>REASON</div>
          <div style={{ color: '#cbd5e1', fontSize: 10, lineHeight: '14px' }}>{trade.reason}</div>
        </div>
      )}

      {/* Evidence */}
      {trade.evidence.length > 0 && (
        <div style={{ padding: '0 10px 8px' }}>
          <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.8, margin: '4px 0 3px' }}>EVIDENCE</div>
          {trade.evidence.slice(0, 3).map((e, i) => (
            <div key={i} style={{ color: '#6b7280', fontSize: 9, lineHeight: '13px', display: 'flex', gap: 4 }}>
              <span style={{ color: '#374151' }}>·</span>
              <span style={{ flex: 1 }}>{e}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#0a0e1a', padding: '6px 10px' }}>
      <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.6 }}>{label}</div>
      <div style={{ color, fontSize: 11, fontWeight: 700 }}>{value}</div>
    </div>
  );
}
