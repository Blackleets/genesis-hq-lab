import { useEffect, useState } from 'react';
import type { ExecutionDiagnostics, FuturesDeskSnapshot, LoopStatus } from '@services/cryptoClient';

interface TodayStats {
  pnl: number;
  wins: number;
  losses: number;
}

interface Props {
  diagnostics: ExecutionDiagnostics | null;
  openCount: number;
  today: TodayStats;
  futuresDesk?: FuturesDeskSnapshot | null;
}

function agoSeconds(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
  return seconds < 0 ? 0 : seconds;
}

function loopState(loop: LoopStatus | undefined, now: number): { label: string; color: string; ago: number | null } {
  if (!loop || !loop.running) return { label: 'OFFLINE', color: '#ef4444', ago: agoSeconds(loop?.lastRun ?? null, now) };
  const ago = agoSeconds(loop.lastRun, now);
  const stale = ago != null && ago * 1000 > loop.expectedMs * 2;
  return stale
    ? { label: 'DELAYED', color: '#f59e0b', ago }
    : { label: 'LIVE', color: '#22c55e', ago };
}

function HeartbeatChip({ name, loop, now }: { name: string; loop: LoopStatus | undefined; now: number }) {
  const state = loopState(loop, now);
  const mark = state.label === 'LIVE' ? 'OK' : state.label === 'DELAYED' ? 'WARN' : 'OFF';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10 }} title={state.ago != null ? `last tick ${state.ago}s ago` : 'no tick yet'}>
      <span style={{ color: '#6b7280' }}>{name}</span>
      <span style={{ color: state.color, fontWeight: 700 }}>{mark}</span>
      {state.label === 'DELAYED' && state.ago != null ? (
        <span style={{ color: '#78716c' }}>{state.ago}s</span>
      ) : null}
    </span>
  );
}

export function OperatorStatusBar({ diagnostics, openCount, today, futuresDesk = null }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  const training = diagnostics?.training;
  const loops = diagnostics?.loops;
  const recommendation = diagnostics?.autopsy?.recommendation ?? null;
  const manualFiltersActive = diagnostics?.autopsy?.manualFiltersActive ?? 0;
  const wl = today.wins + today.losses;

  const futuresProfiles = futuresDesk?.config.profiles ?? [];
  const futuresMode = futuresProfiles.length > 0;
  const futuresCycle = futuresDesk?.cycle ?? null;
  const futuresToday = futuresDesk?.today ?? null;
  const futuresOpenCount = futuresDesk?.openPositions.length ?? 0;
  const futuresDecision = futuresCycle?.blocked
    ? 'BLOCKED'
    : (futuresCycle?.executed ?? 0) > 0
      ? 'EXECUTING'
      : (futuresCycle?.qualified ?? 0) > 0
        ? 'READY'
        : 'WAIT';
  const futuresDecisionColor = futuresCycle?.blocked
    ? '#ef4444'
    : (futuresCycle?.executed ?? 0) > 0
      ? '#22c55e'
      : (futuresCycle?.qualified ?? 0) > 0
        ? '#f59e0b'
        : '#9ca3af';

  const legacyDecisionColor = recommendation?.severity === 'critical'
    ? '#dc2626'
    : recommendation?.triggered
      ? '#ef4444'
      : recommendation?.severity === 'medium'
        ? '#f59e0b'
        : '#22c55e';
  const legacyDecisionLabel = recommendation?.action === 'pause_or_redesign_strategy'
    ? 'PAUSE NOW'
    : recommendation?.triggered
      ? 'CHANGE/PAUSE'
      : 'TRAINING';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
        padding: '4px 12px',
        borderTop: '1px solid #161b26',
        fontFamily: 'monospace',
        fontSize: 10,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ color: '#a855f7', fontWeight: 700 }}>D</span>
        <span style={{ color: '#f59e0b', fontWeight: 700 }}>{futuresMode ? futuresOpenCount : openCount}</span>
        <span style={{ color: '#6b7280' }}>open</span>
      </span>

      <span>
        <span style={{ color: '#6b7280' }}>PnL today </span>
        <span
          style={{
            color: (futuresMode ? (futuresToday?.totalPnl ?? 0) : today.pnl) >= 0 ? '#22c55e' : '#ef4444',
            fontWeight: 700,
          }}
        >
          {(futuresMode ? (futuresToday?.totalPnl ?? 0) : today.pnl) >= 0 ? '+' : ''}
          ${(futuresMode ? (futuresToday?.totalPnl ?? 0) : today.pnl).toFixed(2)}
        </span>
      </span>

      <span>
        <span style={{ color: '#6b7280' }}>W/L </span>
        <span style={{ color: '#9ca3af', fontWeight: 700 }}>
          {futuresMode
            ? `${futuresToday?.wins ?? 0}/${futuresToday?.losses ?? 0}`
            : wl > 0 ? `${today.wins}/${today.losses}` : '-'}
        </span>
      </span>

      <span>
        <span style={{ color: '#6b7280' }}>engine </span>
        <span style={{ color: '#60a5fa', fontWeight: 700 }}>{futuresMode ? 'FUTURES' : training?.bestEngine ?? 'SCALP'}</span>
      </span>

      <span style={{ color: '#262d3d' }}>|</span>
      <span>
        <span style={{ color: '#6b7280' }}>{futuresMode ? 'Desk' : 'Training'} </span>
        <span style={{ color: '#c084fc', fontWeight: 700 }}>
          {futuresMode ? `${futuresProfiles.length} profiles` : `Day ${training?.trainingDay ?? 1}/30`}
        </span>
      </span>

      <span>
        <span style={{ color: '#6b7280' }}>{futuresMode ? 'scan' : 'trades'} </span>
        <span style={{ color: '#9ca3af', fontWeight: 700 }}>{futuresMode ? (futuresCycle?.scanned ?? 0) : (training?.closed ?? 0)}</span>
      </span>

      <span>
        <span style={{ color: '#6b7280' }}>{futuresMode ? 'qualified' : 'conf acc'} </span>
        <span style={{ color: '#9ca3af', fontWeight: 700 }}>
          {futuresMode ? (futuresCycle?.qualified ?? 0) : training?.confidenceAccuracy != null ? `${training.confidenceAccuracy}%` : '-'}
        </span>
      </span>

      {futuresMode ? (
        <>
          <span style={{ color: '#262d3d' }}>|</span>
          <span>
            <span style={{ color: '#6b7280' }}>decision </span>
            <span style={{ color: futuresDecisionColor, fontWeight: 700 }}>{futuresDecision}</span>
          </span>
          <span>
            <span style={{ color: '#6b7280' }}>exec </span>
            <span style={{ color: '#9ca3af', fontWeight: 700 }}>{futuresCycle?.executed ?? 0}</span>
          </span>
        </>
      ) : recommendation ? (
        <>
          <span style={{ color: '#262d3d' }}>|</span>
          <span title={recommendation.reason}>
            <span style={{ color: '#6b7280' }}>decision </span>
            <span style={{ color: legacyDecisionColor, fontWeight: 700 }}>{legacyDecisionLabel}</span>
          </span>
          {manualFiltersActive > 0 ? (
            <span title="Active additive filters already applied">
              <span style={{ color: '#6b7280' }}>filters </span>
              <span style={{ color: '#9ca3af', fontWeight: 700 }}>{manualFiltersActive}</span>
            </span>
          ) : null}
        </>
      ) : null}

      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10, flexWrap: 'wrap' }}>
        <HeartbeatChip name="FAST" loop={loops?.scalping} now={now} />
        <HeartbeatChip name="MID" loop={loops?.event} now={now} />
        <HeartbeatChip name="SLOW" loop={loops?.swing} now={now} />
      </span>
    </div>
  );
}
