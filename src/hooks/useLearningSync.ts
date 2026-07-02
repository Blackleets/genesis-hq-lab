import { useEffect } from 'react';
import { useAgents, updateAgentLearning, applyAgentTradingStats, emitAgentSays } from '@core/store/genesisStore';
import { runLocalLearning, runBruteForceSweep, getActiveConfig, SWEEP_KEY, type LocalLearningSnapshot } from '@services/localLearningEngine';

const AGENT_SKILL_MAP: Record<string, true> = {
  'trading-scalping-hunter': true,
  'trading-market-analyst': true,
  'trading-risk-sentinel': true,
  'trading-backtest-engineer': true,
  'trading-capital-manager': true,
};

const SNAPSHOT_KEY = 'genesis.local.learning.v1';
const LAST_SIG_KEY = 'genesis.local.learning.sig.v1';
const HISTORY_KEY = 'genesis.local.learning.history.v1';
const BACKEND_INTERVAL_MS = 30_000;
const LOCAL_INTERVAL_MS = 5 * 60_000; // real Binance backtest is heavier — every 5 min
const SWEEP_INTERVAL_MS = 6 * 60 * 60_000; // auto re-hunt edge every 6h (8 API calls/run)

// Regime adaptation: re-run the brute-force sweep automatically when the last
// one is stale, so the adopted config tracks the market without a human click.
let sweepInFlight = false;
async function autoSweepIfStale() {
  if (sweepInFlight) return;
  try {
    const raw = localStorage.getItem(SWEEP_KEY);
    if (raw) {
      const last = JSON.parse(raw) as { ranAt?: string };
      const age = last?.ranAt ? Date.now() - new Date(last.ranAt).getTime() : Infinity;
      if (age < SWEEP_INTERVAL_MS) return;
    }
  } catch { /* unreadable → treat as stale */ }
  sweepInFlight = true;
  try {
    const r = await runBruteForceSweep();
    if (r.ok) localStorage.setItem(SWEEP_KEY, JSON.stringify(r));
  } catch { /* next check retries */ } finally {
    sweepInFlight = false;
  }
}

// Learning trajectory: keep the last 50 snapshots' headline metrics so the
// system remembers whether it is getting better or worse between runs.
function appendHistory(snap: LocalLearningSnapshot) {
  const sc = snap.scorecard;
  if (!sc) return;
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const hist = raw ? (JSON.parse(raw) as unknown[]) : [];
    hist.push({
      ranAt: snap.ranAt,
      verdict: sc.verdict,
      trades: sc.trades,
      winRate: Math.round(sc.winRate * 1000) / 1000,
      profitFactor: Math.round(sc.profitFactor * 100) / 100,
      pnlUsd: Math.round((sc.pnlUsd ?? 0) * 100) / 100,
    });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(-50)));
  } catch { /* storage full — non-fatal */ }
}

// Agents visibly react in the office when the learning result CHANGES
// (new verdict or newly adopted config) — real reactions, not chatter spam.
function emitLearningReactions(snap: LocalLearningSnapshot) {
  const sc = snap.scorecard;
  if (!sc) return;
  const cfg = getActiveConfig();
  const sig = `${sc.verdict}:${cfg.source}:${cfg.interval}:D${cfg.breakoutPeriod}`;
  try {
    if (localStorage.getItem(LAST_SIG_KEY) === sig) return;
    localStorage.setItem(LAST_SIG_KEY, sig);
  } catch { /* storage unavailable → still emit once per session */ }

  const cfgLabel = `${cfg.interval} D${cfg.breakoutPeriod}/SMA${cfg.regimeSmaPeriod} TP${(cfg.tpPct * 100).toFixed(0)} SL${(cfg.slPct * 100).toFixed(0)}`;
  emitAgentSays('trading-backtest-engineer', {
    es: `Backtest fresco: ${sc.trades} trades, WR ${(sc.winRate * 100).toFixed(0)}%, PF ${sc.profitFactor.toFixed(2)} (${cfgLabel}).`,
    en: `Fresh backtest: ${sc.trades} trades, WR ${(sc.winRate * 100).toFixed(0)}%, PF ${sc.profitFactor.toFixed(2)} (${cfgLabel}).`,
  });
  if (cfg.source === 'sweep-oos') {
    emitAgentSays('trading-market-analyst', {
      es: `Adopté la config del sweep validada out-of-sample: ${cfgLabel}.`,
      en: `Adopted the OOS-validated sweep config: ${cfgLabel}.`,
    });
  }
  if (typeof sc.pnlUsd === 'number') {
    emitAgentSays('trading-capital-manager', {
      es: `PnL paper ${sc.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(sc.pnlUsd).toFixed(0)} · equity $${sc.equityUsd.toFixed(0)}.`,
      en: `Paper PnL ${sc.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(sc.pnlUsd).toFixed(0)} · equity $${sc.equityUsd.toFixed(0)}.`,
    });
  }
  emitAgentSays('trading-risk-sentinel', sc.verdict === 'GO'
    ? { es: '✓ Todos los gates pasan — edge validado. GO.', en: '✓ All gates pass — edge validated. GO.' }
    : sc.verdict === 'NO_GO'
      ? { es: `NO-GO. ${sc.nextMilestone ?? 'Gates sin pasar.'}`, en: `NO-GO. ${sc.nextMilestone ?? 'Gates failing.'}` }
      : { es: 'Muestra insuficiente — sigo acumulando evidencia.', en: 'Insufficient sample — still gathering evidence.' });
}

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
        // Hunt for a better config first when the last sweep is stale, so this
        // pass already runs whatever the market currently pays.
        await autoSweepIfStale();
        const snap = await runLocalLearning();
        if (disposed || !snap.ok) return;
        persistSnapshot(snap);
        appendHistory(snap);
        applyFullStats(snap);
        emitLearningReactions(snap);
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
