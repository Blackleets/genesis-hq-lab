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
import { computeAccruedFeeUsd, netAfterFeeUsd, feeRateLabel, TREASURY_WALLET_SOL } from '@services/feePolicy';
import { isCommunityOptIn, setCommunityOptIn, fetchCommunitySummary, type CommunitySummary } from '@services/communityLearning';

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

// Equity curve — single series, so the title names it (no legend). 2px line,
// recessive dashed reference at start capital, crosshair+tooltip on hover,
// text in text tokens (never the series color).
function EquityCurve({ curve, startCapital }: { curve: number[]; startCapital: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (curve.length < 2) return null;

  const W = 640, H = 120, PAD = 6;
  const min = Math.min(...curve, startCapital);
  const max = Math.max(...curve, startCapital);
  const span = max - min || 1;
  const x = (i: number) => PAD + (i / (curve.length - 1)) * (W - PAD * 2);
  const y = (v: number) => PAD + (1 - (v - min) / span) * (H - PAD * 2);
  const path = curve.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const last = curve[curve.length - 1];
  const up = last >= startCapital;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PAD) / (W - PAD * 2)) * (curve.length - 1));
    setHover(Math.max(0, Math.min(curve.length - 1, i)));
  };

  return (
    <div className="bg-[#0d111a] border border-zinc-800 px-3 py-3">
      <div className="flex items-baseline justify-between mb-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
          Curva de equity (paper · neto de costos)
        </span>
        <span className="font-mono text-[10px] text-zinc-400 tabular-nums">
          {hover != null
            ? `trade ${hover} · $${curve[hover].toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            : `$${last.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[120px] cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`Curva de equity: de $${startCapital} a $${Math.round(last)} en ${curve.length - 1} trades`}
      >
        {/* reference: start capital (neutral, recessive) */}
        <line x1={PAD} x2={W - PAD} y1={y(startCapital)} y2={y(startCapital)} stroke="#3f3f46" strokeWidth="1" strokeDasharray="4 4" />
        <path d={path} fill="none" stroke={up ? '#4ea1ff' : '#ff6b81'} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD} y2={H - PAD} stroke="#52525b" strokeWidth="1" />
            <circle cx={x(hover)} cy={y(curve[hover])} r="3.5" fill={up ? '#4ea1ff' : '#ff6b81'} stroke="#0d111a" strokeWidth="2" />
          </>
        )}
      </svg>
      <div className="flex justify-between font-mono text-[9px] text-zinc-600 tabular-nums">
        <span>inicio ${startCapital.toLocaleString('en-US')}</span>
        <span>{curve.length - 1} trades · mín ${Math.round(min).toLocaleString('en-US')} · máx ${Math.round(max).toLocaleString('en-US')}</span>
      </div>
    </div>
  );
}

const FAMILY_LABEL: Record<string, string> = {
  donchian: 'BREAKOUT',
  meanRevert: 'REVERSIÓN',
  maCross: 'MOMENTUM',
};

function ConfigLabel({ e }: { e: SweepEntry }) {
  const c = e.config;
  const fam = FAMILY_LABEL[c.family ?? 'donchian'] ?? 'BREAKOUT';
  return (
    <span className="font-mono text-[11px] text-zinc-200">
      <span className="text-[#ffd24a]">{fam}</span> · {c.interval} · P{c.breakoutPeriod}/{c.regimeSmaPeriod}{c.zThr ? ` z${c.zThr}` : ''} · TP {(c.tpPct * 100).toFixed(0)}% · SL {(c.slPct * 100).toFixed(0)}%
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
  const [community, setCommunity] = useState<CommunitySummary | null>(null);
  const [optIn, setOptIn] = useState(() => isCommunityOptIn());

  useEffect(() => {
    let disposed = false;
    fetchCommunitySummary().then((s) => { if (!disposed) setCommunity(s); });
    return () => { disposed = true; };
  }, []);

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
              const fam = FAMILY_LABEL[cfg.family ?? 'donchian'] ?? 'BREAKOUT';
              return `${fam} · Config ${cfg.source === 'sweep-oos' ? '⚡ adoptada del sweep (validada OOS)' : 'por defecto'} · ${cfg.interval} · P${cfg.breakoutPeriod}/${cfg.regimeSmaPeriod}${cfg.zThr ? ` z${cfg.zThr}` : ''} · TP ${(cfg.tpPct * 100).toFixed(0)}% · SL ${(cfg.slPct * 100).toFixed(0)}% · BTC ETH SOL BNB${lastRun ? ` · corrido ${lastRun}` : ''}`;
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

          {/* Live regime — which market TODAY is, and which family it favors */}
          {snap?.regime && (
            <div className="flex items-center gap-3 flex-wrap border border-zinc-800 bg-[#0d111a] px-4 py-2">
              <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">Régimen actual</span>
              <span className={`font-mono text-[11px] font-bold px-2 py-0.5 border ${snap.regime.kind === 'TENDENCIA' ? 'border-[#4ea1ff66] text-[#4ea1ff] bg-[#4ea1ff0d]' : 'border-[#ffd24a66] text-[#ffd24a] bg-[#ffd24a0d]'}`}>
                {snap.regime.kind}
              </span>
              <span className="font-mono text-[11px] text-zinc-300">VOL {snap.regime.vol}</span>
              <span className="font-mono text-[10px] text-zinc-500 tabular-nums">ER {snap.regime.er} · vol×{snap.regime.volRatio}</span>
              <span className="font-mono text-[10px] text-zinc-400 ml-auto">
                favorece: {snap.regime.favored.map((f) => FAMILY_LABEL[f] ?? f).join(' · ')}
              </span>
            </div>
          )}

          {/* Forward champion — measured ONLY on candles born after adoption */}
          {snap?.forward && (
            <div className="border border-[#00ff9c33] bg-[#00ff9c08] px-4 py-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#00ff9c]">
                  Campeón en vivo · forward
                </span>
                <span className="font-mono text-[10px] text-zinc-500">
                  desde {new Date(snap.forward.sinceIso).toLocaleString()} · solo velas posteriores a la adopción — cero sesgo de backtest
                </span>
              </div>
              <div className="flex items-center gap-5 flex-wrap mt-1 font-mono text-[12px] tabular-nums">
                {snap.forward.trades > 0 ? (
                  <>
                    <span className="text-zinc-200">{snap.forward.trades} trades</span>
                    <span className="text-zinc-200">WR {(snap.forward.winRate * 100).toFixed(0)}%</span>
                    <span className={snap.forward.pnlUsd >= 0 ? 'text-[#00ff9c] font-bold' : 'text-[#ff6b81] font-bold'}>
                      {snap.forward.pnlUsd >= 0 ? '+' : '-'}${Math.abs(snap.forward.pnlUsd).toFixed(0)}
                    </span>
                    <span className="text-zinc-400">exp {snap.forward.expectancyPct >= 0 ? '+' : ''}{snap.forward.expectancyPct.toFixed(3)}%/trade</span>
                  </>
                ) : (
                  <span className="text-zinc-500">esperando velas nuevas — el campeón se mide con mercado que aún no existía al adoptarlo</span>
                )}
              </div>
            </div>
          )}

          {/* Equity curve — the desk's first look */}
          {sc.equityCurve && sc.equityCurve.length > 1 && (
            <EquityCurve curve={sc.equityCurve} startCapital={PAPER_CAPITAL_USD} />
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
            <StatTile label="Expectativa %" value={`${sc.expectancyPct >= 0 ? '+' : ''}${sc.expectancyPct.toFixed(3)}%`} sub="neto de costos 0.10%" />
            <StatTile label="PnL acumulado" value={`${sc.totalPnlPct >= 0 ? '+' : ''}${sc.totalPnlPct.toFixed(1)}%`} sub="paper · neto" />
          </div>

          {/* Transparent fee + community learning — the business model in the open */}
          {typeof sc.pnlUsd === 'number' && (
            <div className="border border-zinc-800 bg-[#0d111a] px-4 py-3 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  Términos transparentes
                </span>
                <span className="font-mono text-[11px] text-zinc-300 tabular-nums">
                  Comisión de desempeño {feeRateLabel()} sobre ganancia neta:{' '}
                  <span className="text-[#ffd24a] font-bold">${computeAccruedFeeUsd(sc.pnlUsd).toFixed(2)}</span>
                  {' '}devengada (paper) · te quedarías con{' '}
                  <span className="text-zinc-100 font-bold">${netAfterFeeUsd(sc.pnlUsd).toFixed(2)}</span>
                </span>
              </div>
              <div className="font-mono text-[10px] text-zinc-500">
                Sin ganancia no hay comisión. En ejecución real se liquida en el settlement del trade —
                jamás desde tu wallet conectada (solo lectura, siempre).
                {TREASURY_WALLET_SOL
                  ? ` Tesorería: ${TREASURY_WALLET_SOL.slice(0, 4)}…${TREASURY_WALLET_SOL.slice(-4)} (pública, verificable).`
                  : ' Tesorería sin configurar — solo display.'}
              </div>
              <div className="flex items-center gap-3 flex-wrap border-t border-zinc-800 pt-2">
                <label className="flex items-center gap-2 cursor-pointer font-mono text-[11px] text-zinc-300">
                  <input
                    type="checkbox"
                    checked={optIn}
                    onChange={(e) => { setOptIn(e.target.checked); setCommunityOptIn(e.target.checked); }}
                    className="accent-[#00ff9c]"
                  />
                  Compartir aprendizaje anónimo (solo métricas de estrategia — nunca tu wallet)
                </label>
                {community && community.contributions > 0 && (
                  <span className="font-mono text-[10px] text-zinc-500 ml-auto tabular-nums">
                    red: {community.contributions} aportes ·{' '}
                    {Object.entries(community.byFamily)
                      .map(([f, v]) => `${f} WR ${(v.avgWinRate * 100).toFixed(0)}%`)
                      .join(' · ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Monte Carlo — the unlucky tail, not just the realized path */}
          {sc.mc && (
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Peor caso PnL (MC p5)"
                value={`${sc.mc.p5PnlUsd >= 0 ? '+' : '-'}$${Math.abs(sc.mc.p5PnlUsd).toFixed(0)}`}
                sub="bootstrap 500 iteraciones"
              />
              <StatTile
                label="Peor drawdown (MC p95)"
                value={`${sc.mc.p95DrawdownPct.toFixed(1)}%`}
                sub="remuestreo de la secuencia"
              />
            </div>
          )}

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
                  ⚡ Optimización fuerza bruta · 3 familias
                </div>
                <div className="text-[10px] text-zinc-500 mt-0.5">
                  ~360 configs (breakout · reversión a la media · momentum × 1h/4h) sobre 1000
                  velas reales por par. Selección in-sample, veredicto SOLO out-of-sample +
                  consistencia temporal.
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
