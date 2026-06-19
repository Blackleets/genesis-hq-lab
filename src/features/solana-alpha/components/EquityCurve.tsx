import type { EquityPoint } from '../api/solanaClient';

interface Props {
  curve: EquityPoint[];
}

export function EquityCurve({ curve }: Props) {
  const W = 100;
  const H = 60;
  const pad = { t: 4, b: 4, l: 4, r: 4 };

  const vals = curve.map(p => p.total_sol);
  const min = Math.min(...vals, 90);
  const max = Math.max(...vals, 110);
  const range = max - min || 1;

  const pts = vals.map((v, i) => {
    const x = pad.l + ((i / Math.max(vals.length - 1, 1)) * (W - pad.l - pad.r));
    const y = pad.t + ((1 - (v - min) / range) * (H - pad.t - pad.b));
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const last = vals[vals.length - 1] ?? 100;
  const first = vals[0] ?? 100;
  const pnlColor = last >= first ? '#22c55e' : '#ef4444';

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, letterSpacing: 1 }}>EQUITY CURVE</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: pnlColor }}>
          {last.toFixed(2)} SOL
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', padding: '8px 12px' }}>
        {vals.length < 2 ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#374151', fontSize: 10 }}>
            Accumulating data...
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ flex: 1 }} preserveAspectRatio="none">
            {/* Zero line at 100 SOL */}
            <line
              x1={pad.l} y1={pad.t + ((1 - (100 - min) / range) * (H - pad.t - pad.b)).toFixed(1)}
              x2={W - pad.r} y2={pad.t + ((1 - (100 - min) / range) * (H - pad.t - pad.b)).toFixed(1)}
              stroke="#1e2a3a" strokeWidth="0.5" strokeDasharray="2,2"
            />
            <polyline
              points={pts}
              fill="none"
              stroke={pnlColor}
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
        )}
      </div>

      <div style={{ padding: '4px 12px', borderTop: '1px solid #1e2a3a', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
        <span style={{ fontSize: 9, color: '#374151' }}>start: 100 SOL</span>
        <span style={{ fontSize: 9, color: pnlColor }}>
          {last >= first ? '+' : ''}{(last - first).toFixed(2)} SOL
        </span>
        <span style={{ fontSize: 9, color: '#374151' }}>{curve.length} pts</span>
      </div>
    </div>
  );
}
