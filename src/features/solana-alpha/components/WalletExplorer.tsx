import { useState } from 'react';
import type { SolanaWallet } from '../api/solanaClient';

interface Props {
  wallets: SolanaWallet[];
}

export function WalletExplorer({ wallets }: Props) {
  const [filter, setFilter] = useState<'all' | 'smart_money' | 'skilled'>('all');

  const filtered = wallets.filter(w => filter === 'all' ? true : w.label === filter);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, letterSpacing: 1 }}>WALLET EXPLORER</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {(['all', 'smart_money', 'skilled'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={{
              fontSize: 8, padding: '2px 6px', borderRadius: 3, cursor: 'pointer',
              background: filter === f ? '#1e3a5f' : '#111827',
              border: filter === f ? '1px solid #3b82f6' : '1px solid #1e2a3a',
              color: filter === f ? '#60a5fa' : '#4b5563',
            }}>
              {f === 'smart_money' ? '★ smart' : f}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#374151', fontSize: 11 }}>
            {wallets.length === 0 ? 'Tracking wallets from live trades...' : 'No wallets match filter'}
          </div>
        ) : filtered.map(w => (
          <div key={w.address} style={{ padding: '7px 12px', borderBottom: '1px solid #111827' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <code style={{ fontSize: 9, color: '#6b7280' }}>{w.address.slice(0, 10)}…{w.address.slice(-6)}</code>
              <span style={{ fontSize: 8, color: w.label === 'smart_money' ? '#f59e0b' : '#22c55e', fontWeight: 700, textTransform: 'uppercase' }}>
                {w.label.replace('_', ' ')}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: '#e2e8f0' }}>{w.score}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 9, color: '#4b5563' }}>
              <span>{w.total_trades} trades</span>
              <span style={{ color: '#22c55e' }}>{w.wins}W</span>
              <span style={{ color: '#ef4444' }}>{w.losses}L</span>
              <span>{w.avg_profit_x.toFixed(2)}x avg</span>
              <span>{w.total_volume_sol.toFixed(1)} SOL vol</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
