import { useEffect, useRef, useState } from 'react';
import type { SolanaStatus, SolanaToken } from '../api/solanaClient';

interface Props {
  tokens: SolanaToken[];
  status: SolanaStatus;
}

function ago(ts: number) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function bc(pct: number) {
  if (pct >= 85) return '#ef4444';
  if (pct >= 60) return '#f59e0b';
  if (pct >= 30) return '#22c55e';
  return '#4b5563';
}

export function LiveTokenFeed({ tokens, status }: Props) {
  const [flash, setFlash] = useState<string | null>(null);
  const prevLen = useRef(tokens.length);

  useEffect(() => {
    if (tokens.length > prevLen.current && tokens[0]) {
      setFlash(tokens[0].mint);
      setTimeout(() => setFlash(null), 800);
    }
    prevLen.current = tokens.length;
  }, [tokens]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(61,169,252,.08)' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#3da9fc', fontWeight: 800, letterSpacing: 1.2 }}>LIVE TOKEN FEED</span>
        <span style={{ marginLeft: 'auto', fontSize: 9, color: '#22c55e', fontWeight: 700 }}>
          {tokens.length} tokens
        </span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tokens.length === 0 ? (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#64748b', fontSize: 11, lineHeight: 1.5 }}>
            <div style={{ color: status.wsStatus === 'Provider not configured' ? '#ffb547' : '#94a3b8', fontWeight: 800 }}>
              {status.wsStatus || 'Pump.fun feed offline'}
            </div>
            <div style={{ marginTop: 6, color: '#475569', fontSize: 10 }}>
              Production reads the real Solana Alpha snapshot from Supabase. No simulated launches.
            </div>
          </div>
        ) : tokens.map((t, i) => (
          <div key={t.mint} style={{
            position: 'relative',
            padding: '8px 12px',
            borderBottom: '1px solid #111827',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: flash === t.mint ? 'rgba(0,255,156,0.10)' : i === 0 ? 'rgba(61,169,252,0.05)' : 'transparent',
            transition: 'background 0.4s',
            animation: flash === t.mint ? 'solanaSlideIn .18s ease-out' : 'none',
          }}>
            <div style={{
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              width: 2,
              background: i === 0 ? '#00ff9c' : bc(t.bondingCurvePct),
              opacity: i < 5 ? 1 : .45,
            }} />
            <div style={{ minWidth: 44, fontWeight: 700, fontSize: 11, color: '#e2e8f0' }}>
              {t.symbol}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t.name}
              </div>
              <div style={{ marginTop: 4, height: 3, background: '#111827', overflow: 'hidden' }}>
                <div style={{ width: `${Math.max(2, Math.min(100, t.bondingCurvePct))}%`, height: '100%', background: bc(t.bondingCurvePct), boxShadow: `0 0 8px ${bc(t.bondingCurvePct)}` }} />
              </div>
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', minWidth: 56, textAlign: 'right' }}>
              {t.marketCapSol.toFixed(1)} SOL
            </div>
            <div style={{ fontSize: 9, minWidth: 32, textAlign: 'right', color: bc(t.bondingCurvePct), fontWeight: 700 }}>
              {t.bondingCurvePct.toFixed(0)}%
            </div>
            <div style={{ fontSize: 9, color: '#374151', minWidth: 28, textAlign: 'right' }}>
              {ago(t.createdTs)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
