// MarketIntelPanel.tsx — Real-time market intelligence sidebar.
// Polls /api/crypto/market-intelligence every 30s.
// All values derived from real system state — no mocks.
// Rendered inside RightPanel (which provides the outer frame), so this
// component is border-less and scrolls internally to avoid clipping.

import { useEffect, useState, useCallback } from 'react';
import { loadMarketIntelligence, type MarketIntel } from '@services/cryptoClient';

const POLL_MS = 30_000;

const MOMENTUM_COLOR: Record<string, string> = {
  Bullish: '#22c55e',
  Neutral: '#6b7280',
  Bearish: '#ef4444',
};
const VOLATILITY_COLOR: Record<string, string> = {
  Low:    '#22c55e',
  Medium: '#f59e0b',
  High:   '#ef4444',
};
const TREND_COLOR: Record<string, string> = {
  Strong:  '#22c55e',
  Weak:    '#f59e0b',
  Mixed:   '#f97316',
  Unknown: '#6b7280',
};
const REGIME_COLOR: Record<string, string> = {
  'Scalp':    '#3b82f6',
  'Swing':    '#a855f7',
  'Risk-Off': '#ef4444',
};
const REC_COLOR: Record<string, string> = {
  LONG:  '#22c55e',
  SHORT: '#ef4444',
  WATCH: '#f59e0b',
  WAIT:  '#6b7280',
};
const REC_BG: Record<string, string> = {
  LONG:  'rgba(34,197,94,0.12)',
  SHORT: 'rgba(239,68,68,0.12)',
  WATCH: 'rgba(245,158,11,0.12)',
  WAIT:  'rgba(107,114,128,0.10)',
};

// Short, single-word band label — avoids overflow in the 200px column.
function shortBand(band: string): string {
  return (band ?? '').split('_')[0] || '—';
}

interface RowProps {
  label: string;
  value: string;
  valueColor?: string;
}

function Row({ label, value, valueColor = '#9ca3af' }: RowProps) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 6,
      padding: '6px 12px',
      borderBottom: '1px solid #111827',
    }}>
      <span style={{ color: '#4b5563', fontSize: 10, fontWeight: 600, letterSpacing: 0.5, whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <span style={{ color: valueColor, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right' }}>
        {value}
      </span>
    </div>
  );
}

interface Props {
  className?: string;
}

export function MarketIntelPanel({ className = '' }: Props) {
  const [intel, setIntel] = useState<MarketIntel | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const poll = useCallback(async () => {
    const data = await loadMarketIntelligence();
    if (data) {
      setIntel(data);
      setUpdatedAt(new Date().toLocaleTimeString());
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  const rec = intel?.recommendation ?? 'WAIT';

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#0a0e1a',
        overflow: 'hidden',
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
        <span style={{ color: '#4b5563', fontSize: 10, fontWeight: 600, letterSpacing: 0.8 }}>
          MARKET INTELLIGENCE
        </span>
        {updatedAt && (
          <span style={{ marginLeft: 'auto', color: '#374151', fontSize: 9 }}>
            {updatedAt}
          </span>
        )}
      </div>

      {/* Scrollable body — nothing gets clipped in short columns */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {intel === null ? (
          <div style={{ color: '#374151', fontSize: 10, padding: '20px 12px', textAlign: 'center' }}>
            Loading…
          </div>
        ) : (
          <>
            {/* Recommendation — hero (stacked so the verb never collides with the label) */}
            <div style={{
              margin: '10px 12px',
              borderRadius: 6,
              background: REC_BG[rec] ?? REC_BG.WAIT,
              border: `1px solid ${REC_COLOR[rec] ?? '#6b7280'}22`,
              padding: '10px 12px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              <span style={{ color: '#4b5563', fontSize: 9, fontWeight: 600, letterSpacing: 1 }}>
                RECOMMENDATION
              </span>
              <span style={{ color: REC_COLOR[rec] ?? '#9ca3af', fontSize: 22, fontWeight: 800, letterSpacing: 2, lineHeight: 1 }}>
                {rec}
              </span>
            </div>

            {/* Signal rows */}
            <Row label="MOMENTUM"   value={intel.momentum}   valueColor={MOMENTUM_COLOR[intel.momentum]   ?? '#9ca3af'} />
            <Row label="VOLATILITY" value={intel.volatility} valueColor={VOLATILITY_COLOR[intel.volatility] ?? '#9ca3af'} />
            <Row label="TREND"      value={intel.trend}      valueColor={TREND_COLOR[intel.trend]      ?? '#9ca3af'} />
            <Row label="REGIME"     value={intel.regime}     valueColor={REGIME_COLOR[intel.regime]    ?? '#9ca3af'} />

            {/* Divider */}
            <div style={{ height: 1, background: '#111827', margin: '4px 0' }} />

            {/* Confidence — short band keeps it on one line */}
            <Row
              label="CONFIDENCE"
              value={`${(intel.confidence.score * 100).toFixed(0)}% · ${shortBand(intel.confidence.band)}`}
              valueColor="#60a5fa"
            />

            {/* Risk */}
            <Row
              label="RISK BAND"
              value={intel.risk.band + (intel.risk.safeMode ? ' · SAFE' : '')}
              valueColor={intel.risk.band === 'CRITICAL' ? '#ef4444' : intel.risk.band === 'ELEVATED' ? '#f59e0b' : '#22c55e'}
            />

            {/* Activity */}
            <div style={{ height: 1, background: '#111827', margin: '4px 0' }} />
            <Row label="SIGNALS / 3H" value={String(intel.activity.signalsLast3h)} valueColor="#9ca3af" />
            <Row
              label="WIN RATE / 6H"
              value={intel.activity.recentWinRate !== null
                ? `${(intel.activity.recentWinRate * 100).toFixed(0)}%`
                : 'N/A'}
              valueColor={
                intel.activity.recentWinRate === null ? '#6b7280'
                : intel.activity.recentWinRate >= 0.6 ? '#22c55e'
                : intel.activity.recentWinRate >= 0.45 ? '#f59e0b'
                : '#ef4444'
              }
            />
          </>
        )}
      </div>
    </div>
  );
}
