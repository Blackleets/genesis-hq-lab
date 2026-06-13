import type { SolanaSignal } from '../api/solanaClient';

interface Props {
  signals: SolanaSignal[];
}

function confColor(c: number) {
  if (c >= 75) return '#22c55e';
  if (c >= 60) return '#f59e0b';
  return '#6b7280';
}

function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

export function AlphaSignals({ signals }: Props) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, letterSpacing: 1 }}>ALPHA SIGNALS</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#22c55e', fontWeight: 700 }}>{signals.length} signals</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {signals.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#374151', fontSize: 11 }}>
            Watching for alpha patterns...
          </div>
        ) : signals.map(s => (
          <div key={s.id} style={{ padding: '8px 12px', borderBottom: '1px solid #111827' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>{s.token_symbol}</span>
              <span style={{ fontSize: 9, color: '#4b5563', background: '#111827', borderRadius: 3, padding: '1px 5px' }}>
                {s.signal_type.replace(/_/g, ' ')}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: confColor(s.confidence) }}>
                {s.confidence}%
              </span>
              <span style={{ fontSize: 9, color: '#374151' }}>{ago(s.created_at)}</span>
            </div>
            <div style={{ fontSize: 9, color: '#6b7280', lineHeight: 1.4 }}>
              {s.reason.split(' | ').slice(0, 3).join(' · ')}
            </div>
            {s.acted_on ? (
              <div style={{ marginTop: 3, fontSize: 9, color: '#3b82f6' }}>▶ auto-traded</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
