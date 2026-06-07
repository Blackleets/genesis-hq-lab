// CopilotPanel.tsx — pre-trade co-pilot overlay on the chart.
// Shows Genesis's real read for a candidate trade and a safety-guarded Execute button.

import type { CopilotAnalysis } from '@services/cryptoClient';

const RISK_COLOR: Record<string, string> = {
  HEALTHY: '#22c55e', WATCH: '#22c55e', ELEVATED: '#f59e0b', HIGH_RISK: '#ef4444', CRITICAL: '#ef4444',
};

function confColor(c: number): string {
  return c >= 60 ? '#22c55e' : c >= 35 ? '#f59e0b' : '#ef4444';
}

function fmt(n: number): string {
  return n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toFixed(4);
}

interface Props {
  analysis: CopilotAnalysis | null;
  loading: boolean;
  executing: boolean;
  onExecute: () => void;
  onClose: () => void;
}

export function CopilotPanel({ analysis, loading, executing, onExecute, onClose }: Props) {
  const isLong = analysis?.side === 'LONG';
  const sideColor = isLong ? '#22c55e' : '#a855f7';
  const blocked = analysis?.safety.blocked ?? false;

  return (
    <div style={{
      position: 'absolute', top: 8, right: 8, width: 264, zIndex: 6,
      background: 'rgba(10,14,26,0.96)', border: '1px solid #1e2a3a', borderRadius: 8,
      boxShadow: '0 8px 28px rgba(0,0,0,0.55)', fontFamily: 'monospace', backdropFilter: 'blur(4px)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid #1e2a3a' }}>
        <span style={{ color: '#a855f7', fontSize: 10, fontWeight: 800, letterSpacing: 1 }}>◆ CO-PILOT</span>
        {analysis && (
          <span style={{ color: sideColor, fontSize: 11, fontWeight: 800 }}>
            {isLong ? '▲' : '▼'} {analysis.side} {analysis.pair.replace('USDT', '')}
          </span>
        )}
        <button type="button" onClick={onClose} style={{
          marginLeft: 'auto', background: 'transparent', border: 'none', color: '#4b5563',
          cursor: 'pointer', fontSize: 12, lineHeight: 1, padding: 0,
        }}>✕</button>
      </div>

      {loading || !analysis ? (
        <div style={{ padding: '24px 12px', textAlign: 'center', color: '#374151', fontSize: 11 }}>
          {loading ? 'Genesis analyzing…' : 'No analysis'}
        </div>
      ) : (
        <>
          {/* Confidence + Risk + EV */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: '#111827' }}>
            <Cell label="CONFIDENCE" value={`${analysis.confidence}`} color={confColor(analysis.confidence)} />
            <Cell label="RISK" value={`${analysis.risk.score}`} color={RISK_COLOR[analysis.risk.band] ?? '#9ca3af'} />
            <Cell label="EXP. VALUE" value={`${analysis.evPct >= 0 ? '+' : ''}${analysis.evPct}%`} color={analysis.evPct >= 0 ? '#22c55e' : '#ef4444'} />
          </div>

          {/* Entry / TP / SL / regime */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, background: '#111827' }}>
            <Cell label="ENTRY" value={`$${fmt(analysis.price)}`} color="#9ca3af" />
            <Cell label="REGIME" value={analysis.regime} color="#3b82f6" />
            <Cell label={`TP +${analysis.tpPct}%`} value={`$${fmt(analysis.tp)}`} color="#22c55e" />
            <Cell label={`SL -${analysis.slPct}%`} value={`$${fmt(analysis.sl)}`} color="#ef4444" />
          </div>

          {/* Engine endorsement */}
          <div style={{ padding: '5px 10px', borderTop: '1px solid #111827', fontSize: 9, color: '#4b5563', display: 'flex', justifyContent: 'space-between' }}>
            <span>GENESIS ENGINE</span>
            <span style={{ color: analysis.engineEndorsed ? '#22c55e' : '#f59e0b', fontWeight: 700 }}>
              {analysis.engineEndorsed ? `ENDORSES ${analysis.side}` : 'WOULD NOT TAKE'}
            </span>
          </div>

          {/* WHY LONG / WHY NOT */}
          <div style={{ padding: '6px 10px', borderTop: '1px solid #111827', maxHeight: 132, overflowY: 'auto' }}>
            {analysis.positive.length > 0 && (
              <>
                <div style={{ color: '#22c55e', fontSize: 8, letterSpacing: 0.8, marginBottom: 2 }}>WHY {analysis.side}</div>
                {analysis.positive.map((p, i) => (
                  <div key={`p${i}`} style={{ color: '#86efac', fontSize: 9, lineHeight: '13px', display: 'flex', gap: 4 }}>
                    <span style={{ color: '#22c55e' }}>+</span><span style={{ flex: 1 }}>{p}</span>
                  </div>
                ))}
              </>
            )}
            {analysis.negative.length > 0 && (
              <>
                <div style={{ color: '#ef4444', fontSize: 8, letterSpacing: 0.8, margin: '5px 0 2px' }}>WHY NOT</div>
                {analysis.negative.map((n, i) => (
                  <div key={`n${i}`} style={{ color: '#fca5a5', fontSize: 9, lineHeight: '13px', display: 'flex', gap: 4 }}>
                    <span style={{ color: '#ef4444' }}>−</span><span style={{ flex: 1 }}>{n}</span>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Outcome simulation */}
          <div style={{ padding: '6px 10px', borderTop: '1px solid #111827' }}>
            <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.8, marginBottom: 4 }}>
              OUTCOME SIMULATION · win prob {analysis.winProb}%
            </div>
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: '#0d1117' }}>
              <Seg pct={analysis.simulation.pTP} color="#22c55e" />
              <Seg pct={analysis.simulation.pSL} color="#ef4444" />
              <Seg pct={analysis.simulation.pTimeout} color="#6b7280" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3, fontSize: 8 }}>
              <span style={{ color: '#22c55e' }}>TP {Math.round(analysis.simulation.pTP * 100)}%</span>
              <span style={{ color: '#ef4444' }}>SL {Math.round(analysis.simulation.pSL * 100)}%</span>
              <span style={{ color: '#6b7280' }}>Timeout {Math.round(analysis.simulation.pTimeout * 100)}%</span>
            </div>
          </div>

          {/* Safety block notice */}
          {blocked && (
            <div style={{ padding: '6px 10px', background: 'rgba(239,68,68,0.08)', borderTop: '1px solid #3a1a1a' }}>
              <div style={{ color: '#ef4444', fontSize: 9, fontWeight: 700, letterSpacing: 0.5 }}>⚠ EXECUTION BLOCKED</div>
              {analysis.safety.reasons.map((r, i) => (
                <div key={i} style={{ color: '#fca5a5', fontSize: 9, lineHeight: '13px' }}>{r}</div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderTop: '1px solid #1e2a3a' }}>
            <button
              type="button"
              onClick={onExecute}
              disabled={blocked || executing}
              style={{
                flex: 1, padding: '7px 0', borderRadius: 4, border: 'none', fontFamily: 'monospace',
                fontSize: 11, fontWeight: 800, letterSpacing: 0.5,
                cursor: blocked || executing ? 'not-allowed' : 'pointer',
                background: blocked ? '#1f2937' : isLong ? '#22c55e' : '#a855f7',
                color: blocked ? '#4b5563' : isLong ? '#04140a' : '#1a0a24',
                opacity: executing ? 0.6 : 1,
              }}
            >
              {executing ? 'Executing…' : blocked ? 'Blocked' : `Execute ${analysis.side} · $100`}
            </button>
            <button type="button" onClick={onClose} style={{
              padding: '7px 12px', borderRadius: 4, border: '1px solid #1e2a3a', background: 'transparent',
              color: '#9ca3af', fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </>
      )}
    </div>
  );
}

function Cell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: '#0a0e1a', padding: '6px 8px' }}>
      <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ color, fontSize: 12, fontWeight: 700 }}>{value}</div>
    </div>
  );
}

function Seg({ pct, color }: { pct: number; color: string }) {
  if (pct <= 0) return null;
  return <div style={{ width: `${pct * 100}%`, background: color }} />;
}
