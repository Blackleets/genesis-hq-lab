import { useEffect, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { loadCryptoOverview, type CryptoOverview } from '@services/cryptoClient';

const ACCENT = '#f7931a'; // bitcoin orange

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

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="gx-card px-4 py-3">
      <div className="gx-overline">{label}</div>
      <div className="font-mono text-2xl font-bold mt-1" style={{ color: color ?? '#e4e4e7' }}>{value}</div>
    </div>
  );
}

export default function CryptoLabView() {
  const lang = useLanguage();
  const es = lang === 'es';
  const [data, setData] = useState<CryptoOverview | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const p = data?.params;
  const pnl = data?.pnl;
  const adopted = data?.paramsMeta?.meta?.source === 'optimizer';

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-8 py-8 bg-carbon-300">
      <div className="max-w-5xl mx-auto space-y-6">
        <header>
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: ACCENT }} />
            <span className="gx-overline">Genesis HQ · {es ? 'Motor Crypto' : 'Crypto Engine'}</span>
          </div>
          <h1 className="font-mono text-3xl font-bold text-zinc-100">Crypto Lab</h1>
          <p className="font-mono text-[12px] text-zinc-500 mt-1">
            {es
              ? 'Scalping validado por backtest. PnL con comisiones + slippage reales. El optimizador entrena día y noche.'
              : 'Backtest-validated scalping. PnL with real fees + slippage. The optimizer trains day and night.'}
          </p>
        </header>

        {error && (
          <div className="border border-red-400/40 bg-red-500/5 px-5 py-4 font-mono text-[12px] text-red-300">
            {es ? 'Backend no disponible' : 'Backend unavailable'}: {error}
          </div>
        )}

        {!data && !error && (
          <div className="font-mono text-[12px] text-zinc-600">{es ? 'Cargando…' : 'Loading…'}</div>
        )}

        {data && (
          <>
            {/* Crypto-only PnL (cost-aware) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label={es ? 'PnL neto (crypto)' : 'Net PnL (crypto)'}
                value={usd(pnl!.closed.totalPnl)}
                color={pnl!.closed.totalPnl >= 0 ? '#00ff9c' : '#ff4757'} />
              <Stat label={es ? 'Win rate' : 'Win rate'} value={pnl!.closed.total > 0 ? pct(pnl!.closed.winRate) : '—'} color={ACCENT} />
              <Stat label={es ? 'Trades cerrados' : 'Closed trades'} value={String(pnl!.closed.total)} color="#22d3ee" />
              <Stat label={es ? 'Abiertos' : 'Open'} value={String(pnl!.open.count)} color="#f59e0b" />
            </div>

            {/* Live strategy params */}
            <section className="gx-card">
              <header className="gx-card-head gx-card-title flex items-center justify-between">
                <span>{es ? 'Parámetros en vivo' : 'Live parameters'}</span>
                <span className="font-mono text-[10px] px-2 py-0.5 border"
                  style={{ color: adopted ? '#00ff9c' : '#9ca3af', borderColor: adopted ? '#00ff9c44' : '#4a556844' }}>
                  {adopted ? (es ? 'optimizado ✓' : 'optimized ✓') : (es ? 'defaults' : 'defaults')}
                  {data.paramsMeta?.updatedAt ? ` · ${ago(data.paramsMeta.updatedAt)}` : ''}
                </span>
              </header>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-trim">
                {[
                  { k: es ? 'Target' : 'Target', v: pct(p!.targetPct) },
                  { k: es ? 'Stop' : 'Stop', v: pct(p!.stopPct) },
                  { k: 'Timeout', v: `${p!.timeoutHours}h` },
                  { k: es ? 'Momentum 1h' : '1h momentum', v: `${p!.momentumPct}%` },
                  { k: es ? 'Margen EMA' : 'EMA margin', v: pct(p!.emaMarginPct) },
                  { k: 'RSI long', v: `${p!.rsiLongMin}–${p!.rsiLongMax}` },
                  { k: 'RSI short', v: `${p!.rsiShortMin}–${p!.rsiShortMax}` },
                  { k: es ? 'Vol mín' : 'Min vol', v: `$${(p!.minVolume24h / 1e6).toFixed(0)}M` },
                ].map(({ k, v }) => (
                  <div key={k} className="bg-carbon-200 px-4 py-2.5">
                    <div className="gx-overline">{k}</div>
                    <div className="font-mono text-[15px] font-bold text-zinc-100 mt-0.5">{v}</div>
                  </div>
                ))}
              </div>
            </section>

            {/* Optimizer training log — the visible 24/7 training */}
            <section className="gx-card">
              <header className="px-4 py-3 border-b border-trim flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: ACCENT }} />
                <span className="font-mono text-[11px] uppercase tracking-wider font-bold" style={{ color: ACCENT }}>
                  {es ? 'Optimizador · entrenando (walk-forward)' : 'Optimizer · training (walk-forward)'}
                </span>
                {data.optimizerHeartbeat && (
                  <span className="font-mono text-[10px] text-zinc-600 ml-auto">
                    {es ? 'última corrida' : 'last pass'} {ago(data.optimizerHeartbeat.completedAt)} · {data.optimizerHeartbeat.days}d
                  </span>
                )}
              </header>
              {data.optimizerRuns.length === 0 ? (
                <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">
                  {es ? 'Sin corridas aún. Ejecuta `npm run optimizer`.' : 'No runs yet. Run `npm run optimizer`.'}
                </div>
              ) : (
                <ul className="divide-y divide-trim">
                  {data.optimizerRuns.map((r, i) => (
                    <li key={i} className="px-4 py-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-[10px] px-1.5 py-0.5 border shrink-0"
                          style={{
                            color: r.adopted ? '#00ff9c' : '#9ca3af',
                            borderColor: r.adopted ? '#00ff9c44' : '#4a556844',
                          }}>
                          {r.adopted ? 'ADOPT' : 'KEEP'}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-600">{ago(r.at)}</span>
                      </div>
                      <div className="font-mono text-[11px] text-zinc-400 leading-snug">{r.reason}</div>
                      {r.oosMetrics && (
                        <div className="font-mono text-[10px] text-zinc-600 mt-1">
                          OOS: exp {usd(r.oosMetrics.expectancy)} · {r.oosMetrics.trades} trades · win {pct(r.oosMetrics.winRate)}
                          {r.isMetrics && ` | IS: net ${usd(r.isMetrics.netPnl)} · ${r.isMetrics.trades} trades`}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Open positions + by-asset */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <section className="gx-card">
                <header className="gx-card-head gx-card-title">{es ? 'Posiciones abiertas' : 'Open positions'}</header>
                {data.positions.length === 0 ? (
                  <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">{es ? 'Ninguna abierta.' : 'None open.'}</div>
                ) : (
                  <ul className="divide-y divide-trim">
                    {data.positions.map((pos) => (
                      <li key={pos.id} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="font-mono text-[12px] text-zinc-100">
                            <span style={{ color: pos.side === 'LONG' ? '#00ff9c' : '#ff4757' }}>{pos.side}</span>{' '}
                            {pos.pair.replace('USDT', '')}
                          </div>
                          <div className="font-mono text-[9px] text-zinc-600 mt-0.5">
                            entry {pos.entry_price} · tgt {pos.target_price} · stop {pos.stop_price}
                          </div>
                        </div>
                        <div className="font-mono text-[11px] text-zinc-400">{usd(pos.capital_used)}</div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="gx-card">
                <header className="gx-card-head gx-card-title">{es ? 'PnL por moneda' : 'PnL by asset'}</header>
                {pnl!.byAsset.length === 0 ? (
                  <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">{es ? 'Sin trades cerrados.' : 'No closed trades.'}</div>
                ) : (
                  <ul className="divide-y divide-trim">
                    {pnl!.byAsset.map((a) => (
                      <li key={a.pair} className="px-4 py-2.5 flex items-center justify-between gap-3">
                        <div className="font-mono text-[12px] text-zinc-100">{a.pair.replace('USDT', '')}</div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono text-[10px] text-zinc-600">{a.trades}t · {pct(a.winRate)}</span>
                          <span className="font-mono text-[12px] font-bold" style={{ color: a.pnl >= 0 ? '#00ff9c' : '#ff4757' }}>
                            {usd(a.pnl)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            {/* Recent trades */}
            <section className="gx-card">
              <header className="gx-card-head gx-card-title">{es ? 'Trades recientes' : 'Recent trades'}</header>
              {data.recent.length === 0 ? (
                <div className="px-4 py-5 font-mono text-[11px] text-zinc-600">{es ? 'Aún sin historial.' : 'No history yet.'}</div>
              ) : (
                <ul className="divide-y divide-trim">
                  {data.recent.map((t) => (
                    <li key={t.id} className="px-4 py-2 flex items-center justify-between gap-3">
                      <div className="font-mono text-[11px] text-zinc-300">
                        <span style={{ color: t.side === 'LONG' ? '#00ff9c' : '#ff4757' }}>{t.side}</span>{' '}
                        {t.pair.replace('USDT', '')}
                        <span className="text-zinc-600"> · {t.exit_reason ?? '—'}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[9px] text-zinc-600">{ago(t.closed_at)}</span>
                        <span className="font-mono text-[12px] font-bold" style={{ color: (t.pnl ?? 0) >= 0 ? '#00ff9c' : '#ff4757' }}>
                          {usd(t.pnl ?? 0)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
