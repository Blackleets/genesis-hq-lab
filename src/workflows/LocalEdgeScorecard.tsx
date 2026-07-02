// LocalEdgeScorecard — the "ready for real money?" verdict computed entirely
// in-browser from real Binance data, for when the backend is offline.
//
// It runs the same readiness gates the backend Edge Scorecard uses (sample
// size, win rate, profit factor, expectancy, Sharpe, drawdown) over a live
// Donchian-breakout backtest. Nothing here places an order — it only measures
// whether the strategy has a proven edge yet. Real capital stays a manual,
// human decision behind a GO verdict.

import { useEffect, useState, useCallback } from 'react';
import {
  runLocalLearning,
  runBruteForceSweep,
  getActiveConfig,
  SWEEP_KEY,
  PAPER_CAPITAL_USD,
  NOTIONAL_PER_TRADE_USD,
  type LocalLearningSnapshot,
  type SweepResult,
  type SweepEntry,
} from '@services/localLearningEngine';
import { readLastLearningSnapshot } from '@hooks/useLearningSync';

function readLastSweep(): SweepResult | null {
  try {
    const raw = localStorage.getItem(SWEEP_KEY);
    return raw ? (JSON.parse(raw) as SweepResult) : null;
  } catch {
    return null;
  }
}

const REFRESH_MS = 5 * 60_000;

function VerdictBadge({ verdict }: { verdict: 'GO' | 'NO_GO' | 'INSUFFICIENT_DATA' }) {
  const colors = {
    GO:                'border-green-400/60 text-green-300 bg-green-400/10',
    NO_GO:             'border-red-400/60 text-red-300 bg-red-400/10',
    INSUFFICIENT_DATA: 'border-amber-400/60 text-amber-300 bg-amber-400/10',
  };
  const labels = {
    GO:                'GO — edge validado, listo para evaluar capital real',
    NO_GO:             'NO-GO — edge no probado aún',
    INSUFFICIENT_DATA: 'DATOS INSUFICIENTES',
  };
  return (
    <div className={`inline-flex items-center gap-2 border px-4 py-2 font-mono text-sm font-bold uppercase tracking-widest ${colors[verdict]}`}>
      <span className="text-lg">{verdict === 'GO' ? '✓' : verdict === 'NO_GO' ? '✗' : '⏳'}</span>
      {labels[verdict]}
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

function CheckRow({ label, pass, value, threshold }: { label: string; pass: boolean; value: number | null; threshold: number }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-zinc-800 last:border-0">
      <span className={`text-lg font-mono ${pass ? 'text-green-400' : 'text-red-400'}`}>{pass ? '✓' : '✗'}</span>
      <span className="flex-1 font-mono text-[12px] text-zinc-300">{label}</span>
      {value != null && (
        <span className={`font-mono text-[11px] tabular-nums ${pass ? 'text-green-400' : 'text-red-400'}`}>
          {value}{!pass ? ` (need ${threshold})` : ''}
        </span>
      )}
    </div>
  );
}

function ConfigLabel({ e }: { e: SweepEntry }) {
  const c = e.config;
  return (
    <span className="font-mono text-[11px] text-zinc-200">
      {c.interval} · D{c.breakoutPeriod} · SMA{c.regimeSmaPeriod} · TP {(c.tpPct * 100).toFixed(0)}% · SL {(c.slPct * 100).toFixed(0)}%
    </span>
  );
}

function SliceCells({ s }: { s: SweepEntry['test'] }) {
  const good = s.expectancyPct > 0;
  return (
    <span className={`font-mono text-[10px] tabular-nums ${good ? 'text-green-400' : 'text-red-400'}`}>
      exp {s.expectancyPct >= 0 ? '+' : ''}{s.expectancyPct.toFixed(3)}% · PF {s.profitFactor.toFixed(2)} · WR {(s.winRate * 100).toFixed(0)}% · {s.trades}t
    </span>
  );
}

export default function LocalEdgeScorecard() {
  const [snap, setSnap] = useState<LocalLearningSnapshot | null>(() => readLastLearningSnapshot());
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [sweep, setSweep] = useState<SweepResult | null>(() => readLastSweep());
  const [sweeping, setSweeping] = useState(false);

  const run = useCallback(async () => {
    setRunning(true);
    try {
      const s = await runLocalLearning();
      if (s.ok) {
        setSnap(s);
        setLastRun(new Date().toLocaleTimeString());
      }
    } finally {
      setRunning(false);
    }
  }, []);

  const runSweep = useCallback(async () => {
    setSweeping(true);
    try {
      const r = await runBruteForceSweep();
      setSweep(r);
      try { localStorage.setItem(SWEEP_KEY, JSON.stringify(r)); } catch { /* non-fatal */ }
      // Sweep feeds loop: re-run the scorecard immediately with whatever
      // config just won OOS, so the GO gates always judge the best weapon.
      await run();
    } finally {
      setSweeping(false);
    }
  }, [run]);

  useEffect(() => {
    // Defer the first run out of the effect body so no setState fires
    // synchronously during render commit.
    const first = setTimeout(run, 0);
    const id = setInterval(run, REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [run]);

  const sc = snap?.scorecard;

  return (
    <div className="border border-[#4ea1ff44] bg-[#4ea1ff08] px-4 py-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-[#4ea1ff]">
            Motor local · backtest en vivo (Binance, sin backend)
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {(() => {
              const cfg = getActiveConfig();
              return `Config ${cfg.source === 'sweep-oos' ? '⚡ adoptada del sweep (validada OOS)' : 'por defecto'} · ${cfg.interval} · D${cfg.breakoutPeriod} · SMA${cfg.regimeSmaPeriod} · TP ${(cfg.tpPct * 100).toFixed(0)}% · SL ${(cfg.slPct * 100).toFixed(0)}% · BTC ETH SOL BNB${lastRun ? ` · corrido ${lastRun}` : ''}`;
            })()}
          </div>
        </div>
        {sc && <VerdictBadge verdict={sc.verdict} />}
      </div>

      {!sc ? (
        <div className="text-zinc-500 text-sm">
          {running ? 'Corriendo backtest con datos reales de Binance…' : 'Sin datos aún.'}
        </div>
      ) : (
        <>
          {sc.nextMilestone && (
            <div className="border border-zinc-700 bg-zinc-900/50 px-4 py-2 text-zinc-400 text-[12px]">
              ⏳ {sc.nextMilestone}
            </div>
          )}

          {/* Money row — desk sizing so PnL reads in dollars, not cents */}
          {typeof sc.pnlUsd === 'number' && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Equity (paper)"
                value={`$${sc.equityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
                sub={`inicio $${PAPER_CAPITAL_USD.toLocaleString('en-US')}`}
              />
              <StatTile
                label="PnL total"
                value={`${sc.pnlUsd >= 0 ? '+' : '-'}$${Math.abs(sc.pnlUsd).toFixed(0)}`}
                sub={`nocional $${NOTIONAL_PER_TRADE_USD.toLocaleString('en-US')}/trade`}
              />
              <StatTile label="Ganancia media" value={`+$${sc.avgWinUsd.toFixed(0)}`} sub="por trade ganador" />
              <StatTile
                label="Expectativa"
                value={`${sc.expectancyUsd >= 0 ? '+' : '-'}$${Math.abs(sc.expectancyUsd).toFixed(1)}`}
                sub="por trade"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Win rate" value={`${(sc.winRate * 100).toFixed(1)}%`} />
            <StatTile label="Profit factor" value={sc.profitFactor.toFixed(2)} />
            <StatTile label="Sharpe/trade" value={sc.sharpe.toFixed(2)} />
            <StatTile label="Max drawdown" value={`${sc.maxDrawdownPct.toFixed(1)}%`} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Trades (muestra)" value={String(sc.trades)} />
            <StatTile label="Expectativa %" value={`${sc.expectancyPct >= 0 ? '+' : ''}${sc.expectancyPct.toFixed(3)}%`} />
            <StatTile label="PnL acumulado" value={`${sc.totalPnlPct >= 0 ? '+' : ''}${sc.totalPnlPct.toFixed(1)}%`} sub="paper" />
          </div>

          <div>
            <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
              Condiciones para capital real (todas deben pasar)
            </div>
            <div className="bg-[#0d111a] border border-zinc-800 px-4 py-1">
              {sc.checks.map((c) => (
                <CheckRow key={c.key} label={c.label} pass={c.pass} value={c.value} threshold={c.threshold} />
              ))}
            </div>
          </div>

          {sc.verdict === 'NO_GO' && (
            <div className="border border-red-400/30 bg-red-400/5 px-4 py-3 text-[12px] text-red-300">
              El edge aún no está probado sobre datos reales. El sistema NO está listo para
              dinero real hasta que todos los checks pasen. Sigue aprendiendo — cada backtest
              recalcula estas métricas con precios frescos.
            </div>
          )}
          {sc.verdict === 'GO' && (
            <div className="border border-green-400/40 bg-green-400/5 px-4 py-3 text-green-300 text-[12px]">
              ✓ Edge validado sobre datos reales out-of-sample. El sistema está preparado para
              evaluar capital real — con supervisión humana y empezando por el mínimo. Activarlo
              es una decisión manual, no automática.
            </div>
          )}

          {/* Brute-force optimizer — sweep the config grid, judge out-of-sample */}
          <div className="border-t border-zinc-800 pt-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[9px] uppercase tracking-[0.2em] text-[#ffd24a]">
                  ⚡ Optimización fuerza bruta
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  288 configs (Donchian × SMA × TP × SL × 1h/4h) sobre 1000 velas reales por par.
                  Selección in-sample, veredicto SOLO out-of-sample.
                </div>
              </div>
              <button
                onClick={runSweep}
                disabled={sweeping}
                className="shrink-0 font-mono text-[11px] px-3 py-2 border border-[#ffd24a66] text-[#ffd24a] bg-[#ffd24a0d] hover:bg-[#ffd24a1a] disabled:opacity-50 disabled:cursor-wait"
              >
                {sweeping ? 'Barriendo…' : 'Buscar edge'}
              </button>
            </div>

            {sweep?.ok && sweep.best && (
              <>
                <div className="bg-[#0d111a] border border-zinc-800 px-4 py-3 space-y-2">
                  <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                    Mejor config ({sweep.tested} probadas)
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <ConfigLabel e={sweep.best} />
                  </div>
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-zinc-500">In-sample (selección)</span>
                      <SliceCells s={sweep.best.train} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-zinc-500">Out-of-sample (veredicto)</span>
                      <SliceCells s={sweep.best.test} />
                    </div>
                  </div>
                </div>

                {sweep.top.length > 1 && (
                  <div className="bg-[#0d111a] border border-zinc-800 px-4 py-2">
                    <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 mb-1">
                      Top {sweep.top.length} out-of-sample
                    </div>
                    {sweep.top.map((e, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 py-1 border-b border-zinc-800/60 last:border-0 flex-wrap">
                        <ConfigLabel e={e} />
                        <SliceCells s={e.test} />
                      </div>
                    ))}
                  </div>
                )}

                <div className={`border px-4 py-2 text-[11px] ${sweep.best.test.expectancyPct > 0 ? 'border-green-400/30 bg-green-400/5 text-green-300' : 'border-red-400/30 bg-red-400/5 text-red-300'}`}>
                  {sweep.note}
                </div>
              </>
            )}

            {sweep?.ok === false && (
              <div className="border border-amber-400/30 bg-amber-400/5 px-4 py-2 text-[11px] text-amber-300">
                {sweep.note}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
