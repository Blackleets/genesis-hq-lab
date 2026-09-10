import { BarChart3, Database, FlaskConical, LockKeyhole, Radar, ShieldAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { fetchForwardPaper, type ForwardPaperSnapshot } from '../../services/forwardPaperClient';
import { fetchPositioningResearch, type PositioningDataQuality, type PositioningEdgeSnapshot } from '../../services/positioningResearchClient';
import { useRiskState } from './useTradingDesk';
import { finite, formatMoney } from './formatters';

type ProfitView = 'research' | 'truth' | 'risk' | 'engine' | 'strategies';
type GateState = 'ready' | 'watch' | 'blocked';

function Gate({ icon, label, value, detail, state, onClick }: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  state: GateState;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`profit-engine-rail__gate is-${state}`} onClick={onClick}>
      <span className="profit-engine-rail__icon">{icon}</span>
      <span><small>{label}</small><strong>{value}</strong><i>{detail}</i></span>
    </button>
  );
}

function shortChampion(id: string | undefined) {
  if (!id) return 'NO VERIFIED EDGE';
  const parts = id.split(':');
  return `${parts[1] ?? '?'} · ${parts[2] ?? '?'} · ${parts[3] ?? '?'}`;
}

function researchLabel(verdict: string | undefined) {
  if (verdict === 'DATA_NOT_READY') return 'WAITING FOR DATA';
  if (verdict === 'NO_EDGE_FOUND') return 'NO EDGE FOUND';
  if (verdict === 'RESEARCH_CANDIDATE_FOUND') return 'CANDIDATE FOUND';
  return verdict?.replaceAll('_', ' ') ?? 'NOT VERIFIED';
}

export function ProfitEngineRail({ onOpen }: { onOpen: (view: ProfitView) => void }) {
  const { truth, capture, founder } = useRiskState();
  const [quality, setQuality] = useState<PositioningDataQuality | null>(null);
  const [positioning, setPositioning] = useState<PositioningEdgeSnapshot | null>(null);
  const [forward, setForward] = useState<ForwardPaperSnapshot | null>(null);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let pending = false;

    const load = async () => {
      if (pending) return;
      pending = true;
      controller?.abort();
      controller = new AbortController();
      try {
        const [researchResult, forwardResult] = await Promise.allSettled([
          fetchPositioningResearch(controller.signal),
          fetchForwardPaper(controller.signal),
        ]);
        if (disposed) return;
        if (researchResult.status === 'fulfilled') {
          setQuality(researchResult.value.quality);
          setPositioning(researchResult.value.edge);
        }
        if (forwardResult.status === 'fulfilled' && forwardResult.value.ok) setForward(forwardResult.value);
      } finally {
        pending = false;
      }
    };

    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, []);

  const funding = capture.state === 'ready' ? capture.data?.funding : null;
  const economicPnl = funding?.economicPnlUsdt;
  const truthReady = capture.state === 'ready' && funding?.ledgerVersion === 2;

  const required = quality?.readiness?.minimumIndependentRows ?? positioning?.methodology?.minIndependentRows ?? 20;
  const independent = quality?.independentRowCount ?? positioning?.dataQuality?.independentRowCount ?? 0;
  const dataReady = quality?.qualityPass === true && quality?.readiness?.readyForPredeclaredStudy === true;
  const researchCandidate = positioning?.verdict === 'RESEARCH_CANDIDATE_FOUND';

  const family = forward?.families?.[0];
  const forwardTrades = family?.championForward?.trades ?? 0;
  const forwardEligible = family?.nextStageEligible === true;
  const forwardState: GateState = forwardEligible ? 'ready' : family ? 'watch' : 'blocked';

  const risk = truth.data?.execution?.globalRisk ?? truth.data?.globalRisk ?? null;
  const riskBand = risk?.band ?? 'NOT VERIFIED';
  const activeFlags = Array.isArray(risk?.activeFlags) ? risk.activeFlags : [];
  const riskClear = riskBand === 'HEALTHY' && activeFlags.length === 0;
  const riskState: GateState = riskClear ? 'ready' : riskBand === 'NOT VERIFIED' ? 'blocked' : 'watch';

  const cutoverLocked = founder.state === 'ready' && founder.data?.cutover.canExecute === false;
  const profitProven = truthReady && finite(economicPnl) && economicPnl > 0;

  return (
    <section className="profit-engine-rail" aria-label="Genesis profit evidence pipeline">
      <div className="profit-engine-rail__title">
        <span>CAPITAL PIPELINE</span>
        <strong>{profitProven ? 'NET PROFIT EVIDENCE' : 'PROFIT NOT PROVEN'}</strong>
      </div>

      <div className="profit-engine-rail__flow">
        <Gate
          icon={<Database size={15} />}
          label="1 · DATA"
          value={quality ? `${independent} / ${required}` : 'NOT VERIFIED'}
          detail={quality?.qualityPass ? (dataReady ? 'clean cohort ready' : 'clean cohort building') : quality ? 'quality gate failed' : 'positioning tape unavailable'}
          state={dataReady ? 'ready' : quality?.qualityPass ? 'watch' : 'blocked'}
          onClick={() => onOpen('research')}
        />
        <Gate
          icon={<FlaskConical size={15} />}
          label="2 · RESEARCH"
          value={researchLabel(positioning?.verdict)}
          detail={researchCandidate ? 'train + validation + WF survivor' : 'holdout remains sealed'}
          state={researchCandidate ? 'ready' : positioning ? 'watch' : 'blocked'}
          onClick={() => onOpen('research')}
        />
        <Gate
          icon={<Radar size={15} />}
          label="3 · FORWARD"
          value={family ? shortChampion(family.championId) : 'NOT VERIFIED'}
          detail={family ? `${forwardTrades} / 20 new trades · ${family.forwardGate.replaceAll('_', ' ')}` : 'no verified forward family'}
          state={forwardState}
          onClick={() => onOpen('strategies')}
        />
        <Gate
          icon={<ShieldAlert size={15} />}
          label="4 · RISK"
          value={riskBand.replaceAll('_', ' ')}
          detail={activeFlags.length ? `${activeFlags.length} active blocker${activeFlags.length === 1 ? '' : 's'}` : riskClear ? 'no active blockers' : 'risk evidence incomplete'}
          state={riskState}
          onClick={() => onOpen('risk')}
        />
        <Gate
          icon={<BarChart3 size={15} />}
          label="5 · TRUTH"
          value={truthReady ? formatMoney(economicPnl) : 'NOT VERIFIED'}
          detail="economic P&L · Truth Ledger v2"
          state={profitProven ? 'ready' : truthReady ? 'watch' : 'blocked'}
          onClick={() => onOpen('truth')}
        />
        <Gate
          icon={<LockKeyhole size={15} />}
          label="6 · CAPITAL"
          value={cutoverLocked ? 'LOCKED' : 'NOT VERIFIED'}
          detail="human approval + evidence gates required"
          state="blocked"
          onClick={() => onOpen('risk')}
        />
      </div>
    </section>
  );
}
