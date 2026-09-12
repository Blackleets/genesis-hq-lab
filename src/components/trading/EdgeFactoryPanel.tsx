import { useEffect, useMemo, useState } from 'react';
import { Activity, BrainCircuit, GitBranch, ShieldCheck, Sparkles } from 'lucide-react';
import { durationLabel } from './formatters';
import { fetchEdgeFactory, fetchEdgeLearning, type EdgeFactorySnapshot, type EdgeLearningSnapshot } from '../../services/edgeFactoryClient';
import './edgeFactory.css';

function fmt(v: number | null | undefined, d = 2, suffix = '') {
  return Number.isFinite(v) ? `${Number(v).toFixed(d)}${suffix}` : '—';
}
function statusLabel(status: string) {
  if (status === 'PAPER_CANDIDATE') return 'PAPER CANDIDATE';
  if (status === 'INTERESTING') return 'INTERESANTE';
  if (status === 'REGIME_DIVERGENCE') return 'CAMBIO DE RÉGIMEN';
  if (status === 'KILLED') return 'MUERTO';
  return 'DESCARTADO';
}
function humanFailure(value: string | null | undefined) {
  const labels: Record<string,string> = {
    INSUFFICIENT_SAMPLE: 'muestra insuficiente',
    NEGATIVE_TRAIN_EXPECTANCY: 'expectancy negativa en train',
    NEGATIVE_VALIDATION_EXPECTANCY: 'expectancy negativa en validation',
    NEGATIVE_HOLDOUT_EXPECTANCY: 'expectancy negativa en holdout',
    WEAK_VALIDATION_PROFIT_FACTOR: 'profit factor débil en validation',
    WEAK_HOLDOUT_PROFIT_FACTOR: 'profit factor débil en holdout',
    UNSTABLE_WALK_FORWARD: 'inestable entre regímenes',
    LOW_HOLDOUT_TSTAT: 'evidencia estadística débil',
    THREE_FAILED_GENERATIONS: 'tres generaciones fallidas',
  };
  return value ? (labels[value] ?? value.replaceAll('_',' ').toLowerCase()) : 'sin fallo dominante';
}
function humanAction(value: string | undefined) {
  if (value === 'PROMOTE_TO_FORWARD_PAPER') return 'promover a forward PAPER';
  if (value === 'MUTATE_AND_RETEST') return 'mutar y volver a probar';
  if (value === 'RETEST_ONLY_IF_REGIME_CHANGES') return 'reprobar solo si cambia el régimen';
  return 'bajar prioridad';
}
function explain(s: EdgeFactorySnapshot) {
  if (s.paperCandidates > 0) return `Hay ${s.paperCandidates} candidato${s.paperCandidates === 1 ? '' : 's'} que sobrevivieron train, validation, holdout y walk-forward. Siguiente paso: forward PAPER.`;
  if (s.interesting > 0) return `Hay ${s.interesting} hipótesis consistentes entre train y validation. Genesis las mutará; todavía no son candidatas PAPER.`;
  if ((s.regimeDivergence ?? 0) > 0) return `Hay ${s.regimeDivergence} señales que mejoraron solo en validation. Se etiquetan como cambio de régimen, no como edge validado.`;
  return 'Todavía no hay edge robusto. Genesis mata variantes débiles y conserva la causa del fallo para no repetirlas a ciegas.';
}

export function EdgeFactoryPanel() {
  const [snapshot, setSnapshot] = useState<EdgeFactorySnapshot | null>(null);
  const [learning, setLearning] = useState<EdgeLearningSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    const load = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 7000);
      try {
        const [factory, learned] = await Promise.allSettled([fetchEdgeFactory(controller.signal), fetchEdgeLearning(controller.signal)]);
        if (!active) return;
        if (factory.status === 'fulfilled') { setSnapshot(factory.value); setState('ready'); } else setState('error');
        setLearning(learned.status === 'fulfilled' ? learned.value : null);
      } finally { window.clearTimeout(timeout); }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const top = useMemo(() => snapshot?.top ?? [], [snapshot]);
  const learnedRules = useMemo(() => learning?.rules ?? [], [learning]);
  const positive = (snapshot?.paperCandidates ?? 0) > 0;

  return (
    <section className="edge-factory" aria-label="Edge Factory research evidence" data-source="CAPTURE TAPE · EDGE FACTORY">
      <header className="edge-factory__header">
        <div><Sparkles size={14} /><span><strong>EDGE FACTORY</strong><small>IDEAS → TEST → LEARN → KILL → MUTATE → RETEST</small></span></div>
        <strong className={positive ? 'is-positive' : snapshot?.interesting ? 'is-warning' : 'is-negative'}>
          {state === 'loading' ? 'BUSCANDO' : state === 'error' ? 'EVIDENCIA NO DISPONIBLE' : snapshot?.verdict.replaceAll('_', ' ')}
        </strong>
      </header>

      {state === 'loading' ? <div className="edge-factory__empty"><Activity size={13} className="animate-pulse" /> PROBANDO HIPÓTESIS...</div> : null}
      {state === 'error' ? <div className="edge-factory__empty">No se pudo leer la última fábrica. No se inventan resultados.</div> : null}

      {snapshot ? <>
        <div className="edge-factory__scoreboard">
          <div><span>PROBADAS</span><strong>{snapshot.tested}</strong></div>
          <div><span>INTERESANTES</span><strong className={snapshot.interesting > 0 ? 'is-warning' : ''}>{snapshot.interesting}</strong></div>
          <div><span>RÉGIMEN</span><strong>{snapshot.regimeDivergence ?? 0}</strong></div>
          <div><span>PAPER CANDIDATES</span><strong className={snapshot.paperCandidates > 0 ? 'is-positive' : ''}>{snapshot.paperCandidates}</strong></div>
          <div><span>MUERTAS</span><strong>{snapshot.killed}</strong></div>
          <div><span>KILL RULE</span><strong>{snapshot.methodology?.killAfterFailures ?? 3} FAILS</strong></div>
        </div>

        <div className="edge-factory__meaning"><span>EN CRISTIANO</span><strong>{explain(snapshot)}</strong></div>

        {learnedRules.length ? <div className="edge-factory__next"><BrainCircuit size={13}/><span><strong>GENESIS APRENDIÓ</strong><small>{learnedRules[0].hypothesisKey.replaceAll(':',' · ')} → {humanFailure(learnedRules[0].dominantFailure)} → {humanAction(learnedRules[0].action)}.</small></span></div> : null}

        <div className="edge-factory__table">
          <div className="edge-factory__row edge-factory__row--head"><span>HIPÓTESIS</span><span>ESTADO</span><span>VALIDATION</span><span>HOLDOUT</span><span>WF</span></div>
          {top.map(item => <div className="edge-factory__row" key={item.variantKey ?? `${item.hypothesisKey}:${item.candidate.period}:${item.candidate.targetAtr}:${item.candidate.stopAtr}:${item.candidate.timeoutBars}`}>
            <span><strong>{item.candidate.family.replaceAll('_',' ').toUpperCase()}</strong><small>{item.market.pair} · {item.market.tf} · {item.candidate.session} · P{item.candidate.period}</small></span>
            <span className={`edge-status edge-status--${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span>
            <span className={(item.validation?.expectancyBps ?? 0) > 0 ? 'is-positive' : 'is-negative'}>{fmt(item.validation?.expectancyBps,1,' bps')}<small>PF {fmt(item.validation?.profitFactor,2)}</small></span>
            <span className={(item.holdout?.expectancyBps ?? 0) > 0 ? 'is-positive' : 'is-negative'}>{fmt(item.holdout?.expectancyBps,1,' bps')}<small>PF {fmt(item.holdout?.profitFactor,2)}</small></span>
            <span>{item.walkForward ? `${item.walkForward.positiveFolds}/${item.walkForward.requiredPositiveFolds}` : '—'}</span>
          </div>)}
        </div>

        {snapshot.nextGeneration?.length ? <div className="edge-factory__next"><GitBranch size={13}/><span><strong>SIGUIENTE GENERACIÓN</strong><small>{snapshot.nextGeneration[0]?.mutation}</small></span></div> : null}

        <footer><div><ShieldCheck size={12}/> PAPER · CAPITAL REAL BLOQUEADO</div><small>{snapshot.completedAt ? `ÚLTIMA FÁBRICA HACE ${durationLabel(snapshot.completedAt)}` : 'TIMESTAMP NO DISPONIBLE'}</small></footer>
      </> : null}
    </section>
  );
}
