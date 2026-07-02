// communityLearning — opt-in client for the collective learning pool.
//
// Strictly anonymous: shares only strategy performance aggregates (family,
// interval, WR, PF, verdict). Never the wallet address, never the portfolio.
// The install id is a random UUID unrelated to any wallet. Opt-in, off by
// default, one click to leave.

import { getActiveConfig, type LocalLearningSnapshot } from '@services/localLearningEngine';

const OPTIN_KEY = 'genesis.community.optin.v1';
const INSTALL_KEY = 'genesis.community.install.v1';

export function isCommunityOptIn(): boolean {
  try { return localStorage.getItem(OPTIN_KEY) === '1'; } catch { return false; }
}

export function setCommunityOptIn(on: boolean) {
  try { localStorage.setItem(OPTIN_KEY, on ? '1' : '0'); } catch { /* fine */ }
}

function installId(): string {
  try {
    let id = localStorage.getItem(INSTALL_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(INSTALL_KEY, id);
    }
    return id;
  } catch {
    return 'anon';
  }
}

/** Share this run's aggregate with the pool. Silent no-op unless opted in. */
export async function shareLearning(snap: LocalLearningSnapshot): Promise<void> {
  if (!isCommunityOptIn() || !snap.ok || !snap.scorecard) return;
  const sc = snap.scorecard;
  const cfg = getActiveConfig();
  try {
    await fetch('/api/community', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        installId: installId(),
        family: cfg.family ?? 'donchian',
        interval: cfg.interval,
        verdict: sc.verdict,
        trades: sc.trades,
        winRate: sc.winRate,
        profitFactor: sc.profitFactor,
        pnlUsd: sc.pnlUsd ?? 0,
        tStat: sc.sharpe * Math.sqrt(sc.trades),
      }),
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* pool unreachable — never break local learning */ }
}

export interface CommunitySummary {
  contributions: number;
  byFamily: Record<string, { runs: number; avgWinRate: number; avgPf: number; goCount: number }>;
}

export async function fetchCommunitySummary(): Promise<CommunitySummary | null> {
  try {
    const res = await fetch('/api/community', { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.ok ? (body as CommunitySummary) : null;
  } catch {
    return null;
  }
}
