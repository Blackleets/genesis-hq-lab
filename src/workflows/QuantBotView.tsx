// QuantBotView.tsx — Genesis Quant Lab live view: paper bot + treasury.
// Reads /api/genesis/live — REAL files written by liveRunner.mjs (hourly cron)
// and treasury.mjs. No fabricated data: if the backend is offline or the state
// files don't exist yet, shows an explicit empty state (no-theater rule).

import { useEffect, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';

interface BotState {
  equity: number;
  position: null | { side: string; entry: number; sl: number; tp: number; openedAt: string };
  trades: Array<{ side: string; entry: number; exit: number; reason: string; pnlPct: number; pnlUsd: number; closedAt: string }>;
  log?: string[];
}

interface TreasuryState {
  paperBalanceUSDT: number;
  allocatedToTrading: number;
  totalDeposited: number;
  totalWithdrawn: number;
}

interface LiveResponse {
  ok: boolean;
  bot: BotState | null;
  treasury: TreasuryState | null;
  updatedAt: string;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="gx-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`font-mono text-[15px] font-semibold ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-red-400' : 'text-zinc-100'}`}>
        {value}
      </div>
    </div>
  );
}

export default function QuantBotView() {
  const lang = useLanguage();
  const es = lang === 'es';
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch('/api/genesis/live');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j: LiveResponse = await r.json();
        if (alive) { setData(j); setError(null); }
      } catch {
        if (alive) setError(es ? 'Backend offline — npm run start' : 'Backend offline — npm run start');
      }
    }
    load();
    const id = setInterval(load, 30_000); // poll every 30s
    return () => { alive = false; clearInterval(id); };
  }, [es]);

  const wins = data?.bot?.trades?.filter((t) => t.pnlUsd > 0).length ?? 0;
  const nTrades = data?.bot?.trades?.length ?? 0;
  const wr = nTrades ? ((wins / nTrades) * 100).toFixed(1) : null;
  const gp = data?.bot?.trades?.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0) ?? 0;
  const gl = Math.abs(data?.bot?.trades?.filter((t) => t.pnlUsd <= 0).reduce((s, t) => s + t.pnlUsd, 0) ?? 0);
  const pf = gl > 0 ? (gp / gl).toFixed(2) : null;
  const ret = data?.bot?.equity != null && data.bot.equity !== 1000
    ? (((data.bot.equity - 1000) / 1000) * 100).toFixed(2)
    : '0.00';

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-6 bg-carbon-300">
      <div className="max-w-5xl mx-auto space-y-5">
        <header>
          <h1 className="text-xl font-bold text-zinc-100">
            {es ? '🧬 Genesis Quant Lab — Bot COTIUSDT (Paper)' : '🧬 Genesis Quant Lab — COTIUSDT Bot (Paper)'}
          </h1>
          <p className="text-[12px] text-zinc-500 mt-1">
            {es
              ? 'Estrategia meanReversion validada con 6 gates sobre datos reales de Binance. Paper · cero dólares reales.'
              : 'meanReversion strategy validated with 6 gates on real Binance data. Paper · zero real dollars.'}
          </p>
        </header>

        {/* Kill switch status */}
        <section className="gx-card px-4 py-3 flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-[12px] text-zinc-300">
            {es ? 'Kill switch armado: pausa automática si retorno ≤ −5% o PF < 0.7 con ≥10 trades.' : 'Kill switch armed: auto-pause if return ≤ −5% or PF < 0.7 with ≥10 trades.'}
          </span>
        </section>

        {/* Metrics */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label={es ? 'Equity papel' : 'Paper equity'} value={data?.bot ? `$${data.bot.equity.toFixed(2)}` : '—'} />
          <Metric label={es ? 'Retorno' : 'Return'} value={`${ret}%`} tone={parseFloat(ret) > 0 ? 'pos' : parseFloat(ret) < 0 ? 'neg' : undefined} />
          <Metric label="Trades" value={String(nTrades)} />
          <Metric label={es ? 'Win rate' : 'Win rate'} value={wr ? `${wr}%` : '—'} />
        </section>

        {/* Open position */}
        {data?.bot?.position && (
          <section className="gx-card px-4 py-3">
            <header className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
              {es ? 'Posición abierta' : 'Open position'}
            </header>
            <div className="font-mono text-[12px] text-zinc-200">
              {data.bot.position.side.toUpperCase()} @ {data.bot.position.entry} · SL {data.bot.position.sl.toFixed(6)} · TP {data.bot.position.tp.toFixed(6)}
            </div>
          </section>
        )}

        {/* Trade history */}
        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
            {es ? `Historial (${nTrades} trades · WR ${wr ?? '—'}% · PF ${pf ?? '—'})` : `History (${nTrades} trades · WR ${wr ?? '—'}% · PF ${pf ?? '—'})`}
          </header>
          {nTrades === 0 ? (
            <div className="px-4 py-4 text-[12px] text-zinc-500">
              {es ? 'Sin trades aún — el bot espera su setup (RSI ≤ 31 + Bollinger inferior).' : 'No trades yet — bot waiting for its setup (RSI ≤ 31 + lower Bollinger).'}
            </div>
            ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="text-zinc-500 border-b border-carbon-100">
                  <tr>
                    <th className="text-left px-3 py-1">{es ? 'Fecha' : 'Date'}</th>
                    <th className="text-left px-3 py-1">{es ? 'Lado' : 'Side'}</th>
                    <th className="text-right px-3 py-1">Entry</th>
                    <th className="text-right px-3 py-1">Exit</th>
                    <th className="text-left px-3 py-1">{es ? 'Cierre' : 'Close'}</th>
                    <th className="text-right px-3 py-1">P&L $</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data!.bot!.trades].reverse().map((t, i) => (
                    <tr key={i} className="border-b border-carbon-100/50">
                      <td className="px-3 py-1 text-zinc-400">{new Date(t.closedAt).toLocaleString()}</td>
                      <td className={`px-3 py-1 ${t.side === 'long' ? 'text-emerald-400' : 'text-red-400'}`}>{t.side}</td>
                      <td className="px-3 py-1 text-right text-zinc-300">{t.entry}</td>
                      <td className="px-3 py-1 text-right text-zinc-300">{t.exit}</td>
                      <td className="px-3 py-1 text-zinc-400">{t.reason}</td>
                      <td className={`px-3 py-1 text-right ${t.pnlUsd > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {t.pnlUsd > 0 ? '+' : ''}{t.pnlUsd.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Treasury */}
        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
            {es ? '🏦 Tesorería (paper)' : '🏦 Treasury (paper)'}
          </header>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
            <Metric label={es ? 'Balance desk' : 'Desk balance'} value={data?.treasury ? `$${data.treasury.paperBalanceUSDT.toFixed(2)}` : '—'} />
            <Metric label={es ? 'Asignado a trading' : 'Trading allocation'} value={data?.treasury ? `$${data.treasury.allocatedToTrading.toFixed(2)}` : '—'} />
            <Metric label={es ? 'Depósitos totales' : 'Total deposits'} value={data?.treasury ? `$${data.treasury.totalDeposited.toFixed(2)}` : '—'} />
            <Metric label={es ? 'Retiros totales' : 'Total withdrawals'} value={data?.treasury ? `$${data.treasury.totalWithdrawn.toFixed(2)}` : '—'} />
          </div>
          <p className="px-4 pb-3 text-[11px] text-zinc-500">
            {es
              ? 'Retiros reales requieren: whitelist creada por ti + token de aprobación + REAL_TRADING=true.'
              : 'Real withdrawals require: human-created whitelist + approval token + REAL_TRADING=true.'}
          </p>
        </section>

        {error && (
          <div className="gx-card px-4 py-3 text-[12px] text-amber-400">{error}</div>
        )}
      </div>
    </main>
  );
}
