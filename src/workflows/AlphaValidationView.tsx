// AlphaValidationView — Phase 5 Alpha Edge Validation dashboard.
// Answers instantly:
//   1. Does Genesis have edge?
//   2. Which agent wins?
//   3. What confidence level works?
//   4. What market hurts performance?
//
// Truth over optimism. No inflation. Degrades gracefully when data is sparse.

import { useState, useEffect } from 'react';
import { agentClient } from '@services/agentClient';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BandCalibration {
  band: string;
  tradeCount: number;
  expectedWinRate: number | null;
  actualWinRate: number | null;
  calibrationError: number | null;
  overconfident?: boolean;
  underconfident?: boolean;
}

interface AgentScore {
  agentId: string;
  name: string;
  role: string;
  tradeCount: number;
  wins: number;
  losses: number;
  totalPnl: number;
  winRate: number | null;
  falsePositiveRate: number | null;
  maxLossStreak: number;
  calibrationScore: number;
  agentAlphaScore: number;
  dataQuality: { sufficient: boolean; warning: string | null };
}

interface RegimeEntry {
  category: string;
  tradeCount: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number | null;
  sufficient: boolean;
}

interface ExposureEntry {
  category: string;
  seen: number;
  vetoed: number;
  open: number;
  closed: number;
}

interface AlphaReport {
  ok: boolean;
  hasEdge: boolean | null;
  verdict: string;
  verdictReason: string;
  tradeHistory: number;
  minTradesNeeded: number;
  expectancy: {
    expectancyPerTrade: number | null;
    winRate: number | null;
    lossRate: number | null;
    avgWin: number | null;
    avgLoss: number | null;
    totalPnl: number;
    tradeCount: number;
    profitFactor: number | null;
    sharpeProxy: number | null;
    dataQuality: { sufficient: boolean; warning: string | null };
  };
  calibration: {
    calibrationScore: number | null;
    bandBreakdown: BandCalibration[];
    meanAbsoluteError: number | null;
    overconfident: boolean | null;
    underconfident: boolean | null;
    dataQuality: { sufficient: boolean; warning: string | null };
  };
  agentEdge: {
    agents: AgentScore[];
    bestAgent: AgentScore | null;
    worstAgent: AgentScore | null;
    dataQuality: { sufficient: boolean };
  };
  regimes: {
    regimes: RegimeEntry[];
    strongestMarket: string | null;
    weakestMarket: string | null;
    exposureByCategory: ExposureEntry[];
    dataQuality: { warning: string | null };
  };
  decisionQuality: {
    tradeCount: number;
    goodTrades: number;
    badTrades: number;
    goodTradeRate: number | null;
    falsePositives: number;
    falsePositiveRate: number | null;
    blockedByConfidence: number;
    blockedByVeto: number;
    totalBlocked: number;
    dataQuality: { warning: string | null };
  };
}

// ── Verdict display ───────────────────────────────────────────────────────────

const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  NO_DATA:           { label: 'SIN DATOS',          color: 'text-slate-400', bg: 'bg-slate-900/30', border: 'border-slate-600' },
  INSUFFICIENT_DATA: { label: 'DATOS INSUFICIENTES', color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-700' },
  MARGINAL_EDGE:     { label: 'EDGE MARGINAL',       color: 'text-orange-400', bg: 'bg-orange-900/20', border: 'border-orange-700' },
  EDGE_CONFIRMED:    { label: 'EDGE CONFIRMADO',     color: 'text-emerald-400', bg: 'bg-emerald-900/20', border: 'border-emerald-700' },
  NO_EDGE_DETECTED:  { label: 'SIN EDGE DETECTADO',  color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-700' },
  ERROR:             { label: 'ERROR',               color: 'text-red-400', bg: 'bg-red-900/20', border: 'border-red-700' },
};

function VerdictCard({ report }: { report: AlphaReport }) {
  const cfg = VERDICT_CONFIG[report.verdict] ?? VERDICT_CONFIG.NO_DATA;
  return (
    <div className={`rounded border ${cfg.border} ${cfg.bg} p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <div className={`text-xs font-mono font-bold mb-1 ${cfg.color}`}>{cfg.label}</div>
          <p className="text-[11px] text-slate-300 leading-relaxed">{report.verdictReason}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-slate-500">Trades cerrados</div>
          <div className={`text-2xl font-mono font-bold ${cfg.color}`}>{report.tradeHistory}</div>
          <div className="text-[10px] text-slate-500">min. {report.minTradesNeeded} para significancia</div>
        </div>
      </div>
    </div>
  );
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color = 'text-slate-200' }: { label: string; value: string | null; sub?: string; color?: string }) {
  return (
    <div className="bg-carbon-200/30 rounded border border-carbon-200/20 p-3">
      <div className="text-[10px] text-slate-500 font-mono mb-1">{label}</div>
      <div className={`text-lg font-mono font-semibold ${color}`}>
        {value ?? <span className="text-slate-600 text-sm">—</span>}
      </div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Data warning ──────────────────────────────────────────────────────────────

function DataWarning({ warning }: { warning: string | null }) {
  if (!warning) return null;
  return (
    <div className="text-[10px] text-yellow-400/70 bg-yellow-900/10 border border-yellow-800/30 rounded px-2 py-1 font-mono">
      ⚠ {warning}
    </div>
  );
}

// ── Calibration table ─────────────────────────────────────────────────────────

function CalibrationTable({ bands }: { bands: BandCalibration[] }) {
  return (
    <table className="w-full text-[10px] font-mono">
      <thead>
        <tr className="text-slate-500 border-b border-carbon-200/20">
          <th className="text-left pb-1">Band</th>
          <th className="text-right pb-1">Trades</th>
          <th className="text-right pb-1">Expected WR</th>
          <th className="text-right pb-1">Actual WR</th>
          <th className="text-right pb-1">Error</th>
        </tr>
      </thead>
      <tbody>
        {bands.map(b => (
          <tr key={b.band} className="border-b border-carbon-200/10">
            <td className="py-1 text-slate-300">{b.band}</td>
            <td className="text-right text-slate-400">{b.tradeCount}</td>
            <td className="text-right text-slate-400">
              {b.expectedWinRate !== null ? `${(b.expectedWinRate * 100).toFixed(0)}%` : '—'}
            </td>
            <td className={`text-right ${b.tradeCount === 0 ? 'text-slate-600' : b.overconfident ? 'text-red-400' : b.underconfident ? 'text-cyan-400' : 'text-emerald-400'}`}>
              {b.actualWinRate !== null ? `${(b.actualWinRate * 100).toFixed(0)}%` : '—'}
            </td>
            <td className={`text-right ${b.calibrationError !== null && b.calibrationError > 0.15 ? 'text-orange-400' : 'text-slate-400'}`}>
              {b.calibrationError !== null ? `${(b.calibrationError * 100).toFixed(0)}%` : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Agent table ───────────────────────────────────────────────────────────────

function AgentTable({ agents }: { agents: AgentScore[] }) {
  return (
    <table className="w-full text-[10px] font-mono">
      <thead>
        <tr className="text-slate-500 border-b border-carbon-200/20">
          <th className="text-left pb-1">Agente</th>
          <th className="text-right pb-1">Trades</th>
          <th className="text-right pb-1">WR</th>
          <th className="text-right pb-1">PnL</th>
          <th className="text-right pb-1">FP%</th>
          <th className="text-right pb-1">Score</th>
        </tr>
      </thead>
      <tbody>
        {agents.map(a => (
          <tr key={a.agentId} className="border-b border-carbon-200/10">
            <td className="py-1">
              <div className="text-slate-200">{a.name}</div>
              {a.dataQuality.warning && (
                <div className="text-[9px] text-yellow-500/70">{a.dataQuality.warning}</div>
              )}
            </td>
            <td className="text-right text-slate-400">{a.tradeCount}</td>
            <td className="text-right text-slate-300">
              {a.winRate !== null ? `${(a.winRate * 100).toFixed(0)}%` : '—'}
            </td>
            <td className={`text-right font-semibold ${(a.totalPnl ?? 0) > 0 ? 'text-emerald-400' : a.totalPnl < 0 ? 'text-red-400' : 'text-slate-500'}`}>
              {a.tradeCount > 0 ? `$${a.totalPnl?.toFixed(2) ?? '0'}` : '—'}
            </td>
            <td className={`text-right ${a.falsePositiveRate !== null && a.falsePositiveRate > 0.3 ? 'text-red-400' : 'text-slate-400'}`}>
              {a.falsePositiveRate !== null ? `${(a.falsePositiveRate * 100).toFixed(0)}%` : '—'}
            </td>
            <td className={`text-right font-bold ${a.agentAlphaScore >= 70 ? 'text-emerald-400' : a.agentAlphaScore >= 50 ? 'text-yellow-400' : 'text-slate-400'}`}>
              {a.agentAlphaScore}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Regime table ──────────────────────────────────────────────────────────────

function RegimeTable({ regimes, exposure }: { regimes: RegimeEntry[]; exposure: ExposureEntry[] }) {
  // Merge exposure data
  const expMap: Record<string, ExposureEntry> = {};
  for (const e of exposure) expMap[e.category] = e;

  const allCats = new Set([...regimes.map(r => r.category), ...exposure.map(e => e.category)]);

  return (
    <table className="w-full text-[10px] font-mono">
      <thead>
        <tr className="text-slate-500 border-b border-carbon-200/20">
          <th className="text-left pb-1">Categoría</th>
          <th className="text-right pb-1">Visto</th>
          <th className="text-right pb-1">Vetado</th>
          <th className="text-right pb-1">Cerrado</th>
          <th className="text-right pb-1">WR</th>
          <th className="text-right pb-1">Avg PnL</th>
        </tr>
      </thead>
      <tbody>
        {[...allCats].map(cat => {
          const r = regimes.find(x => x.category === cat);
          const e = expMap[cat];
          return (
            <tr key={cat} className="border-b border-carbon-200/10">
              <td className="py-1 text-slate-300 max-w-[100px] truncate">{cat}</td>
              <td className="text-right text-slate-500">{e?.seen ?? 0}</td>
              <td className="text-right text-yellow-400/60">{e?.vetoed ?? 0}</td>
              <td className="text-right text-slate-400">{r?.tradeCount ?? 0}</td>
              <td className="text-right text-slate-400">
                {r?.winRate !== null && r?.winRate !== undefined ? `${(r.winRate * 100).toFixed(0)}%` : '—'}
              </td>
              <td className={`text-right font-semibold ${(r?.avgPnl ?? 0) > 0 ? 'text-emerald-400' : (r?.avgPnl ?? 0) < 0 ? 'text-red-400' : 'text-slate-500'}`}>
                {r?.avgPnl !== null && r?.avgPnl !== undefined ? `$${r.avgPnl.toFixed(2)}` : '—'}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export default function AlphaValidationView() {
  const [report, setReport] = useState<AlphaReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'expectancy' | 'calibration' | 'agents' | 'regimes'>('expectancy');

  useEffect(() => {
    let cancelled = false;
    const fetchReport = async () => {
      try {
        const data = await agentClient.getAlphaReport();
        if (!cancelled) {
          setReport(data as unknown as AlphaReport);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchReport();
    const id = setInterval(fetchReport, 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-carbon-300">
        <span className="text-slate-500 text-xs font-mono">Analizando edge…</span>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="h-full flex items-center justify-center bg-carbon-300">
        <span className="text-red-400 text-xs font-mono">Error: {error ?? 'No data'}</span>
      </div>
    );
  }

  const exp  = report.expectancy;
  const cal  = report.calibration;
  const aq   = report.agentEdge;
  const dq   = report.decisionQuality;

  const TABS: { key: typeof tab; label: string }[] = [
    { key: 'expectancy',  label: 'Expectativa' },
    { key: 'calibration', label: 'Calibración' },
    { key: 'agents',      label: 'Agentes' },
    { key: 'regimes',     label: 'Regímenes' },
  ];

  return (
    <div className="h-full flex flex-col bg-carbon-300 text-slate-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-carbon-200/20 shrink-0">
        <h1 className="text-sm font-mono font-semibold text-slate-100">Alpha Validation</h1>
        <p className="text-[11px] text-slate-500 mt-0.5">
          ¿Tiene Genesis edge real? Datos: {report.tradeHistory} trades cerrados
        </p>
      </div>

      {/* Verdict */}
      <div className="px-4 pt-3 pb-2 shrink-0">
        <VerdictCard report={report} />
      </div>

      {/* Key metrics row */}
      <div className="px-4 pb-3 grid grid-cols-4 gap-2 shrink-0">
        <MetricCard
          label="EV / Trade"
          value={exp.expectancyPerTrade !== null ? `$${exp.expectancyPerTrade.toFixed(2)}` : null}
          color={exp.expectancyPerTrade !== null ? (exp.expectancyPerTrade > 0 ? 'text-emerald-400' : 'text-red-400') : 'text-slate-500'}
          sub={exp.dataQuality.warning ? '⚠ datos insuficientes' : undefined}
        />
        <MetricCard
          label="Win Rate"
          value={exp.winRate !== null ? `${(exp.winRate * 100).toFixed(1)}%` : null}
          color={exp.winRate !== null ? (exp.winRate > 0.55 ? 'text-emerald-400' : exp.winRate > 0.45 ? 'text-yellow-400' : 'text-red-400') : 'text-slate-500'}
        />
        <MetricCard
          label="Profit Factor"
          value={exp.profitFactor !== null ? exp.profitFactor.toFixed(2) : null}
          color={exp.profitFactor !== null ? (exp.profitFactor > 1.5 ? 'text-emerald-400' : exp.profitFactor > 1.0 ? 'text-yellow-400' : 'text-red-400') : 'text-slate-500'}
        />
        <MetricCard
          label="Calibración"
          value={cal.calibrationScore !== null ? `${cal.calibrationScore}/100` : null}
          color={cal.calibrationScore !== null ? (cal.calibrationScore >= 80 ? 'text-emerald-400' : cal.calibrationScore >= 60 ? 'text-yellow-400' : 'text-red-400') : 'text-slate-500'}
          sub={cal.overconfident ? 'sobreconfianza' : cal.underconfident ? 'subconfianza' : undefined}
        />
      </div>

      {/* Tabs */}
      <div className="px-4 flex gap-1 shrink-0 border-b border-carbon-200/20 pb-0">
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`text-[10px] font-mono px-3 py-1.5 border-b-2 ${
              tab === t.key
                ? 'border-slate-300 text-slate-100'
                : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 py-3">

        {tab === 'expectancy' && (
          <div className="space-y-4">
            <DataWarning warning={exp.dataQuality.warning} />
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Avg Win"  value={exp.avgWin !== null ? `$${exp.avgWin.toFixed(2)}` : null} color="text-emerald-400" />
              <MetricCard label="Avg Loss" value={exp.avgLoss !== null ? `$${exp.avgLoss.toFixed(2)}` : null} color="text-red-400" />
              <MetricCard label="Total PnL" value={`$${exp.totalPnl.toFixed(2)}`} color={(exp.totalPnl ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'} />
              <MetricCard label="Sharpe Proxy" value={exp.sharpeProxy !== null ? exp.sharpeProxy.toFixed(2) : null} color={exp.sharpeProxy !== null && exp.sharpeProxy > 0 ? 'text-emerald-400' : 'text-red-400'} />
            </div>

            {/* Decision quality */}
            <div>
              <div className="text-[10px] text-slate-500 font-mono mb-2 uppercase tracking-wider">Calidad de Decisiones</div>
              <DataWarning warning={dq.dataQuality.warning} />
              <div className="grid grid-cols-3 gap-2 mt-2">
                <MetricCard label="Good Trades" value={dq.tradeCount > 0 ? `${dq.goodTrades}` : null} color="text-emerald-400" sub={dq.goodTradeRate !== null ? `${(dq.goodTradeRate * 100).toFixed(0)}% del total` : undefined} />
                <MetricCard label="False Positives" value={`${dq.falsePositives}`} color={dq.falsePositives > 0 ? 'text-red-400' : 'text-slate-400'} sub={dq.falsePositiveRate !== null ? `${(dq.falsePositiveRate * 100).toFixed(0)}% de alta confianza` : undefined} />
                <MetricCard label="Bloqueados" value={`${dq.totalBlocked}`} color="text-yellow-400" sub={`veto: ${dq.blockedByVeto} · conf: ${dq.blockedByConfidence}`} />
              </div>
              <p className="text-[9px] text-slate-600 mt-2 font-mono">{dq.tradeCount > 0 ? 'False negatives (trades bloqueados que hubieran ganado) no son medibles sin datos de resolución.' : 'Sin trades cerrados — acumula historial primero.'}</p>
            </div>
          </div>
        )}

        {tab === 'calibration' && (
          <div className="space-y-4">
            <DataWarning warning={cal.dataQuality.warning} />
            {cal.bandBreakdown.length > 0 ? (
              <CalibrationTable bands={cal.bandBreakdown} />
            ) : (
              <div className="text-[11px] text-slate-500 font-mono py-8 text-center">
                Sin trades cerrados — la calibración requiere historial real.
              </div>
            )}
            {cal.meanAbsoluteError !== null && (
              <div className="text-[10px] text-slate-500 font-mono">
                Error medio absoluto: {(cal.meanAbsoluteError * 100).toFixed(1)}%
                {cal.overconfident && ' · Sistema sobreconfiado (pierde más de lo que el score sugiere)'}
                {cal.underconfident && ' · Sistema subconfiado (gana más de lo que el score sugiere)'}
              </div>
            )}
          </div>
        )}

        {tab === 'agents' && (
          <div className="space-y-4">
            <DataWarning warning={!aq.dataQuality.sufficient ? 'Datos insuficientes para ranking confiable de agentes (<10 trades por agente)' : null} />
            <AgentTable agents={aq.agents} />
            <div className="text-[9px] text-slate-600 font-mono">
              Score compuesto: PnL(25%) + WR(25%) + Drawdown(20%) + FalsePositives(15%) + Calibración(15%)
            </div>
          </div>
        )}

        {tab === 'regimes' && (
          <div className="space-y-4">
            <DataWarning warning={report.regimes.dataQuality.warning} />
            <RegimeTable
              regimes={report.regimes.regimes}
              exposure={report.regimes.exposureByCategory}
            />
            <div className="text-[9px] text-slate-600 font-mono">
              "Visto" = mercados escaneados. "Vetado" = rechazados antes de ejecutar. "Cerrado" = trades con resultado real.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
