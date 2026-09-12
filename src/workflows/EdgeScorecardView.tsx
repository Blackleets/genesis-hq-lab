// EdgeScorecardView — evidence surface for capital readiness.
// Internal research verdicts stay exact in data; the UI renders calm, human-readable states.

import { useEffect, useState, useCallback } from 'react';
import { agentClient, type EdgeScorecard, type CryptoEdgeScorecard } from '@services/agentClient';
import { useLanguage } from '@core/i18n/languageStore';
import LocalEdgeScorecard from '@workflows/LocalEdgeScorecard';

const POLL_MS = 30_000;

function VerdictBadge({ verdict }: { verdict: EdgeScorecard['verdict'] }) {
  const colors = {
    GO:                'border-green-400/60 text-green-300 bg-green-400/10',
    NO_GO:             'border-amber-400/50 text-amber-300 bg-amber-400/8',
    INSUFFICIENT_DATA: 'border-zinc-600 text-zinc-300 bg-zinc-800/40',
  };
  const labels = {
    GO:                'VALIDATED — evidence threshold met',
    NO_GO:             'OBSERVING — edge not confirmed',
    INSUFFICIENT_DATA: 'COLLECTING DATA',
  };
  return (
    <div className={`inline-flex items-center gap-2 border px-4 py-2 font-mono text-sm font-bold uppercase tracking-widest ${colors[verdict]}`}>
      <span className="text-lg">{verdict === 'GO' ? '✓' : verdict === 'NO_GO' ? '•' : '…'}</span>
      {labels[verdict]}
    </div>
  );
}

function CheckRow({ label, pass, value, threshold }: { label: string; pass: boolean; value: number | null; threshold: number }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-zinc-800 last:border-0">
      <span className={`text-lg font-mono ${pass ? 'text-green-400' : 'text-amber-400'}`}>{pass ? '✓' : '•'}</span>
      <span className="flex-1 font-mono text-[12px] text-zinc-300">{label}</span>
      {value != null && (
        <span className={`font-mono text-[11px] tabular-nums ${pass ? 'text-green-400' : 'text-amber-300'}`}>
          {value} {!pass && threshold != null ? `(target ${threshold})` : ''}
        </span>
      )}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-[#0d111a] border border-zinc-800 px-3 py-3">
      <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className="font-mono text-xl font-bold text-zinc-100 mt-1">{value}</div>
      {sub && <div className="font-mono text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function CryptoScorecard({ crypto, lang }: { crypto: CryptoEdgeScorecard; lang: string }) {
  const es = lang === 'es';
  const checkEntries = Object.entries(crypto.checks) as Array<[string, { pass: boolean; value: number | null; threshold: number; label: string }]>;
  return (
    <div className="border border-[#f7931a44] bg-[#f7931a08] px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-[#f7931a]">{es ? 'Motor Crypto · segundo plano' : 'Crypto Engine · background'}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">{es ? 'fuente' : 'source'}: {crypto.source}</div>
        </div>
        <VerdictBadge verdict={crypto.verdict} />
      </div>

      {crypto.nextMilestone && (
        <div className="border border-zinc-700 bg-zinc-900/50 px-4 py-2 text-zinc-400 text-[12px]">{crypto.nextMilestone}</div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={es ? 'Expectativa/trade' : 'Expectancy/trade'} value={crypto.expectancy != null ? `$${crypto.expectancy.toFixed(3)}` : '—'} />
        <StatTile label="Win rate" value={`${(crypto.winRate * 100).toFixed(1)}%`} />
        <StatTile label="Profit factor" value={crypto.profitFactor != null ? crypto.profitFactor.toFixed(2) : '—'} />
        <StatTile label={es ? 'Max drawdown' : 'Max drawdown'} value={crypto.maxDrawdown != null ? `${(crypto.maxDrawdown * 100).toFixed(1)}%` : '—'} />
      </div>

      {checkEntries.length > 0 && (
        <div className="bg-[#0d111a] border border-zinc-800 px-4 py-1">
          {checkEntries.map(([key, check]) => (
            <CheckRow key={key} label={check.label} pass={check.pass} value={check.value} threshold={check.threshold} />
          ))}
        </div>
      )}

      {crypto.verdict === 'NO_GO' && (
        <div className="border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-[12px] text-amber-200">
          {es
            ? 'En observación. La señal direccional todavía no demuestra rentabilidad fuera de muestra después de costos; continúa acumulando evidencia en segundo plano.'
            : 'Observing. The directional signal has not yet proven out-of-sample profitability after costs; it continues collecting evidence in the background.'}
        </div>
      )}
      {crypto.verdict === 'GO' && (
        <div className="border border-green-400/40 bg-green-400/5 px-4 py-3 text-green-300 text-[12px]">
          ✓ {es ? 'Edge validado out-of-sample. Aún requiere aprobación humana antes de cualquier capital real.' : 'Edge validated out-of-sample. Human approval is still required before any real capital.'}
        </div>
      )}
    </div>
  );
}

export default function EdgeScorecardView() {
  const lang = useLanguage();
  const [data, setData] = useState<EdgeScorecard | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showDirectional, setShowDirectional] = useState(false);

  const load = useCallback(async () => {
    const result = await agentClient.getEdgeScorecard();
    if (result) {
      setData(result);
      setLastSync(new Date().toLocaleTimeString());
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const checks = data?.checks ?? {};
  const checkEntries = Object.entries(checks) as Array<[string, { pass: boolean; value: number | null; threshold: number; label: string }]>;

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-6 font-mono">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">
            {lang === 'es' ? 'Evidencia de Edge · Preparación de capital' : 'Edge Evidence · Capital Readiness'}
          </h1>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xl">
            {lang === 'es'
              ? 'La evidencia puede validar una estrategia, pero nunca activa dinero real desde esta pantalla. LIVE_OFF permanece bloqueado hasta aprobación humana explícita.'
              : 'Evidence may validate a strategy, but this screen never activates real money. LIVE_OFF remains locked until explicit human approval.'}
          </p>
        </div>
        {lastSync && <span className="text-[10px] text-zinc-600 shrink-0">sync {lastSync}</span>}
      </div>

      <section className="border border-zinc-800 bg-[#0b0f16]">
        <button
          type="button"
          onClick={() => setShowDirectional((visible) => !visible)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
          aria-expanded={showDirectional}
        >
          <span>
            <span className="block text-[10px] uppercase tracking-[0.2em] text-zinc-400">
              {lang === 'es' ? 'Investigación direccional · segundo plano' : 'Directional research · background'}
            </span>
            <span className="block text-[10px] text-zinc-600 mt-0.5">
              {lang === 'es' ? 'V9 y búsqueda local siguen separados del foco de arbitraje.' : 'V9 and local research remain separate from the arbitrage focus.'}
            </span>
          </span>
          <span className="text-zinc-500 text-sm">{showDirectional ? '−' : '+'}</span>
        </button>
        {showDirectional && <div className="border-t border-zinc-800"><LocalEdgeScorecard /></div>}
      </section>

      {loading ? (
        <div className="text-zinc-500 text-sm">
          {lang === 'es' ? 'Cargando...' : 'Loading...'}
        </div>
      ) : !data ? (
        <div className="border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-amber-300 text-[12px]">
          {lang === 'es'
            ? 'Backend hosted offline — la investigación direccional permanece aislada.'
            : 'Hosted backend offline — directional research remains isolated.'}
        </div>
      ) : (
        <>
          {data.crypto && <CryptoScorecard crypto={data.crypto} lang={lang} />}

          <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 pt-2">
            {lang === 'es' ? 'Mercados de Predicción (Polymarket/Kalshi)' : 'Prediction Markets (Polymarket/Kalshi)'}
          </div>
          <div><VerdictBadge verdict={data.verdict} /></div>

          {data.nextMilestone && (
            <div className="border border-zinc-700 bg-zinc-900/50 px-4 py-2 text-zinc-400 text-[12px]">
              {data.nextMilestone}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label={lang === 'es' ? 'Trades cerrados' : 'Closed trades'} value={String(data.totalClosed)} />
            <StatTile label="Win rate" value={`${(data.winRate * 100).toFixed(1)}%`} />
            <StatTile label="ROI neto" value={`${data.roi > 0 ? '+' : ''}${data.roi.toFixed(2)}%`} />
            <StatTile label="PnL total" value={`$${data.totalPnl.toFixed(2)}`} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile
              label="Brier score"
              value={data.brierScore != null ? data.brierScore.toFixed(3) : '—'}
              sub={data.brierLabel}
            />
            <StatTile
              label="Sharpe ratio"
              value={data.sharpeRatio != null ? data.sharpeRatio.toFixed(2) : '—'}
              sub={data.sharpeLabel}
            />
            <StatTile
              label={lang === 'es' ? 'Gap calibración' : 'Calibration gap'}
              value={data.calibrationGap != null ? data.calibrationGap.toFixed(3) : '—'}
              sub={data.calibrationGap != null && data.calibrationGap < 0.10 ? '✓ calibrated' : '• needs evidence'}
            />
          </div>

          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
              {lang === 'es' ? 'Condiciones de validación' : 'Validation conditions'}
            </div>
            <div className="bg-[#0d111a] border border-zinc-800 px-4 py-1">
              {checkEntries.map(([key, check]) => (
                <CheckRow
                  key={key}
                  label={check.label}
                  pass={check.pass}
                  value={check.value}
                  threshold={check.threshold}
                />
              ))}
            </div>
          </div>

          {data.failingChecks.length > 0 && data.verdict === 'NO_GO' && (
            <div className="border border-amber-400/30 bg-amber-400/5 px-4 py-3 space-y-1">
              <div className="text-[9px] uppercase tracking-[0.2em] text-amber-300 mb-2">
                {lang === 'es' ? 'Brechas de evidencia' : 'Evidence gaps'}
              </div>
              {data.failingChecks.map((fc) => (
                <div key={fc.key} className="text-[12px] text-amber-200">
                  • {fc.label} — actual: {fc.value ?? 'n/a'}, target: {fc.threshold}
                </div>
              ))}
            </div>
          )}

          {data.verdict === 'GO' && (
            <div className="border border-green-400/40 bg-green-400/5 px-4 py-3 text-green-300 text-[12px]">
              ✓ {lang === 'es'
                ? 'Evidencia validada. LIVE_OFF / paper siguen; capital real solo con aprobación humana explícita.'
                : 'Evidence validated. LIVE_OFF / paper remain; real capital still requires explicit human approval.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
