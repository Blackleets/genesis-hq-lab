import type { SolanaSignal } from '../api/solanaClient';

interface Props {
  signals: SolanaSignal[];
}

function confColor(c: number) {
  if (c >= 75) return '#00ff9c';
  if (c >= 62) return '#ffb547';
  return '#6b7280';
}

function ago(iso: string | undefined) {
  if (!iso) return 'live';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return 'live';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function signalType(signal: Partial<SolanaSignal> & { signalType?: string }) {
  return signal.signal_type ?? signal.signalType ?? 'launch_signal';
}

function signalSymbol(signal: Partial<SolanaSignal> & { tokenSymbol?: string }) {
  return signal.token_symbol ?? signal.tokenSymbol ?? '???';
}

function signalActedOn(signal: Partial<SolanaSignal> & { actedOn?: boolean }) {
  return Boolean(signal.acted_on || signal.actedOn);
}

function signalCreatedAt(signal: Partial<SolanaSignal> & { createdAt?: string }) {
  return signal.created_at ?? signal.createdAt;
}

export function AlphaSignals({ signals }: Props) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(0,255,156,.08)' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#00ff9c', fontWeight: 800, letterSpacing: 1.2 }}>ALPHA SIGNALS</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#22c55e', fontWeight: 700 }}>{signals.length} signals</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {signals.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#374151', fontSize: 11 }}>
            Watching real launch patterns...
          </div>
        ) : signals.map((s, i) => {
          const color = confColor(s.confidence);
          return (
            <div key={s.id} style={{
              position: 'relative',
              padding: '9px 12px',
              borderBottom: '1px solid #111827',
              background: signalActedOn(s) ? 'rgba(255,210,74,0.08)' : i === 0 ? 'rgba(0,255,156,0.05)' : 'transparent',
              animation: i === 0 ? 'solanaSlideIn .18s ease-out' : 'none',
            }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 2, background: color, opacity: s.confidence >= 62 ? 1 : .35 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: '#e2e8f0' }}>{signalSymbol(s)}</span>
                <span style={{ fontSize: 9, color, background: '#111827', borderRadius: 3, padding: '1px 5px', border: `1px solid ${color}30` }}>
                  {signalType(s).replace(/_/g, ' ')}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color }}>
                  {s.confidence}%
                </span>
                <span style={{ fontSize: 9, color: '#374151' }}>{ago(signalCreatedAt(s))}</span>
              </div>
              <div style={{ fontSize: 9, color: '#6b7280', lineHeight: 1.4 }}>
                {s.reason.split(' | ').slice(0, 3).join(' / ')}
              </div>
              <div style={{ marginTop: 5, height: 3, background: '#111827', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(4, Math.min(100, s.confidence))}%`, height: '100%', background: color, boxShadow: `0 0 8px ${color}` }} />
              </div>
              {signalActedOn(s) ? (
                <div style={{ marginTop: 4, fontSize: 9, color: '#ffd24a', fontWeight: 800 }}>AUTO PAPER TRADE OPENED</div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
