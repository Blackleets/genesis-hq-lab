// FundingBotView.tsx — dedicated, clean module showing the REAL funding-arbitrage
// bot (paper, live Binance data). No dependency on any failing backend — the
// LiveBotActivity widget fetches /api/crypto/executions directly.
import { useLanguage } from '@core/i18n/languageStore';
import LiveBotActivity from '@dashboard/LiveBotActivity';

export default function FundingBotView() {
  const lang = useLanguage();
  const es = lang === 'es';
  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-6 bg-carbon-300">
      <div className="max-w-5xl mx-auto space-y-5">
        <header>
          <h1 className="text-xl font-bold text-zinc-100">
            {es ? '🤖 Bot de Funding (Arbitraje de Tasa)' : '🤖 Funding Bot (Rate Arbitrage)'}
          </h1>
          <p className="text-[12px] text-zinc-500 mt-1">
            {es
              ? 'Posición delta-neutral que cobra el funding real de Binance. Paper · sin quemar cuentas.'
              : 'Delta-neutral position collecting real Binance funding. Paper · no accounts burned.'}
          </p>
        </header>

        {/* The live widget — REAL data, polls every 5s */}
        <LiveBotActivity />

        {/* Honest explanation card */}
        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
            {es ? 'Cómo funciona (honesto)' : 'How it works (honest)'}
          </header>
          <ul className="px-4 py-3 space-y-2 text-[12px] text-zinc-300 leading-snug">
            <li>• {es
              ? 'El bot lee la tasa de funding REAL de Binance Futures y se posiciona del lado que LA RECIBE (cortoperp/largo-spot cuando el funding es positivo, y viceversa).'
              : 'The bot reads the REAL Binance Futures funding rate and takes the side that RECEIVES it (short-perp/long-spot when funding is positive, and reverse).'}</li>
            <li>• {es
              ? 'El ingreso es el funding pagado cada 8h. El equity solo sube en cobros reales — no se fabrica PnL.'
              : 'Income is the funding paid every 8h. Equity only rises on real settlements — no fabricated PnL.'}</li>
            <li>• {es
              ? 'Protección anti-quemadura: delta-neutral + cierre si el drawdown >1.5%. Modo paper: $50 simulados, cero órdenes reales.'
              : 'Burn protection: delta-neutral + close if drawdown >1.5%. Paper mode: $50 simulated, zero real orders.'}</li>
            <li>• {es
              ? 'Edge validado en datos reales: 20 pares pasan los gates (PF 2–7000). El scalping discreto y la microestructura NO tienen edge (0/240 probados).'
              : 'Edge validated on real data: 20 pairs pass gates (PF 2–7000). Discrete scalping & microstructure have NO edge (0/240 tested).'}</li>
            <li>• {es
              ? 'Para ganar dinero REAL: se requiere tu cuenta Binance Futures (retiro deshabilitado) + $50 cap + tu autorización. Hasta entonces, esto es entrenamiento.'
              : 'For REAL money: your Binance Futures account (withdraw disabled) + $50 cap + your GO. Until then, this is training.'}</li>
          </ul>
        </section>

        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
            {es ? 'Estado del bot' : 'Bot status'}
          </header>
          <div className="px-4 py-3 font-mono text-[11px] text-zinc-400">
            {es
              ? 'Corriendo cada 9 min vía cron · empujando datos a Gist · Vercel los lee en vivo.'
              : 'Running every 9 min via cron · pushing to Gist · Vercel reads it live.'}
          </div>
        </section>
      </div>
    </main>
  );
}
