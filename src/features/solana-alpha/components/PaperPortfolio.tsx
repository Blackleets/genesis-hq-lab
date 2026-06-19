import type { PaperPosition, PaperTrade, PaperStats } from '../api/solanaClient';

interface Props {
  stats: PaperStats;
  positions: PaperPosition[];
  trades: PaperTrade[];
  onReset: () => void;
}

function pnlColor(v: number) {
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#6b7280';
}

function fmt(sol: number) {
  return `${sol >= 0 ? '+' : ''}${sol.toFixed(4)} SOL`;
}

function pct(pos: PaperPosition) {
  if (!pos.entry_price_sol || pos.entry_price_sol <= 0) return 0;
  return ((pos.current_price_sol - pos.entry_price_sol) / pos.entry_price_sol) * 100;
}

export function PaperPortfolio({ stats, positions, trades, onReset }: Props) {
  const unrealized = positions.reduce((s, p) => {
    const gain = (p.current_price_sol - p.entry_price_sol) * (p.remaining_tokens ?? p.tokens);
    return s + gain;
  }, 0);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #1e2a3a', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: '#4b5563', fontWeight: 600, letterSpacing: 1 }}>PAPER PORTFOLIO</span>
        <span style={{ fontSize: 9, color: '#374151', background: '#111827', borderRadius: 3, padding: '1px 5px' }}>live_mode=false</span>
        <button
          onClick={onReset}
          style={{ marginLeft: 'auto', fontSize: 9, color: '#6b7280', background: '#111827', border: '1px solid #1e2a3a', borderRadius: 3, padding: '2px 6px', cursor: 'pointer' }}
        >
          Reset
        </button>
      </div>

      {/* Stats bar — 2 rows × 3 cols */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 1, background: '#111827', flexShrink: 0 }}>
        {[
          { label: 'Balance', value: `${stats.balance.toFixed(2)} SOL` },
          { label: 'Total PnL', value: fmt(stats.totalPnlSol), color: pnlColor(stats.totalPnlSol) },
          { label: 'Trades', value: `${stats.totalTrades}` },
          {
            label: 'Win Rate',
            value: stats.totalTrades > 0 ? `${stats.winRate}%` : '—',
            color: stats.totalTrades > 0 ? (stats.winRate >= 50 ? '#22c55e' : '#ef4444') : '#6b7280',
          },
          {
            label: 'Profit Factor',
            value: stats.totalTrades > 0 ? stats.profitFactor.toFixed(2) : '—',
            color: stats.profitFactor >= 1.5 ? '#22c55e' : stats.profitFactor >= 1 ? '#f59e0b' : stats.profitFactor > 0 ? '#ef4444' : '#6b7280',
          },
          {
            label: 'Max Drawdown',
            value: stats.totalTrades > 0 ? `${stats.maxDrawdownPct}%` : '—',
            color: stats.maxDrawdownPct > 20 ? '#ef4444' : stats.maxDrawdownPct > 10 ? '#f59e0b' : '#22c55e',
          },
        ].map(s => (
          <div key={s.label} style={{ padding: '6px 8px', background: '#0a0e1a' }}>
            <div style={{ fontSize: 9, color: '#374151' }}>{s.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: s.color ?? '#e2e8f0', marginTop: 1 }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Avg win / loss strip */}
      {stats.totalTrades > 0 && (
        <div style={{ display: 'flex', gap: 1, background: '#111827', flexShrink: 0 }}>
          <div style={{ flex: 1, padding: '4px 8px', background: '#0a0e1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#374151' }}>Avg Win</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e' }}>{stats.avgWinSol > 0 ? `+${stats.avgWinSol.toFixed(4)}` : '—'}</span>
          </div>
          <div style={{ flex: 1, padding: '4px 8px', background: '#0a0e1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 9, color: '#374151' }}>Avg Loss</span>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#ef4444' }}>{stats.avgLossSol < 0 ? stats.avgLossSol.toFixed(4) : '—'}</span>
          </div>
          {stats.streak !== 0 && (
            <div style={{ flex: 1, padding: '4px 8px', background: '#0a0e1a', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 9, color: '#374151' }}>Streak</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: stats.streak > 0 ? '#22c55e' : '#ef4444' }}>
                {stats.streak > 0 ? `+${stats.streak}W` : `${Math.abs(stats.streak)}L`}
              </span>
            </div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Open positions */}
        {positions.length > 0 && (
          <div>
            <div style={{ padding: '6px 12px', fontSize: 9, color: '#374151', fontWeight: 700, letterSpacing: 1, background: '#0d1117' }}>
              OPEN ({positions.length})
            </div>
            {positions.map(p => {
              const pnlPct = pct(p);
              return (
                <div key={p.id} style={{ padding: '6px 12px', borderBottom: '1px solid #111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0', minWidth: 44 }}>{p.token_symbol}</span>
                  <span style={{ fontSize: 9, color: '#4b5563' }}>{p.size_sol.toFixed(3)} SOL</span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: pnlColor(pnlPct) }}>
                    {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                  </span>
                  <div style={{ fontSize: 9, color: '#374151', display: 'flex', gap: 3 }}>
                    {p.tp1_hit ? <span style={{ color: '#22c55e' }}>TP1</span> : null}
                    {p.tp2_hit ? <span style={{ color: '#22c55e' }}>TP2</span> : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Recent closed */}
        {trades.length > 0 && (
          <div>
            <div style={{ padding: '6px 12px', fontSize: 9, color: '#374151', fontWeight: 700, letterSpacing: 1, background: '#0d1117' }}>
              CLOSED (last {Math.min(trades.length, 20)})
            </div>
            {trades.slice(0, 20).map(t => (
              <div key={t.id} style={{ padding: '5px 12px', borderBottom: '1px solid #111827', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', minWidth: 44 }}>{t.token_symbol}</span>
                <span style={{ fontSize: 9, color: '#374151' }}>
                  {t.status?.replace('closed_', '') ?? ''}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, color: pnlColor(t.pnl_sol ?? 0) }}>
                  {fmt(t.pnl_sol ?? 0)}
                </span>
              </div>
            ))}
          </div>
        )}

        {positions.length === 0 && trades.length === 0 && (
          <div style={{ padding: '20px 12px', textAlign: 'center', color: '#374151', fontSize: 11 }}>
            No trades yet — waiting for signals...
          </div>
        )}
      </div>

      {/* Unrealized footer */}
      {positions.length > 0 && (
        <div style={{ padding: '5px 12px', borderTop: '1px solid #1e2a3a', display: 'flex', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontSize: 9, color: '#374151' }}>Unrealized</span>
          <span style={{ fontSize: 10, fontWeight: 700, color: pnlColor(unrealized) }}>
            {fmt(unrealized)}
          </span>
        </div>
      )}
    </div>
  );
}
