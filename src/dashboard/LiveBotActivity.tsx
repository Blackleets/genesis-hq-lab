// LiveBotActivity.tsx — autonomous widget that shows the REAL funding-arbitrage
// bot activity (paper, live Binance data) on the main dashboard. Polls the
// /api/crypto/executions endpoint (which reads the live Gist) every 5s.
import { useEffect, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';

type Trade = {
  t: number; pair: string; event: 'OPEN' | 'TP' | 'SL' | 'FUNDING' | 'PROTECT' | 'FLAT';
  side?: string; price?: number; pnl?: number; equity?: number; rate?: number; live?: boolean;
};
type Exec = { ok?: boolean; mode?: string; total?: number; updatedAt?: number; trades?: Trade[]; source?: string };

function color(e: string): string {
  if (e === 'TP' || e === 'FUNDING') return '#3ad17f';
  if (e === 'SL') return '#ff5d5d';
  if (e === 'PROTECT') return '#ffa64d';
  if (e === 'OPEN') return '#6aa0ff';
  return '#8b95a7';
}

export default function LiveBotActivity() {
  const lang = useLanguage();
  const [data, setData] = useState<Exec | null>(null);
  const [lastSync, setLastSync] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        let j: Exec | null = null;
        try { const r = await fetch('/executions.json'); j = await r.json(); } catch {}
        if (!j || !j.ok) { const r2 = await fetch('/api/crypto/executions'); j = await r2.json(); }
        if (active && j && j.ok) { setData(j); setLastSync(Date.now()); }
      } catch {}
    };
    load();
    const id = setInterval(load, 5000);
    return () => { active = false; clearInterval(id); };
  }, []);

  const trades = [...(data?.trades || [])].sort((a, b) => b.t - a.t).slice(0, 12);
  const total = data?.total ?? 50;
  const pnl = +(total - 50).toFixed(4);
  const funding = (data?.trades || []).filter((t) => t.event === 'FUNDING').length;

  return (
    <section className="gx-card">
      <header className="gx-card-head flex items-center justify-between">
        <span className="gx-card-title">
          {lang === 'es' ? '🤖 Bot de Funding (en vivo)' : '🤖 Funding Bot (live)'}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider"
          style={{ color: data?.mode === 'funding-paper' ? '#ffd24a' : '#8b95a7' }}>
          {data?.mode === 'funding-paper' ? 'PAPER' : data?.mode || '—'}
        </span>
      </header>
      <div className="px-4 py-3 flex items-baseline gap-4">
        <div>
          <div className="gx-label">{lang === 'es' ? 'Equity' : 'Equity'}</div>
          <div className="font-mono text-lg text-zinc-100">${total.toFixed(2)}</div>
        </div>
        <div>
          <div className="gx-label">{lang === 'es' ? 'Ganancia' : 'P&L'}</div>
          <div className="font-mono text-lg" style={{ color: pnl >= 0 ? '#3ad17f' : '#ff5d5d' }}>
            {pnl >= 0 ? '+' : ''}{pnl.toFixed(4)}
          </div>
        </div>
        <div>
          <div className="gx-label">{lang === 'es' ? 'Cobros funding' : 'Funding paid'}</div>
          <div className="font-mono text-lg text-zinc-100">{funding}</div>
        </div>
      </div>
      <div className="border-t border-trim">
        <ul className="divide-y divide-trim max-h-56 overflow-y-auto">
          {trades.length === 0 && (
            <li className="px-4 py-3 font-mono text-[11px] text-zinc-500">
              {lang === 'es' ? 'Esperando actividad del bot…' : 'Waiting for bot activity…'}
            </li>
          )}
          {trades.map((t, i) => (
            <li key={i} className="px-4 py-1.5 flex items-center justify-between gap-3 font-mono text-[11px]">
              <span style={{ color: color(t.event) }}>{t.event}</span>
              <span className="text-zinc-300">{t.pair}</span>
              {t.pnl !== undefined && (
                <span style={{ color: t.pnl >= 0 ? '#3ad17f' : '#ff5d5d' }}>
                  {t.pnl >= 0 ? '+' : ''}{t.pnl.toFixed(4)}
                </span>
              )}
              <span className="text-zinc-600">
                {new Date(t.t).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="px-4 py-1.5 font-mono text-[9px] text-zinc-600">
        {lang === 'es'
          ? 'Datos reales de Binance · paper · sin quemar cuentas'
          : 'Real Binance data · paper · no accounts burned'} · {lastSync ? `sync ${new Date(lastSync).toLocaleTimeString()}` : ''}
      </div>
    </section>
  );
}
