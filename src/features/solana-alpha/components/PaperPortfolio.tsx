import type { PaperPosition, PaperTrade, PaperStats } from '../api/solanaClient';

interface Props {
  stats: PaperStats;
  positions: PaperPosition[];
  trades: PaperTrade[];
  onReset: () => void;
}

function pnlColor(v: number) {
  return v > 0 ? '#00ff9c' : v < 0 ? '#ff4757' : '#6b7280';
}

function fmt(sol: number) {
  return `${sol >= 0 ? '+' : ''}${sol.toFixed(4)} SOL`;
}

function pct(pos: PaperPosition) {
  if (!pos.entry_price_sol || pos.entry_price_sol <= 0) return 0;
  return ((pos.current_price_sol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
}

function tpProgress(pos: PaperPosition) {
  return (pos.tp1_hit ? 33 : 0) + (pos.tp2_hit ? 33 : 0) + (pos.tp3_hit ? 34 : 0);
}

export function PaperPortfolio({ stats, positions, trades, onReset }: Props) {
  const unrealized = positions.reduce((s, p) => {
    const gain = (p.current_price_sol - p.entry_price_sol) * (p.remaining_tokens ?? p.tokens);
    return s + gain;
  }, 0);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden', boxShadow: 'inset 0 1px 0 rgba(255,210,74,.08)' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#ffd24a', fontWeight: 800, letterSpacing: 1.2 }}>PAPER PORTFOLIO</span>
        <span style={{ fontSize: 9, color: '#64748b', background: '#111827', borderRadius: 3, padding: '1px 5px' }}>live_mode={String(stats.liveMode)}</span>
        <button
          onClick={onReset}
          disabled={!stats.liveMode}
          title={stats.liveMode ? 'Reset paper balance' : 'Solo lectura: el reset requiere el backend en vivo, no el snapshot de producción.'}
          style={{ marginLeft: 'auto', fontSize: 9, color: stats.liveMode ? '#94a3b8' : '#475569', background: '#111827', border: '1px solid #1e2a3a', borderRadius: 3, padding: '2px 6px', cursor: stats.liveMode ? 'pointer' : 'not-allowed' }}
        >
          Reset
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 1, background: '#111827', flexShrink: 0 }}>
        {[
          { label: 'Balance', value: `${stats.balance.toFixed(2)} SOL` },
          { label: 'Realized', value: fmt(stats.totalPnlSol), color: pnlColor(stats.totalPnlSol) },
          { label: 'Win Rate', value: `${stats.winRate}%`, color: stats.winRate >= 50 ? '#00ff9c' : '#ff4757' },
          { label: 'Open', value: `${stats.openPositions}/10`, color: stats.openPositions > 0 ? '#ffd24a' : '#e2e8f0' },
        ].map((s) => (
          <div key={s.label} style={{ padding: '6px 8px', background: '#0a0e1a' }}>
            <div style={{ fontSize: 9, color: '#475569' }}>{s.label}</div>
            <div style={{ fontSize: 12, fontWeight: 800, color: s.color ?? '#e2e8f0', marginTop: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {positions.length > 0 && (
          <div>
            <div style={{ padding: '6px 12px', fontSize: 9, color: '#64748b', fontWeight: 800, letterSpacing: 1, background: '#0d1117' }}>
              OPEN POSITIONS ({positions.length})
            </div>
            {positions.map((p) => {
              const pnlPct = pct(p);
              const color = pnlColor(pnlPct);
              return (
                <div key={p.id} style={{ position: 'relative', padding: '9px 12px', borderBottom: '1px solid #111827', background: 'rgba(255,210,74,0.045)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: '#e2e8f0', minWidth: 58 }}>{p.token_symbol}</span>
                    <span style={{ fontSize: 9, color: '#64748b' }}>{p.size_sol.toFixed(3)} SOL</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 900, color }}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                    </span>
                  </div>
                  <div style={{ marginTop: 5, display: 'flex', gap: 4, alignItems: 'center' }}>
                    <div style={{ flex: 1, height: 4, background: '#111827', overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(2, tpProgress(p))}%`, height: '100%', background: '#ffd24a', boxShadow: '0 0 9px #ffd24a' }} />
                    </div>
                    <span style={{ fontSize: 9, color: p.tp1_hit ? '#00ff9c' : '#475569' }}>TP1</span>
                    <span style={{ fontSize: 9, color: p.tp2_hit ? '#00ff9c' : '#475569' }}>TP2</span>
                    <span style={{ fontSize: 9, color: p.tp3_hit ? '#00ff9c' : '#475569' }}>TP3</span>
                  </div>
                  <div style={{ marginTop: 5, fontSize: 9, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.signal_reason || 'paper launch signal'}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {trades.length > 0 && (
          <div>
            <div style={{ padding: '6px 12px', fontSize: 9, color: '#64748b', fontWeight: 800, letterSpacing: 1, background: '#0d1117' }}>
              CLOSED (last {Math.min(trades.length, 20)})
            </div>
            {trades.slice(0, 20).map((t) => (
              <div key={t.id} style={{ padding: '6px 12px', borderBottom: '1px solid #111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', minWidth: 48 }}>{t.token_symbol}</span>
                <span style={{ fontSize: 9, color: '#475569' }}>{t.status?.replace('closed_', '') ?? ''}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: pnlColor(t.pnl_sol ?? 0) }}>
                  {fmt(t.pnl_sol ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}

        {positions.length === 0 && trades.length === 0 && (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#475569', fontSize: 11 }}>
            No paper trades yet. Waiting for a signal above the auto-trade threshold.
          </div>
        )}
      </div>

      {positions.length > 0 && (
        <div style={{ padding: '6px 12px', borderTop: '1px solid #1e2a3a', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#64748b' }}>Unrealized</span>
          <span style={{ fontSize: 10, fontWeight: 800, color: pnlColor(unrealized) }}>{fmt(unrealized)}</span>
        </div>
      )}
    </div>
  );
}
