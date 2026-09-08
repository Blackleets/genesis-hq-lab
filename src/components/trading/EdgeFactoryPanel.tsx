import { useEffect, useMemo, useState } from 'react';
import { Activity, GitBranch, ShieldCheck, Sparkles } from 'lucide-react';
import { durationLabel } from './formatters';
import { fetchEdgeFactory, type EdgeFactorySnapshot } from '../../services/edgeFactoryClient';
import './edgeFactory.css';

function fmt(v: number | null | undefined, d = 2, suffix = '') {
  return Number.isFinite(v) ? `${Number(v).toFixed(d)}${suffix}` : '—';
}

function statusLabel(status: string) {
  if (status === 'PAPER_CANDIDATE') return 'PAPER CANDIDATE';
  if (status === 'INTERESTING') return 'INTERESANTE';
  if (status === 'KILLED') return 'MUERTO';
  return 'DESCARTADO';
}

function explain(s: EdgeFactorySnapshot) {
  if (s.paperCandidates > 0) return `Hay ${s.paperCandidates} candidato${s.paperCandidates === 1 ? '' : 's'} que sobrevivieron validation, holdout y walk-forward. Van a forward PAPER, no a LIVE.`;
  if (s.interesting > 0) return `Hay ${s.interesting} hipótesis con señal positiva parcial. Genesis las mutará y volverá a intentar; todavía no son candidatas PAPER.`;
  return 'Todavía no hay edge robusto. Genesis está matando hipótesis débiles y evitando gastar tiempo en familias que repiten el mismo fallo.';
}

export function EdgeFactoryPanel() {
  const [snapshot, setSnapshot] = useState<EdgeFactorySnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let active = true;
    const load = async () => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 6000);
      try {
        const data = await fetchEdgeFactory(controller.signal);
        if (active) { setSnapshot(data); setState('ready'); }
      } catch { if (active) setState('error'); }
      finally { window.clearTimeout(timeout); }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const top = useMemo(() => snapshot?.top ?? [], [snapshot]);
  const positive = (snapshot?.paperCandidates ?? 0) > 0;

  return (
    <section className="edge-factory" aria-label="Edge Factory research evidence" data-source="CAPTURE TAPE · EDGE FACTORY">
      <header className="edge-factory__header">
        <div><Sparkles size={14} /><span><strong>EDGE FACTORY</strong><small>IDEAS → TEST → KILL → MUTATE → RETEST</small></span></div>
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
          <div><span>PAPER CANDIDATES</span><strong className={snapshot.paperCandidates > 0 ? 'is-positive' : ''}>{snapshot.paperCandidates}</strong></div>
          <div><span>MUERTAS</span><strong>{snapshot.killed}</strong></div>
          <div><span>KILL RULE</span><strong>{snapshot.methodology?.killAfterFailures ?? 3} FAILS</strong></div>
          <div><span>HISTORIA</span><strong>{snapshot.methodology?.barsPerMarket ?? '—'} BARS</strong></div>
        </div>

        <div className="edge-factory__meaning"><span>EN CRISTIANO</span><strong>{explain(snapshot)}</strong></div>

        <div className="edge-factory__table">
          <div className="edge-factory__row edge-factory__row--head"><span>HIPÓTESIS</span><span>ESTADO</span><span>VALIDATION</span><span>HOLDOUT</span><span>WF</span></div>
          {top.map(item => <div className="edge-factory__row" key={`${item.hypothesisKey}:${item.candidate.period}:${item.candidate.targetAtr}:${item.candidate.stopAtr}:${item.candidate.timeoutBars}`}>
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
