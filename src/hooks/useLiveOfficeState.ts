// useLiveOfficeState — read-only bridge between the real crypto system
// and the tile office. Polls existing /api/crypto/* plus the paper funding
// gist. Never fabricates values: unavailable sources stay null.

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

type PaperFeed = {
  openCount: number;
  lastLine: string | null;
  booted: boolean;
};

async function loadPaperFeed(): Promise<PaperFeed | null> {
  try {
    const r = await fetch('/api/crypto/executions', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    if (j && j.source === 'sample') return null; // refuse theater
    const trades = Array.isArray(j.trades) ? j.trades : [];
    const lastByPair = new Map<string, string>();
    trades.forEach((t: { pair?: string; event?: string }) => {
      if (t.pair) lastByPair.set(t.pair, String(t.event || ''));
    });
    const openCount = [...lastByPair.values()].filter((e) => e === 'OPEN').length;
    const last = trades.length ? trades[trades.length - 1] : null;
    const lastLine = last
      ? `PAPER ${last.pair ?? ''} ${last.event ?? ''}`.trim()
      : 'PAPER · LIVE_OFF · funding feed';
    return { openCount, lastLine, booted: true };
  } catch {
    return null;
  }
}

export function useLiveOfficeState(): LiveOfficeState {
  const [state, setState] = useState<LiveOfficeState>(DEFAULT_LIVE_OFFICE_STATE);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      const [diag, overview, commentary, paper] = await Promise.all([
        loadDiagnostics().catch(() => null),
        loadCryptoOverview().catch(() => null),
        loadCommentary(1).catch(() => []),
        loadPaperFeed(),
      ]);
      if (!active) return;
      const now = Date.now();
      const anySource = diag !== null || overview !== null || commentary.length > 0 || paper !== null;
      let engine = deriveEngineStatus(diag, now);
      // Diagnostics missing but paper feed alive: loops are off, not unknown.
      if (engine === 'unknown' && paper?.booted) engine = 'offline';
      const pos = overview
        ? overview.positions.length
        : paper
          ? paper.openCount
          : null;
      const activity = commentary[0]?.text
        ?? paper?.lastLine
        ?? null;
      setState({
        liveDataConnected: anySource,
        engineStatus: engine,
        openPositionsCount: pos,
        riskStatus: diag?.autopsy?.recommendation?.severity ?? (paper ? 'PAPER' : null),
        latestActivity: activity,
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
