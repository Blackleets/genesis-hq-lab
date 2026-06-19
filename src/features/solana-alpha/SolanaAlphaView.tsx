// SolanaAlphaView.tsx — Solana Alpha Lab dashboard.
// 7-panel layout: Feed · Smart Money · Wallets · Signals · Portfolio · Risk · Equity.
// Polls REST every 10s; also listens on WebSocket for real-time events.

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  fetchSolanaStatus, fetchSolanaTokens, fetchSolanaWallets,
  fetchSolanaSignals, fetchPaperStats, fetchPaperPositions,
  fetchPaperTrades, fetchEquityCurve, resetPaperBalance,
} from './api/solanaClient';
import type {
  SolanaStatus, SolanaToken, SolanaWallet, SolanaSignal,
  PaperPosition, PaperTrade, PaperStats, EquityPoint,
} from './api/solanaClient';
import { LiveTokenFeed }      from './components/LiveTokenFeed';
import { SmartMoneyRanking }  from './components/SmartMoneyRanking';
import { WalletExplorer }     from './components/WalletExplorer';
import { AlphaSignals }        from './components/AlphaSignals';
import { PaperPortfolio }     from './components/PaperPortfolio';
import { RiskMonitor }        from './components/RiskMonitor';
import { EquityCurve }        from './components/EquityCurve';

const POLL_MS = 10_000;

const DEFAULT_STATUS: SolanaStatus = {
  connected: false, wsStatus: 'disconnected', subscribedTokens: 0,
  startedAt: null, paperBalance: 100, stats: { tradesOpened: 0, tradesClosed: 0 },
};
const DEFAULT_STATS: PaperStats = {
  balance: 100, openValue: 0, totalSol: 100, totalPnlSol: 0,
  totalTrades: 0, wins: 0, winRate: 0, avgPnlSol: 0,
  avgWinSol: 0, avgLossSol: 0,
  openPositions: 0, liveMode: false,
  profitFactor: 0, maxDrawdownPct: 0, streak: 0,
};

export default function SolanaAlphaView() {
  const [status, setStatus]       = useState<SolanaStatus>(DEFAULT_STATUS);
  const [tokens, setTokens]       = useState<SolanaToken[]>([]);
  const [wallets, setWallets]     = useState<SolanaWallet[]>([]);
  const [wSummary, setWSummary]   = useState<{ total: number; smart: number }>({ total: 0, smart: 0 });
  const [signals, setSignals]     = useState<SolanaSignal[]>([]);
  const [stats, setStats]         = useState<PaperStats>(DEFAULT_STATS);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [trades, setTrades]       = useState<PaperTrade[]>([]);
  const [curve, setCurve]         = useState<EquityPoint[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadAll = useCallback(async () => {
    try {
      const [st, tok, wal, sig, ps, pos, tr, eq] = await Promise.all([
        fetchSolanaStatus(),
        fetchSolanaTokens(100),
        fetchSolanaWallets(100),
        fetchSolanaSignals(30),
        fetchPaperStats(),
        fetchPaperPositions(),
        fetchPaperTrades(50),
        fetchEquityCurve(200),
      ]);
      setStatus(st);
      setTokens(tok.tokens);
      setWallets(wal.wallets);
      setWSummary(wal.summary);
      setSignals(sig.signals);
      const { ok: _ok, ...statsData } = ps;
      setStats(statsData as PaperStats);
      setPositions(pos.positions);
      setTrades(tr.trades);
      setCurve(eq.curve);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    loadAll();
    timerRef.current = setInterval(loadAll, POLL_MS);

    // WebSocket live events (add new tokens/signals to top of list)
    const wsBase = (import.meta.env.VITE_API_URL ?? '').replace(/^http/, 'ws');
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`${wsBase}/ws`);
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'solana:new_token' && msg.token) {
            setTokens(prev => [msg.token, ...prev.slice(0, 99)]);
          } else if (msg.type === 'solana:signal' && msg.signal) {
            setSignals(prev => [msg.signal, ...prev.slice(0, 29)]);
          } else if (msg.type === 'solana:trade_opened' || msg.type === 'solana:trade_closed') {
            // trigger a partial refresh of portfolio data
            Promise.all([fetchPaperStats(), fetchPaperPositions(), fetchPaperTrades(50), fetchEquityCurve(200)])
              .then(([ps2, pos2, tr2, eq2]) => {
                const { ok: _ok, ...sd } = ps2;
                setStats(sd as PaperStats);
                setPositions(pos2.positions);
                setTrades(tr2.trades);
                setCurve(eq2.curve);
              }).catch(() => {});
          }
        } catch { /* ignore malformed */ }
      };
    } catch { /* WS optional */ }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (ws) ws.close();
    };
  }, [loadAll]);

  const handleReset = async () => {
    if (!confirm('Reset paper balance to 100 SOL and close all positions?')) return;
    try {
      await resetPaperBalance();
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#050810', padding: 12, gap: 8 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        {/* Pump.fun pill badge */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'linear-gradient(135deg, #1a0533 0%, #2d0a5e 100%)',
          border: '1px solid #7c3aed', borderRadius: 8, padding: '5px 10px',
        }}>
          <span style={{ fontSize: 18, lineHeight: 1 }}>💊</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#c4b5fd', letterSpacing: 1 }}>
              PUMP.FUN ALPHA
            </div>
            <div style={{ fontSize: 9, color: '#6d28d9', marginTop: 1 }}>
              smart money · paper trading · 100 SOL
            </div>
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Live feed status */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 10,
            color: status.connected ? '#22c55e' : '#6b7280',
            background: '#0a0e1a', border: `1px solid ${status.connected ? '#14532d' : '#1e2a3a'}`, borderRadius: 4, padding: '3px 8px',
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: status.connected ? '#22c55e' : '#374151',
              display: 'inline-block',
              boxShadow: status.connected ? '0 0 5px #22c55e' : 'none',
              animation: status.connected ? 'pulse 2s infinite' : 'none',
            }} />
            {status.connected ? `LIVE · ${status.subscribedTokens} tokens` : status.wsStatus}
          </div>

          {/* Paper badge */}
          <div style={{
            fontSize: 9, fontWeight: 700, color: '#f59e0b',
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            borderRadius: 4, padding: '3px 7px',
          }}>
            PAPER ONLY · live_mode=false
          </div>

          {error && (
            <div style={{ fontSize: 9, color: '#ef4444', background: 'rgba(239,68,68,0.1)', borderRadius: 4, padding: '3px 8px' }}>
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Grid layout */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gridTemplateRows: '1fr 1fr', gap: 8, minHeight: 0 }}>
        {/* Row 1 */}
        <LiveTokenFeed tokens={tokens} />
        <SmartMoneyRanking wallets={wallets.filter(w => w.score >= 55)} summary={wSummary} />
        <AlphaSignals signals={signals} />

        {/* Row 2 */}
        <PaperPortfolio stats={stats} positions={positions} trades={trades} onReset={handleReset} />
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 8 }}>
          <RiskMonitor status={status} stats={stats} />
          <WalletExplorer wallets={wallets} />
        </div>
        <EquityCurve curve={curve} />
      </div>
    </div>
  );
}
