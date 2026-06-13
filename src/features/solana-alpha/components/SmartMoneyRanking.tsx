import type { SolanaWallet } from '../api/solanaClient';

interface Props {
  wallets: SolanaWallet[];
  summary: { total: number; smart: number };
}

function labelColor(label: string) {
  if (label === 'smart_money') return '#f59e0b';
  if (label === 'skilled') return '#22c55e';
  if (label === 'average') return '#6b7280';
  return '#374151';
}

function scoreBar(score: number) {
  return (
    <div style={{ width: 60, height: 4, background: '#1e2a3a', borderRadius: 2, overflow: 'hidden' }}>
      <div style={{ width: `${score}%`, height: '100%', background: score >= 75 ? '#f59e0b' : score >= 55 ? '#22c55e' : '#4b5563', borderRadius: 2 }} />
    </div>
  );
}

export function SmartMoneyRanking({ wallets, summary }: Props) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, letterSpacing: 1 }}>SMART MONEY RANKING</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#f59e0b', fontWeight: 700 }}>
          {summary.smart} smart / {summary.total} total
        </span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {wallets.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#374151', fontSize: 11 }}>
            Tracking wallets from live trades...
          </div>
        ) : wallets.map((w, i) => (
          <div key={w.address} style={{
            padding: '6px 12px',
            borderBottom: '1px solid #111827',
            display: 'grid',
            gridTemplateColumns: '20px 1fr auto',
            gap: 8,
            alignItems: 'center',
          }}>
            <span style={{ fontSize: 9, color: '#374151', fontWeight: 700 }}>#{i + 1}</span>
            <div>
              <div style={{ fontSize: 9, color: '#6b7280', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {w.address.slice(0, 8)}…{w.address.slice(-6)}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 2, alignItems: 'center' }}>
                {scoreBar(w.score)}
                <span style={{ fontSize: 9, color: labelColor(w.label), fontWeight: 700 }}>{w.label.replace('_', ' ')}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 10, color: '#e2e8f0', fontWeight: 700 }}>{w.score}</div>
              <div style={{ fontSize: 9, color: '#4b5563' }}>
                {w.wins}W/{w.losses}L
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
