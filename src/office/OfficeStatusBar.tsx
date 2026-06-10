// OfficeStatusBar — discreet real-data strip under the office (Phase 5).
// Every value is real or an honest placeholder (unknown / unavailable /
// waiting). Engine state pairs a glyph with text so it never relies on
// color alone.

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

function fmtTime(ts: number | null): string {
  if (ts === null) return 'waiting';
  return new Date(ts).toLocaleTimeString([], { hour12: false });
}

export default function OfficeStatusBar({ state }: { state: LiveOfficeState }) {
  const positions = state.openPositionsCount === null ? 'unavailable' : String(state.openPositionsCount);
  const risk = state.riskStatus ?? 'unavailable';
  const activity = state.latestActivity ?? 'waiting for feed';

  return (
    <div
      className="absolute left-0 right-0 bottom-0 flex items-center gap-3 px-2 py-1 font-mono text-[8px] leading-[10px] text-zinc-400 overflow-hidden whitespace-nowrap"
      style={{ backgroundColor: 'rgba(10, 10, 18, 0.82)', borderTop: '1px solid rgba(113, 113, 122, 0.25)' }}
    >
      <span title="Derived from real loop heartbeats (/api/crypto/diagnostics)">
        <span style={{ color: ENGINE_COLOR[state.engineStatus] }}>{ENGINE_GLYPH[state.engineStatus]}</span>
        {' '}engine: <span className="text-zinc-200">{state.engineStatus}</span>
      </span>
      <span title="Real open positions from /api/crypto/overview">
        pos: <span className="text-zinc-200">{positions}</span>
      </span>
      <span title="Trade autopsy recommendation severity (real)">
        risk: <span className="text-zinc-200">{risk}</span>
      </span>
      <span className="flex-1 min-w-0 overflow-hidden text-ellipsis" title={state.latestActivity ?? undefined}>
        » {activity}
      </span>
      <span title="Last successful data refresh">
        {fmtTime(state.lastUpdateTs)}
      </span>
    </div>
  );
}
