// EngineTelemetry.tsx — live execution telemetry for the operator.
// Shows whether each paper-training loop is actually running, the active
// confidence gates, training stats, and the most recent "why no trade" reasons.

import { useEffect, useState, useCallback } from 'react';
import { loadDiagnostics, type ExecutionDiagnostics, type LoopStatus } from '@services/cryptoClient';

const POLL_MS = 10_000;

function LoopRow({ label, s }: { label: string; s: LoopStatus }) {
  const color = s.running ? '#22c55e' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ color: '#9ca3af', fontSize: 10, width: 72 }}>{label}</span>
      <span style={{ color, fontSize: 9, fontWeight: 700, width: 78 }}>
        {s.running ? 'RUNNING' : 'NOT RUNNING'}
      </span>
      <span style={{ color: '#4b5563', fontSize: 9, marginLeft: 'auto' }}>
        {s.ticks} ticks{s.errors > 0 ? ` · ${s.errors} err` : ''}
      </span>
    </div>
  );
}

export function EngineTelemetry() {
  const [d, setD] = useState<ExecutionDiagnostics | null>(null);

  const poll = useCallback(async () => {
    const data = await loadDiagnostics();
    if (data) setD(data);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  if (!d) {
    return <div style={{ color: '#374151', fontSize: 10, fontFamily: 'monospace' }}>Loading telemetry…</div>;
  }

  const t = d.training;

  return (
    <div style={{ fontFamily: 'monospace' }}>
      <div className="font-mono text-[9px] uppercase tracking-wider mb-1.5" style={{ color: '#a855f7' }}>
        Engine loops {d.mode ? `· ${d.mode}` : ''}
      </div>

      <LoopRow label="SCALPING" s={d.loops.scalping} />
      <LoopRow label="EVENT"    s={d.loops.event} />
      <LoopRow label="SWING"    s={d.loops.swing} />

      {/* Active gates */}
      <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 9, color: '#4b5563' }}>
        <span>scalp conf ≥ <span style={{ color: '#9ca3af' }}>{Math.round(d.gates.scalp.minConfidence * 100)}%</span></span>
        <span>swing ≥ <span style={{ color: '#9ca3af' }}>{Math.round(d.gates.swing.minConfidence * 100)}%</span></span>
        <span>EV ≥ <span style={{ color: '#9ca3af' }}>{(d.gates.event.evThreshold * 100).toFixed(0)}%</span></span>
      </div>

      {/* Training stats */}
      {t && (
        <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: 9, color: '#4b5563' }}>
          <span>open <span style={{ color: '#f59e0b' }}>{t.open}</span></span>
          <span>closed <span style={{ color: '#9ca3af' }}>{t.closed}</span></span>
          <span>win <span style={{ color: '#9ca3af' }}>{t.winRate != null ? `${Math.round(t.winRate * 100)}%` : '—'}</span></span>
          <span>pnl <span style={{ color: t.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>${t.totalPnl.toFixed(2)}</span></span>
        </div>
      )}

      {/* Why no trade — recent scan/rejection reasons */}
      {d.recentScans.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ color: '#4b5563', fontSize: 8, letterSpacing: 0.6, marginBottom: 2 }}>WHY NO TRADE (recent)</div>
          {d.recentScans.slice(0, 5).map((r, i) => (
            <div key={i} style={{ color: '#6b7280', fontSize: 9, lineHeight: '13px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.reason}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
