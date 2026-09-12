import { useEffect, useMemo, useState } from 'react';
import { CircleDollarSign, Gauge, ShieldCheck, Target } from 'lucide-react';
import { fetchEdgeFactory, type EdgeFactorySnapshot } from '../../services/edgeFactoryClient';
import { fetchForwardPaper, type ForwardPaperSnapshot } from '../../services/forwardPaperClient';
import { buildEconomicScoreboard } from '../../core/economicScoreboard.mjs';
import { useRunnerTelemetry } from './useTradingDesk';
import './economicScoreboard.css';

type LoadState = 'loading' | 'ready' | 'error';

function finiteOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value: number | null | undefined, digits = 2, suffix = '') {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : '—';
}

function money(value: number | null | undefined) {
  return Number.isFinite(value) ? `$${Number(value).toFixed(2)}` : '—';
}

function verdictLabel(value: string) {
  const labels: Record<string, string> = {
    EVIDENCE_INCOMPLETE: 'EVIDENCIA INCOMPLETA',
    RESEARCH_CANDIDATES_ONLY: 'SOLO CANDIDATOS DE RESEARCH',
    FORWARD_EVIDENCE_ACCUMULATING: 'ACUMULANDO FORWARD PAPER',
    NO_EDGE_PROVEN: 'EDGE NO DEMOSTRADO',
    EDGE_PROVEN_PAPER: 'EDGE DEMOSTRADO EN PAPER',
    COST_BASIS_MISSING: 'FALTA COSTE MENSUAL',
    PNL_RECONCILIATION_REQUIRED: 'FALTA P&L RECONCILIADO',
    PNL_WINDOW_MISMATCH: 'VENTANA DE P&L NO VÁLIDA',
    EDGE_REQUIRED: 'PRIMERO DEMOSTRAR EDGE',
    NOT_SELF_FUNDING: 'AÚN NO SE PAGA SOLO',
    PAYS_FOR_ITSELF_PAPER: 'SE PAGA SOLO EN PAPER',
  };
  return labels[value] ?? value.replaceAll('_', ' ');
}

export function EconomicScoreboardPanel() {
  const { runner } = useRunnerTelemetry();
  const [edgeFactory, setEdgeFactory] = useState<EdgeFactorySnapshot | null>(null);
  const [forward, setForward] = useState<ForwardPaperSnapshot | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let active = true;
    const load = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 7000);
      try {
        const [factoryResult, forwardResult] = await Promise.allSettled([
          fetchEdgeFactory(controller.signal),
          fetchForwardPaper(controller.signal),
        ]);
        if (!active) return;
        if (factoryResult.status === 'fulfilled') setEdgeFactory(factoryResult.value);
        if (forwardResult.status === 'fulfilled') setForward(forwardResult.value);
        setState(factoryResult.status === 'fulfilled' || forwardResult.status === 'fulfilled' ? 'ready' : 'error');
      } finally {
        window.clearTimeout(timeout);
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const monthlyOperatingCostUsd = useMemo(() => {
    const configured = finiteOrNull(import.meta.env.VITE_GENESIS_MONTHLY_COST_USD);
    return configured != null && configured > 0 ? configured : null;
  }, []);

  const scoreboard = useMemo(() => buildEconomicScoreboard({
    runner,
    edgeFactory,
    forward,
    monthlyOperatingCostUsd,
    // Intentionally null until Genesis has canonical sleeve ownership + reconciliation.
    reconciledCompanyPnlUsd: null,
    reconciledCompanyPnlWindowDays: null,
  }), [runner, edgeFactory, forward, monthlyOperatingCostUsd]);

  const champion = scoreboard.bestForwardFamily;
  const edgeProven = scoreboard.edgeVerdict === 'EDGE_PROVEN_PAPER';
  const selfFunding = scoreboard.selfFundingVerdict === 'PAYS_FOR_ITSELF_PAPER';
  const checks = champion?.evaluation?.checks ?? {};
  const metrics = champion?.evaluation?.metrics ?? {};
  const runnerStats = scoreboard.paperRunner;

  return (
    <section className="economic-scoreboard" aria-label="Genesis Economic Scoreboard" data-source="EDGE FACTORY · FORWARD PAPER · RUNNER ECONOMICS">
      <header className="economic-scoreboard__header">
        <div>
          <Gauge size={16} />
          <span><strong>GENESIS ECONOMIC SCOREBOARD</strong><small>EL JUEZ: EDGE → ROBUSTEZ → COSTES → AUTOFINANCIACIÓN</small></span>
        </div>
        <strong className={edgeProven ? 'is-positive' : 'is-warning'}>
          {state === 'loading' ? 'LEYENDO EVIDENCIA' : state === 'error' ? 'EVIDENCIA NO DISPONIBLE' : verdictLabel(scoreboard.edgeVerdict)}
        </strong>
      </header>

      <div className="economic-scoreboard__verdicts">
        <article>
          <Target size={15} />
          <span><small>EDGE ECONÓMICO</small><strong>{verdictLabel(scoreboard.edgeVerdict)}</strong></span>
        </article>
        <article>
          <CircleDollarSign size={15} />
          <span><small>GENESIS PAYS FOR ITSELF</small><strong className={selfFunding ? 'is-positive' : ''}>{verdictLabel(scoreboard.selfFundingVerdict)}</strong></span>
        </article>
        <article>
          <ShieldCheck size={15} />
          <span><small>CAPITAL REAL</small><strong>LOCKED · NO ELIGIBLE</strong></span>
        </article>
      </div>

      <div className="economic-scoreboard__grid">
        <article className="economic-scoreboard__card">
          <header><strong>FORWARD CHAMPION</strong><span>{champion?.familyKey ?? 'NINGUNO'}</span></header>
          <dl>
            <div><dt>TRADES</dt><dd>{metrics.trades ?? '—'} / ≥20</dd></div>
            <div><dt>EXPECTANCY</dt><dd className={checks.expectancy ? 'is-positive' : 'is-negative'}>{fmt(metrics.expectancyBps, 2, ' bps')}</dd></div>
            <div><dt>PROFIT FACTOR</dt><dd className={checks.profitFactor ? 'is-positive' : 'is-negative'}>{fmt(metrics.profitFactor, 2)} / ≥1.20</dd></div>
            <div><dt>T-STAT</dt><dd className={checks.tStat ? 'is-positive' : 'is-negative'}>{fmt(metrics.tStat, 2)} / ≥1.00</dd></div>
            <div><dt>MAX DD</dt><dd className={checks.drawdown ? 'is-positive' : 'is-negative'}>{fmt(metrics.maxDrawdownPct, 2, '%')} / ≤12%</dd></div>
          </dl>
          <footer>{champion ? `${champion.evaluation.passed}/${champion.evaluation.required} GATES` : 'SIN CHAMPION FORWARD'}</footer>
        </article>

        <article className="economic-scoreboard__card">
          <header><strong>PAPER RUNNER</strong><span>ECONOMÍA OBSERVADA · NO COMPANY TOTAL</span></header>
          <dl>
            <div><dt>CLOSED</dt><dd>{runnerStats?.closed ?? '—'}</dd></div>
            <div><dt>REALIZED</dt><dd>{money(runnerStats?.realizedPnlUsd)}</dd></div>
            <div><dt>EXPECTANCY / TRADE</dt><dd>{money(runnerStats?.expectancyUsd)}</dd></div>
            <div><dt>PROFIT FACTOR</dt><dd>{fmt(runnerStats?.profitFactor, 2)}</dd></div>
            <div><dt>MAX SAMPLE DD</dt><dd>{money(runnerStats?.maxDrawdownUsd)}</dd></div>
          </dl>
          <footer>NO SE SUMA CON OTROS SLEEVES SIN RECONCILIACIÓN</footer>
        </article>

        <article className="economic-scoreboard__card economic-scoreboard__card--finance">
          <header><strong>AUTOFINANCIACIÓN</strong><span>MARGEN DE SEGURIDAD 1.5×</span></header>
          <dl>
            <div><dt>COSTE MENSUAL</dt><dd>{monthlyOperatingCostUsd == null ? 'NO CONFIGURADO' : money(monthlyOperatingCostUsd)}</dd></div>
            <div><dt>P&L EMPRESA 28–31D</dt><dd>NO RECONCILIADO</dd></div>
            <div><dt>COBERTURA</dt><dd>{scoreboard.economics.coverageRatio == null ? '—' : `${scoreboard.economics.coverageRatio.toFixed(2)}×`}</dd></div>
            <div><dt>UMBRAL</dt><dd>≥1.50× COSTES</dd></div>
            <div><dt>VEREDICTO</dt><dd>{verdictLabel(scoreboard.selfFundingVerdict)}</dd></div>
          </dl>
          <footer>{monthlyOperatingCostUsd == null ? 'NEXT: CONFIGURAR VITE_GENESIS_MONTHLY_COST_USD' : 'NEXT: RECONCILIAR OWNERSHIP + P&L CANÓNICO'}</footer>
        </article>
      </div>

      <div className="economic-scoreboard__rules">
        <strong>REGLA ECONÓMICA</strong>
        <span>Genesis no gana por operar más. Gana cuando una hipótesis sobrevive forward PAPER con expectancy neta positiva, PF ≥1.20, t-stat ≥1, DD ≤12% y luego demuestra que cubre sus costes con margen. Hasta entonces: PAPER, NO TRADE cuando no hay edge y LIVE bloqueado.</span>
      </div>
    </section>
  );
}
