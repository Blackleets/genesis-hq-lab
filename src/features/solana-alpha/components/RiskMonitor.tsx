import type { SolanaStatus, PaperStats } from '../api/solanaClient';

interface Props {
  status: SolanaStatus;
  stats: PaperStats;
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
      background: ok ? '#22c55e' : '#ef4444',
      boxShadow: ok ? '0 0 4px #22c55e' : '0 0 4px #ef4444',
      marginRight: 5,
    }} />
  );
}

export function RiskMonitor({ status, stats }: Props) {
  const drawdownPct = Math.max(0, ((100 - stats.totalSol) / 100) * 100);
  const drawdownOk = drawdownPct < 20;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, letterSpacing: 1 }}>RISK MONITOR</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Feed status */}
        <div>
          <div style={{ fontSize: 9, color: '#374151', marginBottom: 6, letterSpacing: 1 }}>FEED</div>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 11 }}>
            <StatusDot ok={status.connected} />
            <span style={{ color: status.connected ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
              {status.wsStatus}
            </span>
          </div>
          <div style={{ fontSize: 9, color: '#4b5563', marginTop: 3 }}>
            {status.subscribedTokens} tokens subscribed
          </div>
        </div>

        {/* Paper engine */}
        <div>
          <div style={{ fontSize: 9, color: '#374151', marginBottom: 6, letterSpacing: 1 }}>PAPER ENGINE</div>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 11 }}>
            <StatusDot ok={!stats.liveMode} />
            <span style={{ color: '#22c55e', fontWeight: 700 }}>PAPER ONLY</span>
          </div>
          <div style={{ fontSize: 9, color: '#4b5563', marginTop: 3 }}>
            live_mode = {String(stats.liveMode)} (hardcoded)
          </div>
        </div>

        {/* Drawdown */}
        <div>
          <div style={{ fontSize: 9, color: '#374151', marginBottom: 6, letterSpacing: 1 }}>DRAWDOWN</div>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: 11 }}>
            <StatusDot ok={drawdownOk} />
            <span style={{ color: drawdownOk ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
              {drawdownPct.toFixed(1)}%
            </span>
          </div>
          <div style={{ marginTop: 4, height: 4, background: '#1e2a3a', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, drawdownPct)}%`, height: '100%', background: drawdownOk ? '#22c55e' : '#ef4444', borderRadius: 2 }} />
          </div>
          <div style={{ fontSize: 9, color: '#4b5563', marginTop: 3 }}>
            max 20% before alert
          </div>
        </div>

        {/* Positions */}
        <div>
          <div style={{ fontSize: 9, color: '#374151', marginBottom: 6, letterSpacing: 1 }}>POSITIONS</div>
          <div style={{ fontSize: 11, color: '#e2e8f0' }}>
            <span style={{ fontWeight: 700 }}>{stats.openPositions}</span>
            <span style={{ color: '#4b5563' }}> / 10 max</span>
          </div>
          <div style={{ marginTop: 4, height: 4, background: '#1e2a3a', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ width: `${(stats.openPositions / 10) * 100}%`, height: '100%', background: '#3b82f6', borderRadius: 2 }} />
          </div>
        </div>

        {/* Limits */}
        <div>
          <div style={{ fontSize: 9, color: '#374151', marginBottom: 6, letterSpacing: 1 }}>LIMITS</div>
          {[
            { label: 'Max position', value: '1 SOL' },
            { label: 'Stop loss', value: '−10%' },
            { label: 'TP1 / TP2 / TP3', value: '+25 / +50 / +100%' },
            { label: 'Trailing stop', value: '15% from peak' },
            { label: 'Timeout', value: '24h' },
          ].map(r => (
            <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#6b7280', marginBottom: 2 }}>
              <span>{r.label}</span>
              <span style={{ color: '#94a3b8' }}>{r.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
