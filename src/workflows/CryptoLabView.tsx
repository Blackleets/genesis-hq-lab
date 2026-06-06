import { useEffect, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { loadCryptoOverview, type CryptoOverview } from '@services/cryptoClient';
import CandleChart from '@dashboard/charts/CandleChart';
import { apiUrl } from '@services/apiBase';

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

  useEffect(() => {
    let alive = true;
    const fetchIt = async () => {
      try {
        const d = await loadCryptoOverview();
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    fetchIt();
    const id = setInterval(fetchIt, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

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
    } catch (e) {
      setOrderStatus(`✗ Sin conexión al backend`);
    }
    setTimeout(() => setOrderStatus(null), 5000);
  }

  const p = data?.params;
  const pnl = data?.pnl;
  const adopted = data?.paramsMeta?.meta?.source === 'optimizer';

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-4 py-6 bg-carbon-300">
      <div className="max-w-6xl mx-auto space-y-4">

        {/* Header */}
        <header className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
              <span className="gx-overline">Genesis HQ · Crypto Lab</span>
            </div>
            <h1 className="font-mono text-2xl font-bold text-zinc-100">
              {es ? 'Motor Crypto' : 'Crypto Engine'}
            </h1>
          </div>
          {/* Quick stats */}
          {pnl && (
            <div className="flex gap-4">
              <div className="text-right">
                <div className="gx-overline">PnL neto</div>
                <div className="font-mono text-lg font-bold" style={{ color: pnl.closed.totalPnl >= 0 ? '#00ff9c' : '#ff4757' }}>
                  {usd(pnl.closed.totalPnl)}
                </div>
              </div>
              <div className="text-right">
                <div className="gx-overline">Win rate</div>
                <div className="font-mono text-lg font-bold" style={{ color: ACCENT }}>
                  {pnl.closed.total > 0 ? pct(pnl.closed.winRate) : '—'}
                </div>
              </div>
              <div className="text-right">
                <div className="gx-overline">Abiertos</div>
                <div className="font-mono text-lg font-bold text-amber-400">{pnl.open.count}</div>
              </div>
            </div>
          )}
        </header>

        {error && (
          <div className="border border-red-400/40 bg-red-500/5 px-4 py-3 font-mono text-[12px] text-red-300">
            Backend no disponible: {error}
          </div>
        )}

        {/* Order status toast */}
        {orderStatus && (
          <div className="border border-zinc-700 bg-zinc-900 px-4 py-2 font-mono text-[12px] text-zinc-200 flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {orderStatus}
          </div>
        )}

        {/* ── MAIN CHART ────────────────────────────────────────────────── */}
        <CandleChart
          positions={data?.positions ?? []}
          onManualOrder={handleManualOrder}
        />

        {/* ── OPEN POSITIONS ─────────────────────────────────────────────── */}
        <section className="gx-card">
          <header className="gx-card-head gx-card-title flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {es ? 'Posiciones abiertas del agente' : 'Agent open positions'}
          </header>
          {!data || data.positions.length === 0 ? (
            <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">
              {es ? 'Sin posiciones abiertas — el agente está buscando entrada.' : 'No open positions — agent scanning for entry.'}
            </div>
          ) : (
            <ul className="divide-y divide-trim">
              {data.positions.map((pos) => {
                const isUp = pos.side === 'LONG';
                return (
                  <li key={pos.id} className="px-4 py-3 flex items-center gap-4">
                    {/* Side badge */}
                    <span className={`font-mono text-[11px] font-bold px-2 py-0.5 rounded ${isUp ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                      {pos.side}
                    </span>
                    {/* Asset */}
                    <span className="font-mono text-[13px] text-zinc-100 font-bold">{pos.pair.replace('USDT', '')}</span>
                    {/* Levels */}
                    <div className="flex gap-3 font-mono text-[10px] text-zinc-600">
                      <span>Entry <span className="text-zinc-300">${pos.entry_price}</span></span>
                      <span>TP <span className="text-emerald-400">${pos.target_price}</span></span>
                      <span>SL <span className="text-rose-400">${pos.stop_price}</span></span>
                    </div>
                    {/* Capital */}
                    <span className="font-mono text-[11px] text-zinc-400 ml-auto">{usd(pos.capital_used)}</span>
                    {/* Time */}
                    <span className="font-mono text-[9px] text-zinc-600">{ago(pos.opened_at)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── BOTTOM GRID ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* PnL by asset */}
          <section className="gx-card">
            <header className="gx-card-head gx-card-title">{es ? 'PnL por moneda' : 'PnL by asset'}</header>
            {!pnl || pnl.byAsset.length === 0 ? (
              <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">{es ? 'Sin trades cerrados.' : 'No closed trades.'}</div>
            ) : (
              <ul className="divide-y divide-trim">
                {pnl.byAsset.map((a) => (
                  <li key={a.pair} className="px-4 py-2.5 flex items-center justify-between">
                    <div>
                      <div className="font-mono text-[12px] text-zinc-100 font-bold">{a.pair.replace('USDT', '')}</div>
                      <div className="font-mono text-[9px] text-zinc-600">{a.trades} trades · {pct(a.winRate)}</div>
                    </div>
                    <span className="font-mono text-[13px] font-bold" style={{ color: a.pnl >= 0 ? '#00ff9c' : '#ff4757' }}>
                      {usd(a.pnl)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Live strategy params */}
          {p && (
            <section className="gx-card">
              <header className="gx-card-head gx-card-title flex items-center justify-between">
                <span>{es ? 'Parámetros' : 'Parameters'}</span>
                <span className="font-mono text-[9px] px-1.5 py-0.5 border"
                  style={{ color: adopted ? '#00ff9c' : '#9ca3af', borderColor: adopted ? '#00ff9c44' : '#4a556844' }}>
                  {adopted ? 'optimized ✓' : 'defaults'}
                </span>
              </header>
              <div className="grid grid-cols-2 gap-px bg-trim">
                {[
                  ['Target', pct(p.targetPct)],
                  ['Stop', pct(p.stopPct)],
                  ['Timeout', `${p.timeoutHours}h`],
                  ['Momentum', `${p.momentumPct}%`],
                  ['EMA margin', pct(p.emaMarginPct)],
                  ['RSI long', `${p.rsiLongMin}–${p.rsiLongMax}`],
                ].map(([k, v]) => (
                  <div key={k} className="bg-carbon-200 px-3 py-2">
                    <div className="gx-overline">{k}</div>
                    <div className="font-mono text-[13px] font-bold text-zinc-100">{v}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Recent trades */}
          <section className="gx-card">
            <header className="gx-card-head gx-card-title">{es ? 'Trades recientes' : 'Recent trades'}</header>
            {!data || data.recent.length === 0 ? (
              <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">{es ? 'Aún sin historial.' : 'No history yet.'}</div>
            ) : (
              <ul className="divide-y divide-trim">
                {data.recent.slice(0, 8).map((t) => (
                  <li key={t.id} className="px-4 py-2 flex items-center justify-between gap-2">
                    <div>
                      <span className="font-mono text-[11px] font-bold" style={{ color: t.side === 'LONG' ? '#00ff9c' : '#ff4757' }}>
                        {t.side}
                      </span>
                      <span className="font-mono text-[11px] text-zinc-400"> {t.pair.replace('USDT', '')}</span>
                      <div className="font-mono text-[9px] text-zinc-600">{t.exit_reason ?? '—'} · {ago(t.closed_at)}</div>
                    </div>
                    <span className="font-mono text-[12px] font-bold" style={{ color: (t.pnl ?? 0) >= 0 ? '#00ff9c' : '#ff4757' }}>
                      {usd(t.pnl ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Optimizer log */}
        {data && (
          <section className="gx-card">
            <header className="px-4 py-3 border-b border-trim flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
              <span className="font-mono text-[11px] uppercase tracking-wider font-bold" style={{ color: ACCENT }}>
                {es ? 'Optimizador · entrenando' : 'Optimizer · training (walk-forward)'}
              </span>
              {data.optimizerHeartbeat && (
                <span className="font-mono text-[10px] text-zinc-600 ml-auto">
                  {es ? 'última corrida' : 'last pass'} {ago(data.optimizerHeartbeat.completedAt)} · {data.optimizerHeartbeat.days}d
                </span>
              )}
            </header>
            {data.optimizerRuns.length === 0 ? (
              <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">
                {es ? 'Sin corridas aún.' : 'No runs yet. Run `npm run optimizer`.'}
              </div>
            ) : (
              <ul className="divide-y divide-trim">
                {data.optimizerRuns.slice(0, 5).map((r, i) => (
                  <li key={i} className="px-4 py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-[10px] px-1.5 py-0.5 border shrink-0"
                        style={{ color: r.adopted ? '#00ff9c' : '#9ca3af', borderColor: r.adopted ? '#00ff9c44' : '#4a556844' }}>
                        {r.adopted ? 'ADOPT' : 'KEEP'}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-600">{ago(r.at)}</span>
                    </div>
                    <div className="font-mono text-[11px] text-zinc-400 leading-snug">{r.reason}</div>
                    {r.oosMetrics && (
                      <div className="font-mono text-[10px] text-zinc-600 mt-1">
                        OOS: exp {usd(r.oosMetrics.expectancy)} · {r.oosMetrics.trades} trades · win {pct(r.oosMetrics.winRate)}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

      </div>
    </main>
  );
}
