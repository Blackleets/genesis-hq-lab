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

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const [researchResult, universeResult] = await Promise.allSettled([
          fetchPositioningResearch(controller.signal),
          fetchPositioningUniverseReadiness(controller.signal),
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

  return (
    <section className="positioning-intelligence" aria-label="Positioning intelligence" data-source="CAPTURE TAPE · POSITIONING RESEARCH">
      <header className="positioning-intelligence__header">
        <div><Radar size={14} /><span><strong>POSITIONING INTELLIGENCE</strong><small>FUNDING · OPEN INTEREST · TAKER FLOW · VOLATILITY</small></span></div>
        <strong className={positive ? 'is-positive' : ready ? 'is-warning' : ''}>{state === 'loading' ? 'LEYENDO EVIDENCIA' : state === 'error' ? 'EVIDENCIA NO DISPONIBLE' : verdictLabel(edge?.verdict)}</strong>
      </header>

      {state === 'loading' ? <div className="positioning-intelligence__empty"><Activity size={13} className="animate-pulse" /> SINCRONIZANDO DATA PLANE...</div> : null}
      {state === 'error' ? <div className="positioning-intelligence__empty"><TriangleAlert size={13} /> No se pudo verificar positioning research. No se muestran valores inventados.</div> : null}

      {state === 'ready' && quality && edge ? <>
        <div className="positioning-intelligence__metrics">
          <div><span>DATA QUALITY · BTC</span><strong className={quality.qualityPass ? 'is-positive' : 'is-negative'}>{quality.qualityPass ? 'PASS' : 'FAIL'}</strong><small>{defectCount} defectos en cohort activo</small></div>
          <div><span>MUESTRA · BTC</span><strong>{independent} / {required}</strong><small>{remaining ? `faltan ${remaining}` : 'cohort listo'}</small></div>
          <div><span>EDGE STUDY</span><strong>{verdictLabel(edge.verdict)}</strong><small>{ready ? 'ranking habilitado por calidad' : 'ranking bloqueado hasta readiness'}</small></div>
          <div><span>COST STRESS</span><strong>{fmt(edge.methodology?.stressedCostBps, 0)} BPS</strong><small>incluido antes de promover</small></div>
          <div><span>HOLDOUT</span><strong>SEALED</strong><small>no usado para ranking</small></div>
          <div><span>CAPITAL</span><strong>BLOQUEADO</strong><small>RESEARCH_ONLY · PAPER</small></div>
        </div>

        <div className="positioning-intelligence__meaning">
          <Database size={13} />
          <span><strong>QUÉ SIGNIFICA</strong><small>{!quality.qualityPass ? 'La calidad del cohort no permite estudiar edge.' : !ready ? `La captura BTC es limpia, pero todavía necesitamos ${remaining} observaciones independientes antes de rankear hipótesis.` : positive ? 'Hay una hipótesis que sobrevivió train, validation y walk-forward; todavía necesita auditoría posterior antes de Forward PAPER.' : 'La cohorte ya permite investigación; Genesis está evaluando las familias predeclaradas sin abrir holdout.'}</small></span>
        </div>

        <div className="positioning-intelligence__universe" aria-label="Positioning universe readiness">
          <div className="positioning-intelligence__universe-label"><span>UNIVERSE READINESS</span><strong>{universe.length ? `${admitted}/${universe.length} ADMITTED` : 'NOT VERIFIED'}</strong><small>cada activo construye su propio cohort · sin mezclar muestras</small></div>
          {universe.map(item => <UniverseCell key={item.symbol} item={item} />)}
        </div>

        {candidates.length ? <div className="positioning-intelligence__table">
          <div className="positioning-intelligence__candidate positioning-intelligence__candidate--head"><span>FAMILIA</span><span>ESTADO</span><span>VALIDATION</span><span>WF</span></div>
          {candidates.map(item => <CandidateRow key={item.family} item={item} />)}
        </div> : null}

        <footer><div><ShieldCheck size={12}/> PAPER · CAPITAL REAL BLOQUEADO</div><small>{quality.lastEligibleCapturedAt ? `ÚLTIMO COHORT BTC ${new Date(quality.lastEligibleCapturedAt).toLocaleString()}` : 'TIMESTAMP NO DISPONIBLE'}</small></footer>
      </> : null}
    </section>
  );
}
