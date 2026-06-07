import { useEffect, useState, useCallback } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { loadCryptoOverview, type CryptoOverview } from '@services/cryptoClient';
import CandleChart from '@dashboard/charts/CandleChart';
import { apiUrl } from '@services/apiBase';
import { CommentaryFeed } from '../components/crypto/CommentaryFeed';
import { RightPanel } from '../components/crypto/RightPanel';
import { DeskPanel } from '../components/crypto/DeskPanel';

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

  const fetchOverview = useCallback(async () => {
    try {
      const d = await loadCryptoOverview();
      setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    const id = setInterval(fetchOverview, 15_000);
    return () => clearInterval(id);
  }, [fetchOverview]);

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
      {/* ── Header strip ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 shrink-0">
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
              <span className="font-mono text-xs text-amber-400">
                {pnl.open.count} open
              </span>
            </div>
          )}
        </div>
        {error && (
          <span className="font-mono text-[10px] text-red-400">
            ⚠ backend offline
          </span>
        )}
        {orderStatus && (
          <span className="font-mono text-[10px] text-zinc-300 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {orderStatus}
          </span>
        )}
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
          />
        </div>

        {/* AI Commentary (bottom-left) */}
        <div className="crypto-zone-commentary">
          <CommentaryFeed />
        </div>

        {/* Desk panel — positions + stats (bottom-center) */}
        <div className="crypto-zone-desk">
          <DeskPanel data={data} es={es} />
        </div>

        {/* Market Intelligence / Depth (bottom-right) */}
        <div className="crypto-zone-intel">
          <RightPanel />
        </div>
      </div>
    </main>
  );
}
