// CouncilPanel.tsx — Decision Council dashboard (Fase 7).
// Shows the latest council decision with all role reports (technical,
// sentiment, bull/bear cases, trader summary), the Risk Manager and
// Portfolio Manager verdicts, approval/rejection stats, per-setup
// performance and blocked setups. Polls /api/crypto/council every 15s.
// All values come from real persisted decisions — no mocks.
// Rendered inside RightPanel (border-less, scrolls internally).

import { useEffect, useState, useCallback } from 'react';
import { loadCouncil, type CouncilSnapshot, type CouncilDecision, type CouncilPerformanceRow } from '@services/cryptoClient';

const POLL_MS = 15_000;

const STATE_COLOR: Record<string, string> = {
  HUNTING: '#6b7280',
  REVIEWING: '#f59e0b',
  APPROVED: '#22c55e',
  REJECTED: '#ef4444',
  EXECUTING: '#3b82f6',
};

const VERDICT_COLOR: Record<string, string> = {
  approved: '#22c55e',
  rejected: '#ef4444',
};

const mono: React.CSSProperties = { fontFamily: 'monospace' };

function Section({ title, color = '#9ca3af', children }: { title: string; color?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ ...mono, fontSize: 9, letterSpacing: 1, fontWeight: 700, color, textTransform: 'uppercase', marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function Report({ text }: { text: string | null }) {
  if (!text) return <div style={{ ...mono, fontSize: 9, color: '#4b5563' }}>—</div>;
  return (
    <div style={{ ...mono, fontSize: 9, lineHeight: 1.5, color: '#9ca3af', whiteSpace: 'pre-wrap' }}>
      {text}
    </div>
  );
}

function Verdict({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
      <span style={{ ...mono, fontSize: 9, color: '#6b7280' }}>{label}</span>
      <span style={{ ...mono, fontSize: 9, fontWeight: 700, color: VERDICT_COLOR[value] ?? '#9ca3af', textTransform: 'uppercase' }}>
        {value}
      </span>
    </div>
  );
}

function Num({ label, value, suffix = '' }: { label: string; value: number | null; suffix?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
      <span style={{ ...mono, fontSize: 9, color: '#6b7280' }}>{label}</span>
      <span style={{ ...mono, fontSize: 9, color: '#d1d5db' }}>{value == null ? '—' : `${value}${suffix}`}</span>
    </div>
  );
}

function PerfTable({ rows }: { rows: CouncilPerformanceRow[] }) {
  if (rows.length === 0) return <div style={{ ...mono, fontSize: 9, color: '#4b5563' }}>sin trades resueltos aún</div>;
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {['setup', 'n', 'wr', 'pf', 'pnl', 'ev'].map((h) => (
            <th key={h} style={{ ...mono, fontSize: 8, color: '#4b5563', textAlign: h === 'setup' ? 'left' : 'right', padding: '2px 2px', textTransform: 'uppercase' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(0, 8).map((r) => (
          <tr key={r.bucket}>
            <td style={{ ...mono, fontSize: 8, color: '#9ca3af', padding: '2px 2px', maxWidth: 90, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.bucket}</td>
            <td style={{ ...mono, fontSize: 8, color: '#6b7280', textAlign: 'right', padding: '2px 2px' }}>{r.samples}</td>
            <td style={{ ...mono, fontSize: 8, color: '#9ca3af', textAlign: 'right', padding: '2px 2px' }}>{r.winRate == null ? '—' : `${Math.round(r.winRate * 100)}%`}</td>
            <td style={{ ...mono, fontSize: 8, color: '#9ca3af', textAlign: 'right', padding: '2px 2px' }}>{Number.isFinite(r.profitFactor) ? r.profitFactor : '∞'}</td>
            <td style={{ ...mono, fontSize: 8, color: r.netPnl >= 0 ? '#22c55e' : '#ef4444', textAlign: 'right', padding: '2px 2px' }}>${r.netPnl}</td>
            <td style={{ ...mono, fontSize: 8, color: '#9ca3af', textAlign: 'right', padding: '2px 2px' }}>{r.avgEv == null ? '—' : r.avgEv}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LatestDecision({ d }: { d: CouncilDecision }) {
  const sideColor = d.side === 'long' ? '#22c55e' : d.side === 'short' ? '#ef4444' : '#6b7280';
  return (
    <>
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 8px', borderRadius: 6, marginBottom: 8,
        background: d.final_decision === 'approved' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
        border: `1px solid ${d.final_decision === 'approved' ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)'}`,
      }}>
        <div>
          <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: sideColor, textTransform: 'uppercase' }}>{d.side}</span>
          <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: '#d1d5db', marginLeft: 6 }}>{d.symbol}</span>
          <span style={{ ...mono, fontSize: 9, color: '#6b7280', marginLeft: 6 }}>{d.strategy}</span>
        </div>
        <span style={{ ...mono, fontSize: 10, fontWeight: 700, color: VERDICT_COLOR[d.final_decision], textTransform: 'uppercase' }}>
          {d.final_decision}
        </span>
      </div>

      {d.final_decision === 'rejected' && d.rejection_reason && (
        <Section title="razón de rechazo" color="#ef4444">
          <Report text={d.rejection_reason} />
        </Section>
      )}

      <Section title="economics">
        <Num label="entry" value={d.entry} />
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
          <span style={{ ...mono, fontSize: 9, color: '#6b7280' }}>SL → TP</span>
          <span style={{ ...mono, fontSize: 9, color: '#d1d5db' }}>{d.stop_loss ?? '—'} → {d.take_profit ?? '—'}</span>
        </div>
        <Num label="risk/reward" value={d.risk_reward} />
        <Num label="EV neto" value={d.expected_value} suffix=" $" />
        <Num label="riesgo" value={d.risk_usd} suffix=" $" />
        <Num label="fees + spread + slip" value={
          d.fees_estimated == null ? null
            : Math.round(((d.fees_estimated ?? 0) + (d.spread_estimated ?? 0) + (d.slippage_estimated ?? 0)) * 100) / 100
        } suffix=" $" />
        <Num label="win rate (hist)" value={d.win_rate == null ? null : Math.round(d.win_rate * 100)} suffix="%" />
        <Num label="profit factor (hist)" value={d.profit_factor} />
        <Num label="confianza" value={d.confidence == null ? null : Math.round(d.confidence * 100)} suffix="%" />
      </Section>

      <Section title="verdictos">
        <Verdict label="Risk Manager" value={d.risk_manager_verdict} />
        <Verdict label="Portfolio Manager" value={d.portfolio_manager_verdict} />
      </Section>

      <Section title="technical analyst" color="#3b82f6"><Report text={d.technical_report} /></Section>
      <Section title="bull case" color="#22c55e"><Report text={d.bull_case} /></Section>
      <Section title="bear case" color="#ef4444"><Report text={d.bear_case} /></Section>
      <Section title="trader" color="#a855f7"><Report text={d.trader_summary} /></Section>
      <Section title="sentiment / news" color="#f59e0b"><Report text={d.sentiment_report} /></Section>

      {d.lessons_from_similar_trades.length > 0 && (
        <Section title="lecciones similares" color="#f97316">
          {d.lessons_from_similar_trades.map((l, i) => (
            <div key={i} style={{ ...mono, fontSize: 9, color: '#9ca3af', marginBottom: 3 }}>· {l}</div>
          ))}
        </Section>
      )}

      {d.outcome && (
        <Section title="resultado" color={d.outcome.pnl != null && d.outcome.pnl > 0 ? '#22c55e' : '#ef4444'}>
          <Num label="PnL" value={d.outcome.pnl} suffix=" $" />
          <Report text={d.outcome.lesson} />
        </Section>
      )}
    </>
  );
}

export function CouncilPanel() {
  const [snap, setSnap] = useState<CouncilSnapshot | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const refresh = useCallback(async () => {
    const data = await loadCouncil();
    if (data) setSnap(data);
    setLoadedOnce(true);
  }, []);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!loadedOnce) {
    return <div style={{ ...mono, fontSize: 10, color: '#6b7280', padding: 12 }}>cargando council…</div>;
  }
  if (!snap) {
    return <div style={{ ...mono, fontSize: 10, color: '#6b7280', padding: 12 }}>council no disponible</div>;
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ ...mono, fontSize: 10, fontWeight: 700, letterSpacing: 1, color: '#d1d5db' }}>DECISION COUNCIL</span>
        <span style={{
          ...mono, fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
          color: STATE_COLOR[snap.state] ?? '#6b7280',
          border: `1px solid ${STATE_COLOR[snap.state] ?? '#6b7280'}`,
        }}>
          {snap.state}
        </span>
      </div>

      <Section title="balance">
        <div style={{ display: 'flex', gap: 12 }}>
          <span style={{ ...mono, fontSize: 9, color: '#22c55e' }}>✓ {snap.stats.approved} aprobados</span>
          <span style={{ ...mono, fontSize: 9, color: '#ef4444' }}>✗ {snap.stats.rejected} rechazados</span>
        </div>
        {snap.stats.topRejectionReasons.slice(0, 4).map((r) => (
          <div key={r.reason} style={{ display: 'flex', justifyContent: 'space-between', padding: '1px 0' }}>
            <span style={{ ...mono, fontSize: 8, color: '#6b7280', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.reason}</span>
            <span style={{ ...mono, fontSize: 8, color: '#9ca3af' }}>{r.count}</span>
          </div>
        ))}
      </Section>

      {snap.latest
        ? <LatestDecision d={snap.latest} />
        : <div style={{ ...mono, fontSize: 9, color: '#4b5563', marginBottom: 10 }}>sin decisiones todavía — el council espera la primera señal</div>}

      <Section title="performance por setup" color="#3b82f6">
        <PerfTable rows={snap.performance.bySetup} />
      </Section>
      <Section title="performance por estrategia" color="#a855f7">
        <PerfTable rows={snap.performance.byStrategy} />
      </Section>

      {snap.blockedSetups.length > 0 && (
        <Section title="setups bloqueados" color="#ef4444">
          <PerfTable rows={snap.blockedSetups} />
        </Section>
      )}
    </div>
  );
}
