// OperatorStatusBar.tsx — second header sub-row: live counter + training progress
// + engine heartbeat with stale detection. Consumes diagnostics + derived today stats
// from CryptoLabView (no own polling). A light 5s ticker keeps the "Xs ago" fresh.

import { useEffect, useState } from 'react';
import type { ExecutionDiagnostics, LoopStatus } from '@services/cryptoClient';

interface TodayStats { pnl: number; wins: number; losses: number; }

interface Props {
  diagnostics: ExecutionDiagnostics | null;
  openCount: number;
  today: TodayStats;
}

function agoSeconds(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const s = Math.floor((now - new Date(iso).getTime()) / 1000);
  return s < 0 ? 0 : s;
}

// A loop is stale if its last tick is older than 2× its expected interval.
function loopState(loop: LoopStatus | undefined, now: number): { label: string; color: string; ago: number | null } {
  if (!loop || !loop.running) return { label: 'OFFLINE', color: '#ef4444', ago: agoSeconds(loop?.lastRun ?? null, now) };
  const ago = agoSeconds(loop.lastRun, now);
  const stale = ago != null && ago * 1000 > loop.expectedMs * 2;
  return stale
    ? { label: 'DELAYED', color: '#f59e0b', ago }
    : { label: 'LIVE',    color: '#22c55e', ago };
}

function HeartbeatChip({ name, loop, now }: { name: string; loop: LoopStatus | undefined; now: number }) {
  const s = loopState(loop, now);
  const mark = s.label === 'LIVE' ? '✓' : s.label === 'DELAYED' ? '⚠' : '✗';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10 }} title={s.ago != null ? `last tick ${s.ago}s ago` : 'no tick yet'}>
      <span style={{ color: '#6b7280' }}>{name}</span>
      <span style={{ color: s.color, fontWeight: 700 }}>{mark} {s.label}</span>
      {s.label === 'DELAYED' && s.ago != null && (
        <span style={{ color: '#78716c' }}>{s.ago}s</span>
      )}
    </span>
  );
}

export function OperatorStatusBar({ diagnostics, openCount, today }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const t = diagnostics?.training;
  const loops = diagnostics?.loops;
  const wl = today.wins + today.losses;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      padding: '4px 12px', borderTop: '1px solid #161b26',
      fontFamily: 'monospace', fontSize: 10,
    }}>
      {/* Counter */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#a855f7', fontWeight: 700 }}>◆</span>
        <span style={{ color: '#f59e0b', fontWeight: 700 }}>{openCount}</span>
        <span style={{ color: '#6b7280' }}>open</span>
      </span>
      <span>
        <span style={{ color: '#6b7280' }}>PnL today </span>
        <span style={{ color: today.pnl >= 0 ? '#22c55e' : '#ef4444', fontWeight: 700 }}>
          {today.pnl >= 0 ? '+' : ''}${today.pnl.toFixed(2)}
        </span>
      </span>
      <span>
        <span style={{ color: '#6b7280' }}>W/L </span>
        <span style={{ color: '#9ca3af', fontWeight: 700 }}>{wl > 0 ? `${today.wins}/${today.losses}` : '—'}</span>
      </span>
      <span>
        <span style={{ color: '#6b7280' }}>engine </span>
        <span style={{ color: '#60a5fa', fontWeight: 700 }}>{t?.bestEngine ?? 'SCALP'}</span>
      </span>

      {/* Training progress */}
      <span style={{ color: '#262d3d' }}>│</span>
      <span title="Genesis is learning, not chasing pnl">
        <span style={{ color: '#6b7280' }}>Training </span>
        <span style={{ color: '#c084fc', fontWeight: 700 }}>Day {t?.trainingDay ?? 1}/30</span>
      </span>
      <span>
        <span style={{ color: '#6b7280' }}>trades </span>
        <span style={{ color: '#9ca3af', fontWeight: 700 }}>{t?.closed ?? 0}</span>
      </span>
      <span>
        <span style={{ color: '#6b7280' }}>conf acc </span>
        <span style={{ color: '#9ca3af', fontWeight: 700 }}>
          {t?.confidenceAccuracy != null ? `${t.confidenceAccuracy}%` : '—'}
        </span>
      </span>

      {/* Heartbeat */}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
        <HeartbeatChip name="FAST" loop={loops?.scalping} now={now} />
        <HeartbeatChip name="MID"  loop={loops?.event}    now={now} />
        <HeartbeatChip name="SLOW" loop={loops?.swing}    now={now} />
      </span>
    </div>
  );
}
