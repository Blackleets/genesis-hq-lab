import { useEffect, useMemo, useState } from 'react';
import { Activity, Database, Radar, ShieldCheck, TriangleAlert } from 'lucide-react';
import {
  fetchPositioningResearch,
  fetchPositioningUniverseReadiness,
  type PositioningCandidate,
  type PositioningDataQuality,
  type PositioningEdgeSnapshot,
  type PositioningUniverseRow,
} from '../../services/positioningResearchClient';
import {
  fetchResearchLifecycle,
  type ResearchForwardSnapshot,
  type ResearchPromotionSnapshot,
} from '../../services/researchLifecycleClient';
import './positioningIntelligence.css';

type LoadState = 'loading' | 'ready' | 'error';

function fmt(value: number | null | undefined, digits = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function verdictLabel(verdict: string | undefined) {
  if (verdict === 'DATA_NOT_READY') return 'MUESTRA EN CONSTRUCCIÓN';
  if (verdict === 'NO_EDGE_FOUND') return 'SIN EDGE';
  if (verdict === 'RESEARCH_CANDIDATE_FOUND') return 'CANDIDATO ENCONTRADO';
  return verdict?.replaceAll('_', ' ') ?? 'NO DISPONIBLE';
}

function familyLabel(value: string) {
  return value.replaceAll('_', ' ').toUpperCase();
}

function shortSymbol(symbol: string) {
  return symbol.replace('USDT', '');
}

function CandidateRow({ item }: { item: PositioningCandidate }) {
  const positive = item.status === 'RESEARCH_CANDIDATE';
  return (
    <div className="positioning-intelligence__candidate">
      <span><strong>{familyLabel(item.family)}</strong><small>{item.description}</small></span>
      <span className={positive ? 'is-positive' : ''}>{positive ? 'RESEARCH CANDIDATE' : 'REJECTED'}</span>
      <span>{fmt(item.validation?.expectancyBps, 1)} bps<small>PF {fmt(item.validation?.profitFactor)} · t {fmt(item.validation?.tStat)}</small></span>
      <span>{item.walkForward?.pass ? 'PASS' : 'FAIL'}</span>
    </div>
  );
}

function UniverseCell({ item }: { item: PositioningUniverseRow }) {
  const state = !item.admitted ? 'blocked' : item.ready ? 'ready' : item.qualityPass ? 'building' : 'blocked';
  const count = item.independentRowCount == null ? '—' : `${item.independentRowCount}/${item.required ?? 20}`;
  return (
    <div className={`positioning-intelligence__universe-cell is-${state}`}>
      <span>{shortSymbol(item.symbol)}</span>
      <strong>{item.admitted ? count : 'EXCLUDED'}</strong>
      <small>{!item.admitted ? 'provider gate' : item.ready ? 'study ready' : item.qualityPass ? 'clean · building' : item.qualityPass === false ? 'quality fail' : 'not verified'}</small>
    </div>
  );
}

export function PositioningIntelligencePanel() {
  const [state, setState] = useState<LoadState>('loading');
  const [quality, setQuality] = useState<PositioningDataQuality | null>(null);
  const [edge, setEdge] = useState<PositioningEdgeSnapshot | null>(null);
  const [universe, setUniverse] = useState<PositioningUniverseRow[]>([]);
  const [promotion, setPromotion] = useState<ResearchPromotionSnapshot | null>(null);
  const [researchForward, setResearchForward] = useState<ResearchForwardSnapshot | null>(null);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const [researchResult, universeResult, lifecycleResult] = await Promise.allSettled([
          fetchPositioningResearch(controller.signal),
          fetchPositioningUniverseReadiness(controller.signal),
          fetchResearchLifecycle(controller.signal),
        ]);
        if (disposed) return;
        if (researchResult.status === 'fulfilled') {
          setQuality(researchResult.value.quality);
          setEdge(researchResult.value.edge);
          setState('ready');
        } else if (!(researchResult.reason instanceof DOMException && researchResult.reason.name === 'AbortError')) {
          setState('error');
        }
        setUniverse(universeResult.status === 'fulfilled' ? universeResult.value.rows : []);
        if (lifecycleResult.status === 'fulfilled') {
          setPromotion(lifecycleResult.value.promotion);
          setResearchForward(lifecycleResult.value.forward);
        } else {
          setPromotion(null);
          setResearchForward(null);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!disposed) setState('error');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { disposed = true; controller?.abort(); window.clearInterval(timer); };
  }, []);

  const required = quality?.readiness?.minimumIndependentRows ?? edge?.methodology?.minIndependentRows ?? 20;
  const independent = quality?.independentRowCount ?? edge?.dataQuality?.independentRowCount ?? 0;
  const remaining = Math.max(0, required - independent);
  const defects = quality?.defects;
  const defectCount = defects ? defects.duplicateCloseTimes + defects.nonCausalSequence + defects.overlappingWindows + defects.excessiveGaps : 0;
  const candidates = useMemo(() => edge?.survivors?.length ? edge.survivors : edge?.candidates?.slice(0, 4) ?? [], [edge]);
  const ready = quality?.readiness?.readyForPredeclaredStudy === true;
  const positive = edge?.verdict === 'RESEARCH_CANDIDATE_FOUND';
  const admitted = universe.filter(item => item.admitted).length;
  const auditRequired = promotion?.methodology?.minimumUsableSamplesBeforeAudit ?? 80;
  const auditEligible = promotion?.totalForwardPaperEligible ?? 0;
  const waitingLanes = promotion?.waitingLanes ?? null;
  const forwardEnrolled = researchForward?.enrolled ?? 0;
  const forwardNextStage = researchForward?.nextStageEligible ?? 0;
  const lastEligibleMs = quality?.lastEligibleCapturedAt ? Date.parse(quality.lastEligibleCapturedAt) : NaN;
  const evidenceAgeMinutes = Number.isFinite(lastEligibleMs) ? Math.max(0, Math.floor((Date.now() - lastEligibleMs) / 60_000)) : null;
  const evidenceStale = evidenceAgeMinutes != null && evidenceAgeMinutes > 60;

  return (
    <section className="positioning-intelligence" aria-label="Positioning intelligence" data-source="CAPTURE TAPE · POSITIONING RESEARCH">
      <header className="positioning-intelligence__header">
        <div><Radar size={14} /><span><strong>POSITIONING INTELLIGENCE</strong><small>FUNDING · OPEN INTEREST · TAKER FLOW · CROSS-MARKET</small></span></div>
        <strong className={evidenceStale ? 'is-negative' : positive ? 'is-positive' : ready ? 'is-warning' : ''}>{state === 'loading' ? 'LEYENDO EVIDENCIA' : state === 'error' ? 'EVIDENCIA NO DISPONIBLE' : evidenceStale ? 'EVIDENCIA STALE' : verdictLabel(edge?.verdict)}</strong>
      </header>

      {state === 'loading' ? <div className="positioning-intelligence__empty"><Activity size={13} className="animate-pulse" /> SINCRONIZANDO DATA PLANE...</div> : null}
      {state === 'error' ? <div className="positioning-intelligence__empty"><TriangleAlert size={13} /> No se pudo verificar positioning research. No se muestran valores inventados.</div> : null}

      {state === 'ready' && quality && edge ? <>
        <div className="positioning-intelligence__metrics">
          <div><span>DATA QUALITY · BTC</span><strong className={evidenceStale ? 'is-negative' : quality.qualityPass ? 'is-positive' : 'is-negative'}>{evidenceStale ? 'STALE' : quality.qualityPass ? 'PASS' : 'FAIL'}</strong><small>{evidenceStale ? `${evidenceAgeMinutes} min sin evidencia elegible fresca` : `${defectCount} defectos en cohort activo`}</small></div>
          <div><span>MUESTRA · BTC</span><strong>{independent} / {required}</strong><small>{remaining ? `faltan ${remaining}` : 'cohort listo'}</small></div>
          <div><span>EDGE STUDY</span><strong>{verdictLabel(edge.verdict)}</strong><small>{ready ? 'ranking habilitado por calidad' : 'ranking bloqueado hasta readiness'}</small></div>
          <div><span>ONE-SHOT AUDIT</span><strong className={auditEligible > 0 ? 'is-positive' : ''}>{promotion ? (auditEligible > 0 ? `${auditEligible} ELIGIBLE` : `${waitingLanes ?? 0} BUILDING`) : 'NOT VERIFIED'}</strong><small>{auditRequired} samples · {promotion?.methodology?.stressCostBps ?? 18}bps stress</small></div>
          <div><span>PROSPECTIVE FORWARD</span><strong className={forwardNextStage > 0 ? 'is-positive' : ''}>{researchForward ? `${forwardEnrolled} ENROLLED` : 'NOT VERIFIED'}</strong><small>{researchForward ? `${forwardNextStage} next-stage · no backfill` : 'forward ledger unavailable'}</small></div>
          <div><span>CAPITAL</span><strong>BLOQUEADO</strong><small>evidence gates + human cutover</small></div>
        </div>

        <div className="positioning-intelligence__meaning">
          <Database size={13} />
          <span><strong>QUÉ SIGNIFICA</strong><small>{evidenceStale ? `La última evidencia BTC elegible tiene ${evidenceAgeMinutes} min. No debe interpretarse un PASS de calidad como frescura operativa; la investigación permanece bloqueada hasta recuperar captura causal reciente.` : !quality.qualityPass ? 'La calidad del cohort no permite estudiar edge.' : !ready ? `La captura BTC es limpia, pero todavía necesitamos ${remaining} observaciones independientes antes de rankear hipótesis. El holdout sigue sellado.` : positive ? `Hay una hipótesis de research. Antes de Forward PAPER necesita champion freeze, stress a ${promotion?.methodology?.stressCostBps ?? 18} bps y one-shot holdout; no existe promoción automática a LIVE.` : 'La cohorte permite investigación; Genesis evalúa familias predeclaradas sin usar holdout para ranking.'}</small></span>
        </div>

        <div className="positioning-intelligence__universe" aria-label="Positioning universe readiness">
          <div className="positioning-intelligence__universe-label"><span>UNIVERSE READINESS</span><strong>{universe.length ? `${admitted}/${universe.length} ADMITTED` : 'NOT VERIFIED'}</strong><small>cada activo construye su propio cohort · sin mezclar muestras</small></div>
          {universe.map(item => <UniverseCell key={item.symbol} item={item} />)}
        </div>

        {candidates.length ? <div className="positioning-intelligence__table">
          <div className="positioning-intelligence__candidate positioning-intelligence__candidate--head"><span>FAMILIA</span><span>ESTADO</span><span>VALIDATION</span><span>WF</span></div>
          {candidates.map(item => <CandidateRow key={item.family} item={item} />)}
        </div> : null}

        <footer><div><ShieldCheck size={12}/> PAPER · LIVE LOCKED · HOLDOUT ONE-SHOT</div><small>{quality.lastEligibleCapturedAt ? `ÚLTIMO COHORT BTC ${new Date(quality.lastEligibleCapturedAt).toLocaleString()}` : 'TIMESTAMP NO DISPONIBLE'}</small></footer>
      </> : null}
    </section>
  );
}
