// useLiveOfficeState — read-only bridge between the real crypto system
// and the tile office. Polls existing /api/crypto/* endpoints through the
// existing cryptoClient loaders; adds no endpoints and never fabricates
// values: every unavailable source becomes null (rendered as
// unavailable/waiting), never an invented number.

import { useEffect, useState } from 'react';
import {
  loadCommentary,
  loadCryptoOverview,
  loadDiagnostics,
  type ExecutionDiagnostics,
} from '@services/cryptoClient';
import {
  DEFAULT_LIVE_OFFICE_STATE,
  type EngineStatus,
  type LiveOfficeState,
} from '@office/officeTypes';

const POLL_MS = 15_000;

/** Same liveness rule the server uses for /api/crypto/diagnostics. */
function loopIsLive(lastRun: string | null, expectedMs: number, now: number): boolean {
  if (!lastRun) return false;
  return now - new Date(lastRun).getTime() < expectedMs * 2 + 15_000;
}

function deriveEngineStatus(diag: ExecutionDiagnostics | null, now: number): EngineStatus {
  if (!diag) return 'unknown';
  const loops = [diag.loops.scalping, diag.loops.event, diag.loops.swing];
  const live = loops.filter((l) => loopIsLive(l.lastRun, l.expectedMs, now)).length;
  if (live === loops.length) return 'online';
  if (live > 0) return 'degraded';
  return 'offline';
}

export function useLiveOfficeState(): LiveOfficeState {
  const [state, setState] = useState<LiveOfficeState>(DEFAULT_LIVE_OFFICE_STATE);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const [diag, overview, commentary] = await Promise.all([
        loadDiagnostics().catch(() => null),
        loadCryptoOverview().catch(() => null),
        loadCommentary(1).catch(() => []),
      ]);
      if (!active) return;
      const now = Date.now();
      const anySource = diag !== null || overview !== null || commentary.length > 0;
      setState({
        liveDataConnected: anySource,
        engineStatus: deriveEngineStatus(diag, now),
        openPositionsCount: overview ? overview.positions.length : null,
        riskStatus: diag?.autopsy?.recommendation?.severity ?? null,
        latestActivity: commentary[0]?.text ?? null,
        lastUpdateTs: anySource ? now : null,
      });
    };

    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  return state;
}
