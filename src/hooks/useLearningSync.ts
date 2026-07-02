import { useEffect } from 'react';
import { useAgents, updateAgentLearning, applyAgentTradingStats } from '@core/store/genesisStore';
import { runLocalLearning, type LocalLearningSnapshot } from '@services/localLearningEngine';

const AGENT_SKILL_MAP: Record<string, true> = {
  'trading-scalping-hunter': true,
  'trading-market-analyst': true,
  'trading-risk-sentinel': true,
  'trading-backtest-engineer': true,
  'trading-capital-manager': true,
};

const SNAPSHOT_KEY = 'genesis.local.learning.v1';
const BACKEND_INTERVAL_MS = 30_000;
const LOCAL_INTERVAL_MS = 5 * 60_000; // real Binance backtest is heavier — every 5 min

function persistSnapshot(snap: LocalLearningSnapshot) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* storage full / disabled — non-fatal */
  }
}

export function readLastLearningSnapshot(): LocalLearningSnapshot | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as LocalLearningSnapshot) : null;
  } catch {
    return null;
  }
}

/**
 * Keeps agent learningScores tied to REAL performance.
 *  1. Try the backend diagnostics (authoritative when it's up).
 *  2. If the backend is down, run a local Binance backtest so agents keep
 *     learning from real market data offline — no random noise.
 */
export function useLearningSync() {
  const agents = useAgents();

  useEffect(() => {
    let disposed = false;

    const applyScores = (scores: Record<string, number>) => {
      for (const agent of agents) {
        if (agent.id in AGENT_SKILL_MAP && typeof scores[agent.id] === 'number') {
          updateAgentLearning(agent.id, scores[agent.id]);
        }
      }
    };

    // Backend path — authoritative win-rate for all trading agents.
    const syncFromBackend = async (): Promise<boolean> => {
      try {
        const res = await fetch('/api/crypto/diagnostics');
        if (!res.ok) return false;
        const data = await res.json();
        if (!data.ok || !data.training) return false;
        const winRate = Math.max(0, Math.min(1, data.training.winRate ?? 0));
        const scores: Record<string, number> = {};
        for (const id of Object.keys(AGENT_SKILL_MAP)) scores[id] = Math.max(0.1, winRate);
        applyScores(scores);
        return true;
      } catch {
        return false;
      }
    };

    // Feed the full measured performance into the agents so every module that
    // renders them (HQ office, dashboard, HR) shows live real numbers. The
    // desk PnL is split evenly across the 5 trading agents (team attribution).
    const applyFullStats = (snap: LocalLearningSnapshot) => {
      const sc = snap.scorecard;
      // Older persisted snapshots may predate the money-term fields.
      if (!sc || typeof sc.pnlUsd !== 'number') {
        applyScores(snap.scores);
        return;
      }
      const tradingIds = Object.keys(AGENT_SKILL_MAP);
      const pnlShare = sc.pnlUsd / tradingIds.length;
      for (const agent of agents) {
        if (agent.id in AGENT_SKILL_MAP) {
          applyAgentTradingStats(agent.id, {
            learningScore: snap.scores[agent.id],
            winRate: sc.winRate,
            totalPnL: Math.round(pnlShare * 100) / 100,
            tradeCount: sc.trades,
          });
        }
      }
    };

    // Local path — real Binance backtest, backend-independent.
    const syncFromLocal = async () => {
      try {
        const snap = await runLocalLearning();
        if (disposed || !snap.ok) return;
        persistSnapshot(snap);
        applyFullStats(snap);
      } catch {
        // Last resort: replay the last persisted snapshot so scores stay real,
        // not reset, across reloads.
        const last = readLastLearningSnapshot();
        if (last?.ok) applyFullStats(last);
      }
    };

    const tick = async () => {
      const okBackend = await syncFromBackend();
      if (!okBackend && !disposed) await syncFromLocal();
    };

    tick();
    // Backend polled often; local backtest paced slower to respect Binance.
    const fast = setInterval(syncFromBackend, BACKEND_INTERVAL_MS);
    const slow = setInterval(() => { void syncFromLocal(); }, LOCAL_INTERVAL_MS);
    return () => {
      disposed = true;
      clearInterval(fast);
      clearInterval(slow);
    };
  }, [agents]);
}
