import { useEffect, useState } from 'react';
import { ArrowUpRight, Crosshair, Database, FlaskConical, LockKeyhole, ShieldAlert } from 'lucide-react';
import { fetchForwardPaper, type ForwardPaperSnapshot } from '../../services/forwardPaperClient';
import { fetchPortfolioRiskResearch, type PortfolioRiskResearchSnapshot } from '../../services/portfolioRiskResearchClient';
import { fetchPositioningResearch, type PositioningDataQuality, type PositioningEdgeSnapshot } from '../../services/positioningResearchClient';
import { fetchResearchLifecycle, type ResearchForwardSnapshot, type ResearchPromotionSnapshot } from '../../services/researchLifecycleClient';
import { finite, formatMoney } from './formatters';
import { useMarketData, useRiskState, useRunnerTelemetry } from './useTradingDesk';

type CommandView = 'strategies' | 'truth' | 'risk' | 'engine' | 'research' | 'agents';
type CommandTone = 'good' | 'watch' | 'bad' | 'neutral';

type Priority = {
  label: string;
  detail: string;
  view: CommandView;
  tone: CommandTone;
};

function compactChampion(id: string | undefined) {
  if (!id) return 'NO VERIFIED EDGE';
  const parts = id.split(':');
  const pair = (parts[1] ?? '?').replace('USDT', '/USDT');
  const tf = (parts[2] ?? '?').toUpperCase();
  const session = (parts[3] ?? '?').toUpperCase();
  return `${pair} · ${tf} · ${session}`;
}

function compactChampionMobile(id: string | undefined) {
  if (!id) return 'NO EDGE';
  const parts = id.split(':');
  const pair = (parts[1] ?? '?').replace('USDT', '/USDT');
  const tf = (parts[2] ?? '?').toUpperCase();
  return `${pair} · ${tf}`;
}

function compactRiskFlag(flag: string | undefined) {
  if (!flag) return null;
  const value = flag.replaceAll('_', ' ').trim().toUpperCase();
  if (value === 'RENDER UNAVAILABLE') return 'INFRA DEGRADED';
  return value;
}

function buildPriority({
  runnerVerified,
  riskBand,
  activeFlags,
  cleanV8Closed,
  positioningQuality,
  positioningEdge,
  promotion,
  researchForward,
  portfolioRisk,
  forward,
  economicPnl,
}: {
  runnerVerified: boolean;
  riskBand: string;
  activeFlags: string[];
  cleanV8Closed: number;
  positioningQuality: PositioningDataQuality | null;
  positioningEdge: PositioningEdgeSnapshot | null;
  promotion: ResearchPromotionSnapshot | null;
  researchForward: ResearchForwardSnapshot | null;
  portfolioRisk: PortfolioRiskResearchSnapshot | null;
  forward: ForwardPaperSnapshot | null;
  economicPnl: number | null | undefined;
}): Priority {
  if (!runnerVerified) {
    return { label: 'RESTORE PAPER RUNNER', detail: 'Execution evidence is not currently verified', view: 'engine', tone: 'bad' };
  }
  if (['ELEVATED', 'HIGH_RISK', 'CRITICAL'].includes(riskBand) || activeFlags.length > 0) {
    return { label: 'CLEAR RISK FLAGS', detail: `${activeFlags.length} active · ${riskBand.replaceAll('_', ' ')}`, view: 'risk', tone: riskBand === 'CRITICAL' || riskBand === 'HIGH_RISK' ? 'bad' : 'watch' };
  }
  if (cleanV8Closed < 50) {
    return { label: 'COLLECT V8 FORWARD SAMPLE', detail: `${cleanV8Closed}/50 clean v8 PAPER trades · runner active · LIVE remains locked`, view: 'agents', tone: 'watch' };
  }
  if (positioningQuality && positioningQuality.qualityPass !== true) {
    return { label: 'RESTORE DATA QUALITY', detail: 'Positioning cohort is not clean enough for research', view: 'research', tone: 'bad' };
  }

  const required = positioningQuality?.readiness?.minimumIndependentRows ?? positioningEdge?.methodology?.minIndependentRows ?? 20;
  const independent = positioningQuality?.independentRowCount ?? positioningEdge?.dataQuality?.independentRowCount ?? 0;
  if (positioningQuality && independent < required) {
    return { label: 'BUILD POSITIONING COHORT', detail: `${independent}/${required} clean independent observations · audit remains sealed`, view: 'research', tone: 'watch' };
  }
  if (positioningEdge?.verdict === 'RESEARCH_CANDIDATE_FOUND' && (promotion?.totalForwardPaperEligible ?? 0) === 0) {
    return { label: 'BUILD ONE-SHOT AUDIT EVIDENCE', detail: `${promotion?.waitingLanes ?? 0} lanes building · ${promotion?.methodology?.minimumUsableSamplesBeforeAudit ?? 80} samples required before holdout`, view: 'research', tone: 'watch' };
  }
  if (researchForward && researchForward.enrolled > 0 && researchForward.nextStageEligible === 0) {
    return { label: 'ACCUMULATE NEW FORWARD EVIDENCE', detail: `${researchForward.enrolled} audited lane${researchForward.enrolled === 1 ? '' : 's'} · prospective only · no backfill`, view: 'research', tone: 'watch' };
  }
  if ((researchForward?.nextStageEligible ?? 0) > 0) {
    if (!portfolioRisk) {
      return { label: 'VERIFY PORTFOLIO RISK EVIDENCE', detail: 'Forward gate passed but the portfolio research snapshot is not verified', view: 'risk', tone: 'bad' };
    }
    if (portfolioRisk.status === 'NO_FORWARD_GATE_PASS_CANDIDATES') {
      return { label: 'SYNC PORTFOLIO RISK EVIDENCE', detail: 'Forward evidence advanced ahead of the portfolio research cycle', view: 'risk', tone: 'watch' };
    }
    if (portfolioRisk.status === 'PORTFOLIO_EVIDENCE_BUILDING') {
      return { label: 'BUILD PORTFOLIO RISK EVIDENCE', detail: `${portfolioRisk.source.admittedCandidates} admitted · ${portfolioRisk.covariance.bucketCount} aligned covariance buckets · equal-weight PAPER only`, view: 'risk', tone: 'watch' };
    }
    if (portfolioRisk.status === 'PORTFOLIO_RESEARCH_READY') {
      return { label: 'RUN PAPER AGENT RISK REVIEW', detail: `${portfolioRisk.source.admittedCandidates} admitted · ${portfolioRisk.realized.base12Bps.tradeCount} forward trades · portfolio DD ${portfolioRisk.realized.base12Bps.maxDrawdownPct.toFixed(2)}%`, view: 'agents', tone: 'good' };
    }
    return { label: 'VERIFY PORTFOLIO RISK EVIDENCE', detail: portfolioRisk.status.replaceAll('_', ' '), view: 'risk', tone: 'watch' };
  }
  const family = forward?.families?.[0];
  if (family && family.nextStageEligible !== true) {
    return { label: 'ACCUMULATE FORWARD EVIDENCE', detail: `${family.championForward?.trades ?? 0}/20 prospective trades · LIVE remains locked`, view: 'agents', tone: 'watch' };
  }
  if (!finite(economicPnl) || economicPnl <= 0) {
    return { label: 'PROVE NET PROFIT', detail: 'Truth Ledger has not proven positive net P&L after fees', view: 'truth', tone: 'watch' };
  }
  return { label: 'COMPOUND PAPER EVIDENCE', detail: 'Positive evidence exists · real capital still requires cutover gates', view: 'truth', tone: 'good' };
}

export function FounderCommandBar({ onOpen }: { onOpen: (view: CommandView) => void }) {
  const { symbol, timeframe } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const { truth, capture } = useRiskState();
  const [forward, setForward] = useState<ForwardPaperSnapshot | null>(null);
  const [promotion, setPromotion] = useState<ResearchPromotionSnapshot | null>(null);
  const [researchForward, setResearchForward] = useState<ResearchForwardSnapshot | null>(null);
  const [portfolioRisk, setPortfolioRisk] = useState<PortfolioRiskResearchSnapshot | null>(null);
  const [positioningQuality, setPositioningQuality] = useState<PositioningDataQuality | null>(null);
  const [positioningEdge, setPositioningEdge] = useState<PositioningEdgeSnapshot | null>(null);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | null = null;
    let pending = false;
    const load = async () => {
      if (pending) return;
      pending = true;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      try {
        const [forwardResult, positioningResult, lifecycleResult, portfolioResult] = await Promise.allSettled([
          fetchForwardPaper(signal),
          fetchPositioningResearch(signal),
          fetchResearchLifecycle(signal),
          fetchPortfolioRiskResearch(signal),
        ]);
        if (disposed) return;
        setForward(forwardResult.status === 'fulfilled' && forwardResult.value.ok ? forwardResult.value : null);
        if (positioningResult.status === 'fulfilled') {
          setPositioningQuality(positioningResult.value.quality);
          setPositioningEdge(positioningResult.value.edge);
        } else {
          setPositioningQuality(null);
          setPositioningEdge(null);
        }
        if (lifecycleResult.status === 'fulfilled') {
          setPromotion(lifecycleResult.value.promotion);
          setResearchForward(lifecycleResult.value.forward);
        } else {
          setPromotion(null);
          setResearchForward(null);
        }
        setPortfolioRisk(portfolioResult.status === 'fulfilled' && portfolioResult.value.ok ? portfolioResult.value : null);
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => { disposed = true; controller?.abort(); window.clearInterval(timer); };
  }, []);

  const runnerVerified = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const risk = truth.data?.execution?.globalRisk ?? truth.data?.globalRisk ?? null;
  const riskBand = risk?.band ?? 'NOT VERIFIED';
  const activeFlags = Array.isArray(risk?.activeFlags) ? risk.activeFlags : [];
  const supabaseFallbackVerified = runnerVerified && runner?.source === 'supabase_futures_runner';
  const blockingRiskFlags = activeFlags.filter((flag) => !(supabaseFallbackVerified && flag === 'render_unavailable'));
  const renderDegraded = activeFlags.includes('render_unavailable');
  const cleanV8Closed = (runner?.recentTrades ?? []).filter((trade) => trade.status === 'closed' && trade.strategyVersionId?.endsWith(':v8') && trade.validationStatus === 'EXPERIMENT').length;
  const economicPnl = capture.data?.funding?.economicPnlUsdt;
  const openPaper = runner?.stats?.openPositions ?? runner?.openPositions?.length ?? null;
  const mission = truth.data?.founderMode?.focus?.trim() || truth.data?.founderMode?.goal?.trim() || 'Prove repeatable paper edge before capital cutover';

  const family = forward?.families?.[0] ?? null;
  const forwardTrades = family?.championForward?.trades ?? 0;
  const forwardGate = family?.forwardGate?.replaceAll('_', ' ') ?? 'NOT VERIFIED';
  const forwardTone: CommandTone = family?.nextStageEligible === true || (researchForward?.nextStageEligible ?? 0) > 0 ? 'good' : family || researchForward ? 'watch' : 'bad';
  const newForwardDetail = researchForward ? ` · ${researchForward.enrolled} audited lane${researchForward.enrolled === 1 ? '' : 's'}` : '';

  const requiredRows = positioningQuality?.readiness?.minimumIndependentRows ?? positioningEdge?.methodology?.minIndependentRows ?? 20;
  const independentRows = positioningQuality?.independentRowCount ?? positioningEdge?.dataQuality?.independentRowCount ?? null;
  const dataReady = positioningQuality?.readiness?.readyForPredeclaredStudy === true;
  const dataQualityPass = positioningQuality?.qualityPass === true;
  const dataTone: CommandTone = dataReady ? 'good' : dataQualityPass ? 'watch' : positioningQuality ? 'bad' : 'neutral';
  const dataLabel = independentRows === null ? 'NOT VERIFIED' : `${independentRows}/${requiredRows} CLEAN`;
  const dataDetail = dataReady ? `research enabled · audit ${promotion?.totalForwardPaperEligible ?? 0} eligible` : dataQualityPass ? 'cohort building' : positioningQuality ? 'quality gate failed' : 'evidence unavailable';

  const severeRisk = ['ELEVATED', 'HIGH_RISK', 'CRITICAL'].includes(riskBand);
  const riskTone: CommandTone = severeRisk ? 'bad' : renderDegraded || riskBand === 'WATCH' ? 'watch' : riskBand === 'HEALTHY' ? 'good' : 'neutral';
  const runnerFallbackHealthy = supabaseFallbackVerified && blockingRiskFlags.length === 0 && !severeRisk;
  const riskLabel = runnerFallbackHealthy ? 'PAPER RUNNER ACTIVE' : compactRiskFlag(blockingRiskFlags[0] ?? activeFlags[0]) ?? (riskBand === 'HEALTHY' ? 'NO ACTIVE BLOCKER' : riskBand.replaceAll('_', ' '));
  const riskDetail = runnerFallbackHealthy
    ? `Supabase heartbeat verified · ${openPaper ?? '—'} paper open${renderDegraded ? ' · Render degraded' : ''}`
    : blockingRiskFlags.length > 1
      ? `+${blockingRiskFlags.length - 1} additional flags`
      : runnerVerified
        ? `${openPaper ?? '—'} paper open · ${formatMoney(economicPnl)}`
        : 'paper runner not verified';
  const riskDetailMobile = runnerFallbackHealthy
    ? `SUPABASE · ${openPaper ?? '—'} OPEN${renderDegraded ? ' · WATCH' : ''}`
    : blockingRiskFlags.length > 1
      ? `+${blockingRiskFlags.length - 1} FLAGS`
      : runnerVerified
        ? `${openPaper ?? '—'} OPEN · ${finite(economicPnl) ? formatMoney(economicPnl, 0) : 'P&L N/A'}`
        : 'RUNNER UNVERIFIED';

  const priority = buildPriority({ runnerVerified, riskBand, activeFlags: blockingRiskFlags, cleanV8Closed, positioningQuality, positioningEdge, promotion, researchForward, portfolioRisk, forward, economicPnl });

  return (
    <section className="founder-command-bar" aria-label="Founder command layer">
      <div className="founder-command-bar__mission">
        <span className="founder-command-bar__eyebrow"><Crosshair size={12} /> FOUNDER MISSION</span>
        <strong title={mission}>{mission}</strong>
        <small>{symbol.replace('USDT', '')}/USDT · {timeframe} · verified desk context</small>
      </div>

      <button type="button" className={`founder-command-bar__metric founder-command-bar__metric--edge is-${family ? 'watch' : 'neutral'}`} onClick={() => onOpen('agents')}>
        <span><FlaskConical size={11} /> ACTIVE EDGE</span>
        <strong>
          <span className="founder-command-bar__desktop-value">{compactChampion(family?.championId)}</span>
          <span className="founder-command-bar__mobile-value">{compactChampionMobile(family?.championId)}</span>
        </strong>
        <small>
          <span className="founder-command-bar__desktop-value">{family ? `${family.independentEvidenceUnits} independent evidence unit` : 'awaiting verified forward family'}</span>
          <span className="founder-command-bar__mobile-value">{family ? `${family.independentEvidenceUnits} evidence unit` : 'awaiting evidence'}</span>
        </small>
      </button>

      <button type="button" className={`founder-command-bar__metric founder-command-bar__metric--forward is-${forwardTone}`} onClick={() => onOpen('agents')}>
        <span><LockKeyhole size={11} /> FORWARD</span>
        <strong>{forwardTrades}/20 · {forwardGate}</strong>
        <small>{family?.nextStageEligible ? 'next PAPER stage eligible' : `LIVE LOCKED${newForwardDetail}`}</small>
      </button>

      <button type="button" className={`founder-command-bar__metric founder-command-bar__metric--data is-${dataTone}`} onClick={() => onOpen('research')}>
        <span><Database size={11} /> DATA READINESS</span>
        <strong>{dataLabel}</strong>
        <small>{dataDetail}</small>
      </button>

      <button type="button" className={`founder-command-bar__metric founder-command-bar__metric--risk is-${riskTone}`} onClick={() => onOpen('risk')}>
        <span><ShieldAlert size={11} /> RISK</span>
        <strong>{riskLabel}</strong>
        <small>
          <span className="founder-command-bar__desktop-value">{riskDetail}</span>
          <span className="founder-command-bar__mobile-value">{riskDetailMobile}</span>
        </small>
      </button>

      <button type="button" className={`founder-command-bar__priority is-${priority.tone}`} onClick={() => onOpen(priority.view)}>
        <span>NEXT ACTION</span>
        <strong>{priority.label}</strong>
        <small>{priority.detail}</small>
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>
    </section>
  );
}
