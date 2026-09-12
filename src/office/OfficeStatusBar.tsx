// OfficeStatusBar — operations header over the office.
// Real values or honest placeholders. PAPER / LIVE_OFF are always visible.

import { useEffect, useState } from 'react';
import type { EngineStatus, LiveOfficeState } from './officeTypes';

const ENGINE_GLYPH: Record<EngineStatus, string> = {
  online: '●',
  degraded: '◐',
  offline: '○',
  unknown: '?',
};

const ENGINE_COLOR: Record<EngineStatus, string> = {
  online: '#4ade80',
  degraded: '#fbbf24',
  offline: '#f87171',
  unknown: '#71717a',
};

function fmtClock(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

interface Props {
  state: LiveOfficeState;
  agentCount: number;
}

export default function OfficeStatusBar({ state, agentCount }: Props) {
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const positions = state.openPositionsCount === null ? 'unavailable' : String(state.openPositionsCount);
  const risk = state.riskStatus ?? 'unavailable';
  const activity = state.latestActivity ?? 'waiting for feed';

  return (
    <div
      className="absolute left-0 right-0 top-0 flex items-center gap-3 px-2 py-1 font-mono text-[8px] leading-[10px] text-zinc-400 overflow-hidden whitespace-nowrap"
      style={{ backgroundColor: 'rgba(13, 16, 22, 0.92)', borderBottom: '1px solid rgba(67, 81, 99, 0.55)' }}
    >
      <span className="font-bold tracking-[0.08em] text-zinc-100">
        <span style={{ color: '#34d27b' }}>⬢</span> GENESIS HQ
      </span>
      <span className="px-1 text-amber-300" style={{ border: '1px solid rgba(245, 158, 11, 0.45)' }}>PAPER</span>
      <span className="px-1 text-zinc-300" style={{ border: '1px solid rgba(67, 81, 99, 0.55)' }}>LIVE_OFF</span>
      <span title="Derived from real loop heartbeats (/api/crypto/diagnostics) or paper feed">
        engine: <span style={{ color: ENGINE_COLOR[state.engineStatus] }}>{ENGINE_GLYPH[state.engineStatus]}</span>
        {' '}<span className="text-zinc-200">{state.engineStatus}</span>
      </span>
      <span title="Live office agents rendered in this scene">
        agents: <span style={{ color: '#34d27b' }}>{agentCount}</span>
      </span>
      <span title="Open positions from overview, else paper funding feed">
        pos: <span className="text-zinc-200">{positions}</span>
      </span>
      <span title="Trade autopsy severity, or PAPER when only the funding feed is up">
        risk: <span className="text-zinc-200">{risk}</span>
      </span>
      <span className="flex-1 min-w-0 overflow-hidden text-ellipsis" title={state.latestActivity ?? undefined}>
        » {activity}
      </span>
      <span
        className="px-1.5 py-0.5 text-zinc-100"
        style={{ border: '1px solid rgba(67, 81, 99, 0.55)', backgroundColor: 'rgba(9, 11, 15, 0.9)' }}
        title="Local time"
      >
        {fmtClock(clock)}
      </span>
    </div>
  );
}
