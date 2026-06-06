// ActivePositionsTerminal.tsx — Institutional-grade active positions table.
// Receives positions from parent. No internal polling — parent owns the data.
// ZERO fake data: if no positions → empty state.

import type { CryptoPosition } from '@services/cryptoClient';

function durationLabel(openedAt: string): string {
  try {
    const ms = Date.now() - new Date(openedAt).getTime();
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    return `${Math.floor(h / 24)}d`;
  } catch { return '--'; }
}

function pnlColor(pnl: number): string {
  if (pnl > 0) return '#22c55e';
  if (pnl < 0) return '#ef4444';
  return '#6b7280';
}

function sideColor(side: string): string {
  return side === 'LONG' ? '#3b82f6' : '#a855f7';
}

interface Props {
  positions: CryptoPosition[];
  currentPrices?: Record<string, number>;  // pair → current price for live unrealized PnL
  className?: string;
}

export function ActivePositionsTerminal({ positions, currentPrices = {}, className = '' }: Props) {
  return (
    <div
      className={className}
      style={{
        height: '100%',
        background: '#0a0e1a',
        border: '1px solid #1e2a3a',
        borderRadius: 8,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #1e2a3a',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ color: '#4b5563', fontSize: 11, fontWeight: 600, letterSpacing: 1 }}>
          ACTIVE POSITIONS
        </span>
        <span style={{
          marginLeft: 4,
          background: positions.length > 0 ? 'rgba(59,130,246,0.15)' : 'transparent',
          color: positions.length > 0 ? '#60a5fa' : '#374151',
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: 10,
          fontWeight: 700,
        }}>
          {positions.length}
        </span>
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {positions.length === 0 ? (
          <div style={{ color: '#374151', fontSize: 11, padding: '20px 12px', textAlign: 'center' }}>
            No open positions
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '60px 48px 72px 72px 64px 56px 56px',
              gap: '0 4px',
              padding: '4px 12px',
              borderBottom: '1px solid #111827',
            }}>
              {['SYMBOL', 'SIDE', 'ENTRY', 'MARK', 'UNREAL PnL', 'CONF', 'DURATION'].map(h => (
                <span key={h} style={{ color: '#374151', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>
                  {h}
                </span>
              ))}
            </div>

            {/* Rows */}
            {positions.map(pos => {
              const pair   = pos.pair ?? '';
              const symbol = pair.replace('USDT', '');
              const mark   = currentPrices[pair] ?? null;
              const unrealized = mark !== null && pos.entry_price
                ? pos.side === 'LONG'
                  ? (mark - pos.entry_price) / pos.entry_price * pos.capital_used
                  : (pos.entry_price - mark) / pos.entry_price * pos.capital_used
                : null;
              const confPct = ((pos.confidence ?? 0) * 100).toFixed(0);

              return (
                <div
                  key={pos.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '60px 48px 72px 72px 64px 56px 56px',
                    gap: '0 4px',
                    padding: '5px 12px',
                    borderBottom: '1px solid #0d1117',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ color: '#e5e7eb', fontWeight: 600 }}>{symbol}</span>
                  <span style={{ color: sideColor(pos.side), fontWeight: 700 }}>{pos.side}</span>
                  <span style={{ color: '#9ca3af' }}>${pos.entry_price.toFixed(2)}</span>
                  <span style={{ color: '#9ca3af' }}>
                    {mark !== null ? `$${mark.toFixed(2)}` : '--'}
                  </span>
                  <span style={{ color: unrealized !== null ? pnlColor(unrealized) : '#6b7280', fontWeight: unrealized !== null ? 700 : 400 }}>
                    {unrealized !== null
                      ? (unrealized >= 0 ? `+$${unrealized.toFixed(2)}` : `-$${Math.abs(unrealized).toFixed(2)}`)
                      : '--'}
                  </span>
                  <span style={{ color: '#60a5fa' }}>{confPct}%</span>
                  <span style={{ color: '#6b7280' }}>{durationLabel(pos.opened_at)}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
