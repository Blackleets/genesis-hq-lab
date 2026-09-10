import { useEffect, useMemo, useState } from 'react';
import { Activity, FlaskConical, LockKeyhole, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { durationLabel } from './formatters';
import { fetchProfitabilitySprint, type ProfitabilitySprintSnapshot } from '../../services/profitabilitySprintClient';
import './profitabilitySprint.css';

function fmt(value: number | null | undefined, digits = 2, suffix = '') {
  return Number.isFinite(value) ? `${Number(value).toFixed(digits)}${suffix}` : '—';
}

function familyLabel(value: string | undefined) {
  if (!value) return 'UNAVAILABLE';
  return value.replaceAll('_', ' ').toUpperCase();
}

function explain(snapshot: ProfitabilitySprintSnapshot) {
  if (snapshot.survivorCount > 0) {
    return `${snapshot.survivorCount} candidato${snapshot.survivorCount === 1 ? '' : 's'} sobrevivió a costes, validation, holdout y walk-forward. Siguiente paso: forward PAPER.`;
  }
  const best = snapshot.topCandidates?.[0];
  if (!best) return 'No hay evidencia suficiente para evaluar edge.';
  const holdout = best.holdout;
  if ((holdout.expectancyBps ?? 0) <= 0) return 'NO HAY EDGE TODAVÍA · la expectativa neta sigue negativa después de costes.';
  if ((holdout.profitFactor ?? 0) < 1.1) return 'NO HAY EDGE ROBUSTO · el beneficio bruto no compensa suficientemente las pérdidas.';
  if (!best.walkForward?.pass) return 'NO HAY EDGE ROBUSTO · la señal no se mantiene entre distintos tramos de mercado.';
  return 'NO HAY EDGE VALIDADO · algún gate estadístico sigue bloqueando la promoción a PAPER.';
}

export function ProfitabilitySprintPanel() {
  const [snapshot, setSnapshot] = useState<ProfitabilitySprintSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 5000);
        const next = await fetchProfitabilitySprint(controller.signal);
        window.clearTimeout(timeout);
        if (!active) return;
        setSnapshot(next);
        setState('ready');
      } catch {
        if (!active) return;
        setState('error');
      }
    };
    void load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const safe = snapshot?.paperOnly === true
    && snapshot.liveOrders === false
    && snapshot.executionAuthority === false
    && snapshot.capitalEligible === false;
  const verdictPositive = (snapshot?.survivorCount ?? 0) > 0;
  const best = snapshot?.topCandidates?.[0] ?? null;
  const candidates = useMemo(() => snapshot?.topCandidates ?? [], [snapshot]);

  return (
    <section className="profit-sprint" aria-label="Profitability sprint evidence" data-source="CAPTURE TAPE · PROFITABILITY SPRINT">
      <header className="profit-sprint__header">
        <div className="profit-sprint__title">
          <FlaskConical size={14} />
          <div><strong>PROFITABILITY SPRINT</strong><small>PRUEBA DE RENTABILIDAD · EVIDENCIA REAL</small></div>
        </div>
        <div className={`profit-sprint__verdict ${verdictPositive ? 'is-positive' : 'is-negative'}`}>
          {verdictPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          <span>{state === 'loading' ? 'CARGANDO' : state === 'error' ? 'EVIDENCIA NO DISPONIBLE' : snapshot?.verdict?.replaceAll('_', ' ')}</span>
        </div>
      </header>

      {state === 'loading' ? <div className="profit-sprint__empty"><Activity size={13} className="animate-pulse" /> LEYENDO EVIDENCIA...</div> : null}
      {state === 'error' ? <div className="profit-sprint__empty">No se pudo leer el último sprint. No se inventan resultados.</div> : null}

      {snapshot ? <>
        <div className="profit-sprint__summary">
          <div><span>ESTRATEGIAS PROBADAS</span><strong>{snapshot.candidateCount}</strong></div>
          <div><span>SUPERVIVIENTES</span><strong className={snapshot.survivorCount > 0 ? 'is-positive' : 'is-negative'}>{snapshot.survivorCount}</strong></div>
          <div><span>MEJOR HOLDOUT EV</span><strong className={(best?.holdout.expectancyBps ?? 0) > 0 ? 'is-positive' : 'is-negative'}>{fmt(best?.holdout.expectancyBps, 2, ' bps')}</strong></div>
          <div><span>MEJOR HOLDOUT PF</span><strong>{fmt(best?.holdout.profitFactor, 2)}</strong></div>
          <div><span>WALK-FORWARD</span><strong>{best ? `${best.walkForward.positiveFolds}/${best.walkForward.requiredPositiveFolds}` : '—'}</strong></div>
          <div><span>HISTORIA / MERCADO</span><strong>{snapshot.methodology?.barsPerMarketTarget ?? '—'} BARS</strong></div>
        </div>

        <div className="profit-sprint__plain-language">
          <span>QUÉ SIGNIFICA</span>
          <strong>{explain(snapshot)}</strong>
        </div>

        <div className="profit-sprint__candidates">
          <div className="profit-sprint__candidates-head">
            <span>TOP CANDIDATOS</span><span>TRAIN</span><span>VALIDATION</span><span>HOLDOUT</span><span>WF</span>
          </div>
          {candidates.map((candidate) => (
            <div className="profit-sprint__candidate" key={candidate.id}>
              <div>
                <strong>{familyLabel(candidate.params.family)} · P{candidate.params.period}</strong>
                <small>TP {candidate.params.targetAtr} ATR · SL {candidate.params.stopAtr} ATR · {candidate.params.timeoutBars} bars</small>
              </div>
              <span className={(candidate.train.expectancyBps ?? 0) > 0 ? 'is-positive' : 'is-negative'}>{fmt(candidate.train.expectancyBps, 1, ' bps')}<small>PF {fmt(candidate.train.profitFactor, 2)}</small></span>
              <span className={(candidate.validation.expectancyBps ?? 0) > 0 ? 'is-positive' : 'is-negative'}>{fmt(candidate.validation.expectancyBps, 1, ' bps')}<small>PF {fmt(candidate.validation.profitFactor, 2)}</small></span>
              <span className={(candidate.holdout.expectancyBps ?? 0) > 0 ? 'is-positive' : 'is-negative'}>{fmt(candidate.holdout.expectancyBps, 1, ' bps')}<small>PF {fmt(candidate.holdout.profitFactor, 2)}</small></span>
              <span className={candidate.walkForward.pass ? 'is-positive' : 'is-negative'}>{candidate.walkForward.positiveFolds}/{candidate.walkForward.requiredPositiveFolds}</span>
            </div>
          ))}
        </div>

        <footer className="profit-sprint__footer">
          <div className={safe ? 'is-safe' : 'is-unverified'}>
            {safe ? <ShieldCheck size={12} /> : <LockKeyhole size={12} />}
            <span>{safe ? 'PAPER · SIN AUTORIDAD DE EJECUCIÓN' : 'FRONTERA NO VERIFICADA'}</span>
          </div>
          <small>{snapshot.completedAt ? `ÚLTIMA PRUEBA HACE ${durationLabel(snapshot.completedAt)}` : 'TIMESTAMP NO DISPONIBLE'}</small>
        </footer>
      </> : null}
    </section>
  );
}
