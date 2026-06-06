import { useEffect, useState, useCallback } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { loadCryptoOverview, type CryptoOverview } from '@services/cryptoClient';
import CandleChart from '@dashboard/charts/CandleChart';
import { apiUrl } from '@services/apiBase';
import { ExecutionFeed } from '../components/crypto/ExecutionFeed';
import { MarketIntelPanel } from '../components/crypto/MarketIntelPanel';
import { ActivePositionsTerminal } from '../components/crypto/ActivePositionsTerminal';

const ACCENT = '#f7931a';

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n ?? 0);
const pct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;
const ago = (iso?: string | null) => {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(m)) return '—';
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

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

  const p = data?.params;
  const pnl = data?.pnl;
  const adopted = data?.paramsMeta?.meta?.source === 'optimizer';

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

      {/* ── 4-Zone Terminal Grid ──────────────────────────────────────── */}
      {/*
        Layout:
          [ZONE D — Feed 200px] [ZONE A — Chart 1fr] [ZONE B — Intel 200px]
          [─────────── ZONE C — Active Positions ──────────────────────────]
      */}
      <div className="crypto-terminal-grid">
        {/* ZONE D — Execution Feed (left) */}
        <div className="crypto-zone-feed">
          <ExecutionFeed />
        </div>

        {/* ZONE A — Hero Chart (center) */}
        <div className="crypto-zone-chart">
          <CandleChart
            positions={data?.positions ?? []}
            onManualOrder={handleManualOrder}
          />
        </div>

        {/* ZONE B — Market Intelligence (right) */}
        <div className="crypto-zone-intel">
          <MarketIntelPanel />
        </div>

        {/* ZONE C — Active Positions Terminal (full-width bottom) */}
        <div className="crypto-zone-positions">
          <ActivePositionsTerminal positions={data?.positions ?? []} />
        </div>
      </div>

      {/* ── Scrollable data strip (existing content preserved) ───────── */}
      <div className="shrink-0 overflow-y-auto border-t border-zinc-800" style={{ maxHeight: 260 }}>
        <div className="flex gap-4 p-3">

          {/* PnL by asset */}
          <div style={{ minWidth: 160 }}>
            <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-2">
              {es ? 'PnL por moneda' : 'PnL by asset'}
            </div>
            {!pnl || pnl.byAsset.length === 0 ? (
              <div className="font-mono text-[10px] text-zinc-700">{es ? 'Sin trades cerrados.' : 'No closed trades.'}</div>
            ) : (
              <div className="space-y-1">
                {pnl.byAsset.map((a) => (
                  <div key={a.pair} className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-mono text-[11px] text-zinc-200 font-bold">{a.pair.replace('USDT', '')}</span>
                      <span className="font-mono text-[9px] text-zinc-600 ml-1">{a.trades}t</span>
                    </div>
                    <span className="font-mono text-[10px] font-bold" style={{ color: a.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                      {usd(a.pnl)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Strategy params */}
          {p && (
            <div style={{ minWidth: 200 }}>
              <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-2 flex items-center gap-2">
                {es ? 'Parámetros' : 'Parameters'}
                <span className="font-mono text-[8px] px-1 border"
                  style={{ color: adopted ? '#22c55e' : '#6b7280', borderColor: adopted ? '#22c55e44' : '#374151' }}>
                  {adopted ? 'optimized' : 'defaults'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1">
                {[
                  ['Target', pct(p.targetPct)],
                  ['Stop', pct(p.stopPct)],
                  ['Timeout', `${p.timeoutHours}h`],
                  ['Momentum', `${p.momentumPct}%`],
                  ['EMA margin', pct(p.emaMarginPct)],
                  ['RSI long', `${p.rsiLongMin}–${p.rsiLongMax}`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-zinc-900 rounded px-2 py-1">
                    <div className="font-mono text-[8px] text-zinc-600">{k}</div>
                    <div className="font-mono text-[10px] font-bold text-zinc-200">{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent trades */}
          <div style={{ minWidth: 200, flex: 1 }}>
            <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-2">
              {es ? 'Trades recientes' : 'Recent trades'}
            </div>
            {!data || data.recent.length === 0 ? (
              <div className="font-mono text-[10px] text-zinc-700">{es ? 'Sin historial.' : 'No history yet.'}</div>
            ) : (
              <div className="space-y-1">
                {data.recent.slice(0, 5).map((t) => (
                  <div key={t.id} className="flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-[10px] font-bold" style={{ color: t.side === 'LONG' ? '#22c55e' : '#ef4444' }}>
                        {t.side}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500"> {t.pair.replace('USDT', '')}</span>
                      <span className="font-mono text-[9px] text-zinc-700 ml-1">{t.exit_reason ?? '—'}</span>
                    </div>
                    <span className="font-mono text-[10px] font-bold" style={{ color: (t.pnl ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                      {usd(t.pnl ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Optimizer heartbeat */}
          {data?.optimizerHeartbeat && (
            <div style={{ minWidth: 160 }}>
              <div className="font-mono text-[9px] uppercase tracking-wider mb-2" style={{ color: ACCENT }}>
                {es ? 'Optimizador' : 'Optimizer'}
              </div>
              <div className="space-y-1">
                <div className="font-mono text-[9px] text-zinc-600">
                  {es ? 'Última corrida' : 'Last pass'}{' '}
                  <span className="text-zinc-400">{ago(data.optimizerHeartbeat.completedAt)}</span>
                </div>
                <div className="font-mono text-[9px] text-zinc-600">
                  {data.optimizerHeartbeat.days}d de datos
                </div>
                <div className="font-mono text-[9px]" style={{ color: data.optimizerHeartbeat.adopted ? '#22c55e' : '#6b7280' }}>
                  {data.optimizerHeartbeat.adopted ? '✓ params adoptados' : 'params actuales'}
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </main>
  );
}
