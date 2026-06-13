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
  openPositions: 0, liveMode: false,
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
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', letterSpacing: 0.5 }}>
            SOLANA ALPHA LAB
          </div>
          <div style={{ fontSize: 10, color: '#374151', marginTop: 1 }}>
            Pump.fun smart money · paper trading · 100 SOL virtual
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, fontSize: 10,
            color: status.connected ? '#22c55e' : '#6b7280',
            background: '#0a0e1a', border: '1px solid #1e2a3a', borderRadius: 4, padding: '3px 8px',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.connected ? '#22c55e' : '#374151', display: 'inline-block' }} />
            {status.wsStatus}
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
