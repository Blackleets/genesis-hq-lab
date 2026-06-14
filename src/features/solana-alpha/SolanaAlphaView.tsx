// SolanaAlphaView.tsx - Pump.fun Alpha dashboard.
// Real feed only. Paper trading only. No simulated token metrics.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { wsUrl } from '@services/apiBase';
import {
  fetchSolanaStatus,
  fetchSolanaTokens,
  fetchSolanaWallets,
  fetchSolanaSignals,
  fetchPaperStats,
  fetchPaperPositions,
  fetchPaperTrades,
  fetchEquityCurve,
  resetPaperBalance,
} from './api/solanaClient';
import type { EquityPoint, PaperPosition, PaperStats, PaperTrade, SolanaSignal, SolanaStatus, SolanaToken, SolanaWallet } from './api/solanaClient';
import { LiveTokenFeed } from './components/LiveTokenFeed';
import { SmartMoneyRanking } from './components/SmartMoneyRanking';
import { WalletExplorer } from './components/WalletExplorer';
import { AlphaSignals } from './components/AlphaSignals';
import { PaperPortfolio } from './components/PaperPortfolio';
import { RiskMonitor } from './components/RiskMonitor';
import { EquityCurve } from './components/EquityCurve';

const POLL_MS = 10_000;

const DEFAULT_STATUS: SolanaStatus = {
  connected: false,
  wsStatus: 'disconnected',
  subscribedTokens: 0,
  startedAt: null,
  paperBalance: 100,
  stats: { tradesOpened: 0, tradesClosed: 0 },
};

const DEFAULT_STATS: PaperStats = {
  balance: 100,
  openValue: 0,
  totalSol: 100,
  totalPnlSol: 0,
  totalTrades: 0,
  wins: 0,
  winRate: 0,
  avgPnlSol: 0,
  openPositions: 0,
  liveMode: false,
};

function stripOk<T extends { ok: boolean }>(payload: T): Omit<T, 'ok'> {
  const copy = { ...payload };
  delete (copy as Partial<T>).ok;
  return copy;
}

function shortMint(mint: string) {
  return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
}

function hotColor(confidence: number) {
  if (confidence >= 75) return '#00ff9c';
  if (confidence >= 62) return '#ffb547';
  return '#64748b';
}

function signalType(signal: Partial<SolanaSignal> & { signalType?: string }) {
  return signal.signal_type ?? signal.signalType ?? 'launch_signal';
}

function signalSymbol(signal: Partial<SolanaSignal> & { tokenSymbol?: string }) {
  return signal.token_symbol ?? signal.tokenSymbol ?? '???';
}

function signalActedOn(signal: Partial<SolanaSignal> & { actedOn?: boolean }) {
  return Boolean(signal.acted_on || signal.actedOn);
}

function wsCandidates() {
  const primary = wsUrl('/ws');
  return primary === '/ws' ? ['ws://127.0.0.1:8788/ws', primary] : [primary];
}

function ActivityTape({ tokens, signals, positions }: { tokens: SolanaToken[]; signals: SolanaSignal[]; positions: PaperPosition[] }) {
  const events = [
    ...positions.slice(0, 4).map((p) => ({ id: `pos-${p.id}`, tone: '#ffd24a', label: 'OPEN', text: `${p.token_symbol} ${p.size_sol.toFixed(1)} SOL` })),
    ...signals.slice(0, 7).map((s) => ({ id: `signal-${s.id}`, tone: hotColor(s.confidence), label: signalActedOn(s) ? 'AUTO' : 'SIGNAL', text: `${signalSymbol(s)} ${s.confidence}%` })),
    ...tokens.slice(0, 9).map((t) => ({ id: `token-${t.mint}`, tone: '#3da9fc', label: 'LAUNCH', text: `${t.symbol || '???'} ${t.marketCapSol.toFixed(1)} SOL` })),
  ].slice(0, 18);

  if (events.length === 0) {
    return (
      <div style={{ color: '#64748b', fontSize: 10, fontFamily: 'monospace' }}>
        No live Solana events yet. Start this backend on port 8788 if 8787 is occupied.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 8, overflow: 'hidden', minWidth: 0 }}>
      {events.map((event) => (
        <div key={event.id} style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 122,
          padding: '6px 8px',
          border: `1px solid ${event.tone}45`,
          background: `${event.tone}12`,
          fontFamily: 'monospace',
          fontSize: 10,
          animation: 'solanaSlideIn .18s ease-out',
        }}>
          <span style={{ width: 6, height: 6, background: event.tone, boxShadow: `0 0 10px ${event.tone}`, flexShrink: 0 }} />
          <span style={{ color: event.tone, fontWeight: 800 }}>{event.label}</span>
          <span style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.text}</span>
        </div>
      ))}
    </div>
  );
}

function RadarBars({ tokens, live }: { tokens: SolanaToken[]; live: boolean }) {
  return (
    <div style={{ width: 134, height: 80, display: 'flex', alignItems: 'end', gap: 4, paddingTop: 10 }}>
      {Array.from({ length: 18 }).map((_, i) => {
        const token = tokens[i];
        const value = token?.bondingCurvePct ?? 8 + ((i * 19) % 52);
        return (
          <span key={i} style={{
            width: 4,
            height: `${Math.max(10, Math.min(74, value))}%`,
            background: token ? (value >= 60 ? '#ffb547' : '#3da9fc') : '#1e293b',
            opacity: token ? 1 : 0.32,
            animation: live ? `solanaPulse ${0.9 + (i % 5) * 0.15}s ease-in-out infinite` : 'none',
          }} />
        );
      })}
    </div>
  );
}

export default function SolanaAlphaView() {
  const [status, setStatus] = useState<SolanaStatus>(DEFAULT_STATUS);
  const [tokens, setTokens] = useState<SolanaToken[]>([]);
  const [wallets, setWallets] = useState<SolanaWallet[]>([]);
  const [wSummary, setWSummary] = useState<{ total: number; smart: number }>({ total: 0, smart: 0 });
  const [signals, setSignals] = useState<SolanaSignal[]>([]);
  const [stats, setStats] = useState<PaperStats>(DEFAULT_STATS);
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [trades, setTrades] = useState<PaperTrade[]>([]);
  const [curve, setCurve] = useState<EquityPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hottestSignal = signals[0] ?? null;
  const hottestToken = tokens[0] ?? null;
  const activeTrade = positions[0] ?? null;
  const livePulse = status.connected && tokens.length > 0;

  const scannerLines = useMemo(() => {
    const lines = [
      hottestToken ? `new launch ${hottestToken.symbol || '???'} ${hottestToken.marketCapSol.toFixed(1)} SOL mcap` : null,
      hottestSignal ? `${signalType(hottestSignal).replace(/_/g, ' ')} ${hottestSignal.confidence}% on ${signalSymbol(hottestSignal)}` : null,
      activeTrade ? `paper long ${activeTrade.token_symbol} ${activeTrade.size_sol.toFixed(2)} SOL` : null,
      `${stats.openPositions}/10 paper slots in use`,
    ].filter(Boolean);
    return lines.length > 0 ? lines : ['waiting for PumpPortal launch stream'];
  }, [activeTrade, hottestSignal, hottestToken, stats.openPositions]);

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
      setStats(stripOk(ps) as PaperStats);
      setPositions(pos.positions);
      setTrades(tr.trades);
      setCurve(eq.curve);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, []);

  useEffect(() => {
    void loadAll();
    timerRef.current = setInterval(loadAll, POLL_MS);

    let ws: WebSocket | null = null;
    let opened = false;
    let stopped = false;

    const refreshPaper = () => {
      Promise.all([fetchPaperStats(), fetchPaperPositions(), fetchPaperTrades(50), fetchEquityCurve(200)])
        .then(([ps2, pos2, tr2, eq2]) => {
          setStats(stripOk(ps2) as PaperStats);
          setPositions(pos2.positions);
          setTrades(tr2.trades);
          setCurve(eq2.curve);
        })
        .catch(() => {});
    };

    const handleMessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'solana:new_token' && msg.token) {
          setTokens((prev) => [msg.token, ...prev.slice(0, 99)]);
        } else if (msg.type === 'solana:signal' && msg.signal) {
          setSignals((prev) => [msg.signal, ...prev.slice(0, 29)]);
        } else if (msg.type === 'solana:trade_opened' || msg.type === 'solana:trade_closed' || msg.type === 'solana:tick') {
          refreshPaper();
        }
      } catch {
        // Ignore malformed websocket messages.
      }
    };

    const connectWs = (urls: string[]) => {
      const url = urls[0];
      if (!url || stopped) return;
      try {
        ws = new WebSocket(url);
        ws.onopen = () => { opened = true; };
        ws.onmessage = handleMessage;
        ws.onerror = () => {
          if (!opened && urls.length > 1) connectWs(urls.slice(1));
        };
        ws.onclose = () => {
          if (!opened && urls.length > 1) connectWs(urls.slice(1));
        };
      } catch {
        connectWs(urls.slice(1));
      }
    };

    connectWs(wsCandidates());

    return () => {
      stopped = true;
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
    <div className="solana-alpha-root" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', overflowX: 'hidden', background: '#050810', padding: 10, gap: 8, position: 'relative' }}>
      <style>{`
        @keyframes solanaSweep { 0% { transform: translateX(-120%); opacity: 0; } 20% { opacity: 1; } 100% { transform: translateX(120%); opacity: 0; } }
        @keyframes solanaPulse { 0%, 100% { opacity: .45; transform: scaleY(.72); } 50% { opacity: 1; transform: scaleY(1); } }
        @keyframes solanaBlink { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
        @keyframes solanaSlideIn { from { transform: translateY(-4px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .solana-alpha-root * { box-sizing: border-box; }
        .solana-alpha-header { display: flex; align-items: center; gap: 10px; flex-shrink: 0; min-width: 0; }
        .solana-alpha-hero { min-height: 112px; display: grid; grid-template-columns: minmax(360px, 1.35fr) repeat(3, minmax(132px, .72fr)); gap: 8px; flex-shrink: 0; }
        .solana-alpha-tape { flex-shrink: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
        .solana-alpha-main { flex: 0 0 clamp(430px, calc(100vh - 380px), 520px); display: grid; grid-template-columns: minmax(410px, 1.25fr) minmax(330px, .95fr) minmax(320px, .85fr); grid-template-rows: minmax(0, 1fr); gap: 10px; min-height: 430px; padding-bottom: 8px; }
        .solana-alpha-stack { display: grid; grid-template-rows: minmax(230px, 1.1fr) minmax(138px, .65fr) minmax(150px, .75fr); gap: 8px; min-height: 0; }
        .solana-alpha-feed-column { display: grid; grid-template-rows: minmax(0, 1fr); min-height: 0; }
        .solana-alpha-signal-column { display: grid; grid-template-rows: minmax(0, 1fr); min-height: 0; }
        .solana-alpha-brand { display: flex; align-items: center; gap: 8px; min-width: 220px; }
        .solana-alpha-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; min-width: 0; }
        @media (max-height: 820px) {
          .solana-alpha-hero { min-height: 98px; grid-template-columns: minmax(320px, 1.4fr) repeat(3, minmax(120px, .65fr)); }
          .solana-alpha-main { flex-basis: clamp(390px, calc(100vh - 335px), 470px); min-height: 390px; }
          .solana-alpha-stack { grid-template-rows: minmax(190px, 1fr) minmax(118px, .55fr) minmax(130px, .65fr); }
        }
        @media (max-width: 1180px) {
          .solana-alpha-header { align-items: flex-start; flex-direction: column; }
          .solana-alpha-actions { margin-left: 0; flex-wrap: wrap; width: 100%; }
          .solana-alpha-hero { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .solana-alpha-tape { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .solana-alpha-main { flex: 0 0 auto; grid-template-columns: minmax(0, 1fr); grid-template-rows: repeat(3, minmax(260px, auto)); min-height: 0; }
          .solana-alpha-stack { grid-template-rows: repeat(3, minmax(220px, auto)); }
        }
      `}</style>

      <div className="solana-alpha-header">
        <div className="solana-alpha-brand" style={{ background: 'linear-gradient(135deg, #07111f 0%, #140820 100%)', border: '1px solid #26344d', borderRadius: 8, padding: '6px 10px' }}>
          <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', background: '#00ff9c', color: '#061018', fontSize: 10, fontWeight: 900 }}>PF</span>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#e6edf3', letterSpacing: 1 }}>PUMP.FUN ALPHA</div>
            <div style={{ fontSize: 9, color: '#64748b', marginTop: 1 }}>launch stream | paper trading | no custody</div>
          </div>
        </div>

        <div className="solana-alpha-actions">
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: status.connected ? '#00ff9c' : '#6b7280', background: '#0a0e1a', border: `1px solid ${status.connected ? '#14532d' : '#1e2a3a'}`, borderRadius: 4, padding: '4px 8px', fontFamily: 'monospace' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: status.connected ? '#00ff9c' : '#374151', display: 'inline-block', boxShadow: status.connected ? '0 0 7px #00ff9c' : 'none', animation: status.connected ? 'solanaBlink 1.3s infinite' : 'none' }} />
            {status.connected ? `LIVE | ${tokens.length} launches` : status.wsStatus}
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, color: '#ffb547', background: 'rgba(255,181,71,0.1)', border: '1px solid rgba(255,181,71,0.3)', borderRadius: 4, padding: '4px 7px' }}>
            PAPER ONLY | live_mode=false
          </div>
          {error && (
            <div style={{ fontSize: 9, color: '#ff4757', background: 'rgba(255,71,87,0.1)', borderRadius: 4, padding: '4px 8px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              API offline or wrong port: {error}
            </div>
          )}
        </div>
      </div>

      <div className="solana-alpha-hero">
        <div style={{ position: 'relative', overflow: 'hidden', background: '#08111f', border: '1px solid #1f334a', borderRadius: 8, padding: 14 }}>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(0,255,156,.10), transparent)', animation: livePulse ? 'solanaSweep 2.8s linear infinite' : 'none' }} />
          <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: '#00ff9c', fontWeight: 800, letterSpacing: 2 }}>LIVE LAUNCH RADAR</div>
              <div style={{ marginTop: 8, fontSize: 28, lineHeight: 1, color: '#e6edf3', fontWeight: 900, letterSpacing: 0 }}>
                {hottestToken ? hottestToken.symbol || '???' : 'NO FEED'}
              </div>
              <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 11, color: '#94a3b8' }}>
                {hottestToken ? `${shortMint(hottestToken.mint)} | ${hottestToken.marketCapSol.toFixed(1)} SOL mcap | ${hottestToken.bondingCurvePct.toFixed(0)}% curve` : 'Waiting for real PumpPortal launch events'}
              </div>
            </div>
            <RadarBars tokens={tokens} live={livePulse} />
          </div>
          <div style={{ position: 'relative', marginTop: 13 }}>
            <ActivityTape tokens={tokens} signals={signals} positions={positions} />
          </div>
        </div>

        {[
          { label: 'Launches', value: String(tokens.length), detail: status.connected ? 'stream online' : status.wsStatus, color: '#3da9fc' },
          { label: 'Signals', value: String(signals.length), detail: hottestSignal ? `${hottestSignal.confidence}% latest` : 'no score yet', color: hotColor(hottestSignal?.confidence ?? 0) },
          { label: 'Paper Slots', value: `${stats.openPositions}/10`, detail: `${stats.totalSol.toFixed(2)} SOL equity`, color: stats.openPositions > 0 ? '#ffd24a' : '#64748b' },
        ].map((card) => (
          <div key={card.label} style={{ background: '#0a0e1a', border: `1px solid ${card.color}40`, borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div style={{ fontSize: 10, color: card.color, letterSpacing: 1.4, fontWeight: 800 }}>{card.label.toUpperCase()}</div>
            <div style={{ fontSize: 31, lineHeight: 1, color: '#e6edf3', fontWeight: 900 }}>{card.value}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#94a3b8' }}>{card.detail}</div>
          </div>
        ))}
      </div>

      <div className="solana-alpha-tape">
        {scannerLines.slice(0, 4).map((line, i) => (
          <div key={`${line}-${i}`} style={{ border: '1px solid #17243a', background: '#07101b', padding: '7px 9px', fontFamily: 'monospace', fontSize: 10, color: '#9ca3af', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ width: 5, height: 5, background: i === 0 ? '#00ff9c' : '#3da9fc', animation: 'solanaBlink 1.2s linear infinite', flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{line}</span>
          </div>
        ))}
      </div>

      <div className="solana-alpha-main">
        <div className="solana-alpha-feed-column">
          <LiveTokenFeed tokens={tokens} />
        </div>
        <div className="solana-alpha-signal-column">
          <AlphaSignals signals={signals} />
        </div>
        <div className="solana-alpha-stack">
          <PaperPortfolio stats={stats} positions={positions} trades={trades} onReset={handleReset} />
          <RiskMonitor status={status} stats={stats} />
          <EquityCurve curve={curve} />
        </div>
      </div>

      <div style={{ flex: '0 0 220px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, minHeight: 220, paddingBottom: 8 }}>
        <SmartMoneyRanking wallets={wallets.filter((w) => w.score >= 55)} summary={wSummary} />
        <WalletExplorer wallets={wallets} />
      </div>
    </div>
  );
}
