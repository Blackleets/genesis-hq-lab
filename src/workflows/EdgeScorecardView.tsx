// EdgeScorecardView — the single screen that answers "are we ready for real money?"
// Polls /api/trading/edge-scorecard and renders a clear GO / NO-GO / INSUFFICIENT_DATA
// verdict with the checks that are passing and failing.

import { useEffect, useState, useCallback } from 'react';
import { agentClient, type EdgeScorecard, type CryptoEdgeScorecard } from '@services/agentClient';
import { useLanguage } from '@core/i18n/languageStore';

const POLL_MS = 30_000;

function VerdictBadge({ verdict }: { verdict: EdgeScorecard['verdict'] }) {
  const colors = {
    GO:                'border-green-400/60 text-green-300 bg-green-400/10',
    NO_GO:             'border-red-400/60 text-red-300 bg-red-400/10',
    INSUFFICIENT_DATA: 'border-amber-400/60 text-amber-300 bg-amber-400/10',
  };
  const labels = {
    GO:                'GO — listo para capital real',
    NO_GO:             'NO-GO — edge no probado',
    INSUFFICIENT_DATA: 'DATOS INSUFICIENTES',
  };
  return (
    <div className={`inline-flex items-center gap-2 border px-4 py-2 font-mono text-sm font-bold uppercase tracking-widest ${colors[verdict]}`}>
      <span className="text-lg">{verdict === 'GO' ? '✓' : verdict === 'NO_GO' ? '✗' : '⏳'}</span>
      {labels[verdict]}
    </div>
  );
}

function CheckRow({ label, pass, value, threshold }: { label: string; pass: boolean; value: number | null; threshold: number }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-zinc-800 last:border-0">
      <span className={`text-lg font-mono ${pass ? 'text-green-400' : 'text-red-400'}`}>{pass ? '✓' : '✗'}</span>
      <span className="flex-1 font-mono text-[12px] text-zinc-300">{label}</span>
      {value != null && (
        <span className={`font-mono text-[11px] tabular-nums ${pass ? 'text-green-400' : 'text-red-400'}`}>
          {value} {!pass && threshold != null ? `(need ${threshold})` : ''}
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
          <div className="text-[9px] uppercase tracking-[0.2em] text-[#f7931a]">{es ? 'Motor Crypto · activo' : 'Crypto Engine · active'}</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">{es ? 'fuente' : 'source'}: {crypto.source}</div>
        </div>
        <VerdictBadge verdict={crypto.verdict} />
      </div>

      {crypto.nextMilestone && (
        <div className="border border-zinc-700 bg-zinc-900/50 px-4 py-2 text-zinc-400 text-[12px]">⏳ {crypto.nextMilestone}</div>
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
        <div className="border border-red-400/30 bg-red-400/5 px-4 py-3 text-[12px] text-red-300">
          {es
            ? 'El edge aún no está probado. La señal actual no es rentable tras costos fuera de muestra — el optimizador sigue buscando una config válida antes de arriesgar capital.'
            : 'Edge not proven yet. The current signal is unprofitable after costs out-of-sample — the optimizer keeps searching for a valid config before risking capital.'}
        </div>
      )}
      {crypto.verdict === 'GO' && (
        <div className="border border-green-400/40 bg-green-400/5 px-4 py-3 text-green-300 text-[12px]">
          ✓ {es ? 'Edge validado out-of-sample. Listo para evaluar capital real en crypto.' : 'Edge validated out-of-sample. Ready to consider real crypto capital.'}
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
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-zinc-100">
            {lang === 'es' ? 'Edge Scorecard — ¿Listo para dinero real?' : 'Edge Scorecard — Ready for Real Money?'}
          </h1>
          <p className="text-[11px] text-zinc-500 mt-1 max-w-xl">
            {lang === 'es'
              ? 'Todos los checks deben pasar (y 50+ trades resueltos) para que el veredicto sea GO. Solo entonces activa REAL_TRADING=1.'
              : 'All checks must pass (and 50+ trades resolved) for the verdict to be GO. Only then flip REAL_TRADING=1.'}
          </p>
        </div>
        {lastSync && <span className="text-[10px] text-zinc-600 shrink-0">sync {lastSync}</span>}
      </div>

      {/* Verdict */}
      {loading ? (
        <div className="text-zinc-500 text-sm">
          {lang === 'es' ? 'Cargando...' : 'Loading...'}
        </div>
      ) : !data ? (
        <div className="border border-amber-400/40 bg-amber-400/5 px-4 py-3 text-amber-300 text-sm">
          {lang === 'es' ? 'Backend no disponible — arranca el servidor.' : 'Backend unavailable — start the server.'}
        </div>
      ) : (
        <>
          {/* Crypto engine — the currently active strategy */}
          {data.crypto && <CryptoScorecard crypto={data.crypto} lang={lang} />}

          {/* Prediction market engine */}
          <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 pt-2">
            {lang === 'es' ? 'Mercados de Predicción (Polymarket/Kalshi)' : 'Prediction Markets (Polymarket/Kalshi)'}
          </div>
          <div><VerdictBadge verdict={data.verdict} /></div>

          {data.nextMilestone && (
            <div className="border border-zinc-700 bg-zinc-900/50 px-4 py-2 text-zinc-400 text-[12px]">
              ⏳ {data.nextMilestone}
            </div>
          )}

          {/* Stats grid */}
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
              sub={data.calibrationGap != null && data.calibrationGap < 0.10 ? '✓ bien calibrado' : '✗ sobre-confiado'}
            />
          </div>

          {/* Checks */}
          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
              {lang === 'es' ? 'Condiciones GO' : 'GO conditions'}
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

          {/* Failing checks summary */}
          {data.failingChecks.length > 0 && data.verdict === 'NO_GO' && (
            <div className="border border-red-400/30 bg-red-400/5 px-4 py-3 space-y-1">
              <div className="text-[9px] uppercase tracking-[0.2em] text-red-400 mb-2">
                {lang === 'es' ? 'Qué falta para GO' : 'What needs to improve for GO'}
              </div>
              {data.failingChecks.map((fc) => (
                <div key={fc.key} className="text-[12px] text-red-300">
                  ✗ {fc.label} — actual: {fc.value ?? 'n/a'}, need: {fc.threshold}
                </div>
              ))}
            </div>
          )}

          {data.verdict === 'GO' && (
            <div className="border border-green-400/40 bg-green-400/5 px-4 py-3 text-green-300 text-[12px]">
              ✓ {lang === 'es'
                ? 'Todos los checks pasan. Activa REAL_TRADING=1 en .env y reinicia el servidor. Empieza con capital mínimo.'
                : 'All checks pass. Set REAL_TRADING=1 in .env and restart the server. Start with minimum capital.'}
            </div>
          )}
        </>
      )}
    </div>
  );
}
