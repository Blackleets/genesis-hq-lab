import { useEffect, useState, useCallback, useMemo } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import {
  loadCryptoOverview, loadTradeStories, loadCommentary, loadDiagnostics, loadShadowCandidateDiagnostics, loadBreakoutShadow,
  type CryptoOverview, type TradeStory, type CommentaryItem, type ExecutionDiagnostics, type ShadowCandidateDiagnostics, type BreakoutShadowDiagnostics,
} from '@services/cryptoClient';
import CandleChart from '@dashboard/charts/CandleChart';
import { apiUrl } from '@services/apiBase';
import { CommentaryFeed } from '../components/crypto/CommentaryFeed';
import { RightPanel } from '../components/crypto/RightPanel';
import { DeskPanel } from '../components/crypto/DeskPanel';
import { LiveActivityStrip } from '../components/crypto/LiveActivityStrip';
import { OperatorStatusBar } from '../components/crypto/OperatorStatusBar';
import { TradeNotifier } from '../components/crypto/TradeNotifier';

const ACCENT = '#f7931a';

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n ?? 0);
const pct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;

export default function CryptoLabView() {
  const lang = useLanguage();
  const es = lang === 'es';
  const [data, setData] = useState<CryptoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  const [tradeStories, setTradeStories] = useState<TradeStory[]>([]);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);
  const [commentary, setCommentary] = useState<CommentaryItem[]>([]);
  const [diagnostics, setDiagnostics] = useState<ExecutionDiagnostics | null>(null);
  const [shadowCandidate, setShadowCandidate] = useState<ShadowCandidateDiagnostics | null>(null);
  const [breakoutShadow, setBreakoutShadow] = useState<BreakoutShadowDiagnostics | null>(null);

  const fetchOverview = useCallback(async () => {
    try {
      const d = await loadCryptoOverview();
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const fetchTrades = useCallback(async () => { setTradeStories(await loadTradeStories(60)); }, []);
  const fetchCommentary = useCallback(async () => {
    const c = await loadCommentary(40);
    if (c.length > 0) setCommentary(c);
  }, []);
  const fetchDiagnostics = useCallback(async () => {
    const d = await loadDiagnostics();
    if (d) setDiagnostics(d);
  }, []);
  const fetchShadowCandidate = useCallback(async () => {
    const data = await loadShadowCandidateDiagnostics();
    if (data) setShadowCandidate(data);
  }, []);
  const fetchBreakoutShadow = useCallback(async () => {
    const data = await loadBreakoutShadow();
    if (data) setBreakoutShadow(data);
  }, []);

  useEffect(() => {
    fetchOverview(); fetchTrades(); fetchCommentary(); fetchDiagnostics(); fetchShadowCandidate(); fetchBreakoutShadow();
    const id1 = setInterval(fetchOverview, 15_000);
    const id2 = setInterval(fetchTrades, 15_000);
    const id3 = setInterval(fetchCommentary, 5_000);
    const id4 = setInterval(fetchDiagnostics, 10_000);
    const id5 = setInterval(fetchShadowCandidate, 10_000);
    const id6 = setInterval(fetchBreakoutShadow, 60_000); // 4h strategy — 1 min refresh is plenty
    return () => { clearInterval(id1); clearInterval(id2); clearInterval(id3); clearInterval(id4); clearInterval(id5); clearInterval(id6); };
  }, [fetchOverview, fetchTrades, fetchCommentary, fetchDiagnostics, fetchShadowCandidate, fetchBreakoutShadow]);

  // Today's realized stats — computed from closed trades (real, no extra fetch)
  const today = useMemo(() => {
    const startMs = new Date().setHours(0, 0, 0, 0);
    let pnl = 0, wins = 0, losses = 0;
    for (const t of tradeStories) {
      if (t.status === 'closed' && t.closed_at && Date.parse(t.closed_at) >= startMs) {
        pnl += t.pnl ?? 0;
        if ((t.pnl ?? 0) > 0) wins++; else if ((t.pnl ?? 0) < 0) losses++;
      }
    }
    return { pnl, wins, losses };
  }, [tradeStories]);

  async function handleManualOrder(side: 'LONG' | 'SHORT', pair: string) {
    setOrderStatus(`Enviando ${side} ${pair.replace('USDT', '')}…`);
    try {
      const res = await fetch(apiUrl('/api/crypto/order'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pair, side, capitalUsed: 100 }),
      });
      const json = await res.json();
      if (json.ok) {
        setOrderStatus(`✓ ${side} ejecutado — $100 en ${pair.replace('USDT', '')}`);
      } else {
        setOrderStatus(`✗ Error: ${json.error}`);
      }
    } catch {
      setOrderStatus('✗ Sin conexión al backend');
    }
    setTimeout(() => setOrderStatus(null), 5000);
  }

  const pnl = data?.pnl;

  return (
    <main className="flex-1 min-w-0 min-h-0 flex flex-col bg-carbon-300 overflow-hidden">
      {/* ── Header: brand row + live activity strip + operator status bar ─── */}
      <div className="shrink-0 border-b border-zinc-800">
        {/* Row 1 — brand + lifetime PnL */}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
            <span className="font-mono text-xs uppercase tracking-wider text-zinc-500">Genesis HQ · Crypto Terminal</span>
            {pnl && (
              <div className="flex gap-4 ml-4">
                <span className="font-mono text-xs" style={{ color: pnl.closed.totalPnl >= 0 ? '#22c55e' : '#ef4444' }}>
                  PnL {usd(pnl.closed.totalPnl)}
                </span>
                <span className="font-mono text-xs text-zinc-500">
                  Win {pnl.closed.total > 0 ? pct(pnl.closed.winRate) : '—'}
                </span>
                <span className="font-mono text-xs text-amber-400">{pnl.open.count} open</span>
              </div>
            )}
          </div>
          {error && <span className="font-mono text-[10px] text-red-400">⚠ backend offline</span>}
          {orderStatus && (
            <span className="font-mono text-[10px] text-zinc-300 flex items-center gap-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {orderStatus}
            </span>
          )}
        </div>

        {/* Row 2 — live activity strip (priority-aware) */}
        <div className="border-t border-zinc-800/60">
          <LiveActivityStrip items={commentary} />
        </div>

        {/* Row 3 — operator status bar (counter + training + heartbeat) */}
        <OperatorStatusBar
          diagnostics={diagnostics}
          openCount={pnl?.open.count ?? 0}
          today={today}
        />
      </div>

      {/* ── Chart-Hero Terminal Grid ──────────────────────────────────── */}
      {/*
        Layout:
          [──────────── CHART (hero, full width, tall) ────────────────]
          [ COMMENTARY ] [ DESK (positions/stats) ] [ INTEL | DEPTH ]
      */}
      <div className="crypto-terminal-grid">
        {/* Hero chart — spans full width on top */}
        <div className="crypto-zone-chart">
          <CandleChart
            positions={data?.positions ?? []}
            onManualOrder={handleManualOrder}
            tradeStories={tradeStories}
            selectedTradeId={selectedTradeId}
            onSelectTrade={setSelectedTradeId}
          />
        </div>

        {/* AI Commentary (bottom-left) */}
        <div className="crypto-zone-commentary">
          <CommentaryFeed items={commentary} />
        </div>

        {/* Desk panel — positions + stats + trades (bottom-center) */}
        <div className="crypto-zone-desk">
          <DeskPanel
            data={data}
            es={es}
            tradeStories={tradeStories}
            selectedTradeId={selectedTradeId}
            onSelectTrade={setSelectedTradeId}
            diagnostics={diagnostics}
            shadowCandidate={shadowCandidate}
            breakoutShadow={breakoutShadow}
          />
        </div>

        {/* Market Intelligence / Depth (bottom-right) */}
        <div className="crypto-zone-intel">
          <RightPanel />
        </div>
      </div>

      {/* Premium trade notifications (fixed, bottom-right) */}
      <TradeNotifier commentary={commentary} trades={tradeStories} />
    </main>
  );
}
