import { ArrowUpRight, Crosshair, LockKeyhole, ShieldAlert } from 'lucide-react';
import { finite, formatMoney } from './formatters';
import { useMarketData, useRiskState, useRunnerTelemetry } from './useTradingDesk';

type CommandView = 'strategies' | 'truth' | 'risk' | 'engine';
type CommandTone = 'good' | 'watch' | 'bad' | 'neutral';

type Priority = {
  label: string;
  detail: string;
  view: CommandView;
  tone: CommandTone;
};

function buildPriority({
  runnerVerified,
  riskBand,
  activeFlags,
  edgeStatus,
  economicPnl,
}: {
  runnerVerified: boolean;
  riskBand: string;
  activeFlags: string[];
  edgeStatus: string;
  economicPnl: number | null | undefined;
}): Priority {
  if (!runnerVerified) {
    return {
      label: 'RESTORE PAPER RUNNER',
      detail: 'Execution evidence is not currently verified',
      view: 'engine',
      tone: 'bad',
    };
  }

  if (['ELEVATED', 'HIGH_RISK', 'CRITICAL'].includes(riskBand) || activeFlags.length > 0) {
    return {
      label: 'CLEAR RISK FLAGS',
      detail: `${activeFlags.length} active · ${riskBand.replaceAll('_', ' ')}`,
      view: 'risk',
      tone: riskBand === 'CRITICAL' || riskBand === 'HIGH_RISK' ? 'bad' : 'watch',
    };
  }

  if (edgeStatus !== 'RESEARCH_GO') {
    return {
      label: 'VALIDATE EDGE',
      detail: edgeStatus.replaceAll('_', ' '),
      view: 'strategies',
      tone: 'watch',
    };
  }

  if (!finite(economicPnl) || economicPnl <= 0) {
    return {
      label: 'PROVE NET PROFIT',
      detail: 'Truth Ledger has not proven positive net P&L',
      view: 'truth',
      tone: 'watch',
    };
  }

  return {
    label: 'COMPOUND PAPER EVIDENCE',
    detail: 'Positive evidence exists · keep real capital gated',
    view: 'truth',
    tone: 'good',
  };
}

export function FounderCommandBar({ onOpen }: { onOpen: (view: CommandView) => void }) {
  const { symbol, timeframe } = useMarketData();
  const { runner } = useRunnerTelemetry();
  const { truth, capture, founder } = useRiskState();

  const runnerVerified = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const risk = truth.data?.execution?.globalRisk ?? truth.data?.globalRisk ?? null;
  const riskBand = risk?.band ?? 'NOT VERIFIED';
  const activeFlags = Array.isArray(risk?.activeFlags) ? risk.activeFlags : [];
  const economicPnl = capture.data?.funding?.economicPnlUsdt;
  const edgeStatus = capture.data?.funding?.scorecard?.edgeEvidence?.status ?? 'NO EVIDENCE';
  const openPaper = runner?.stats?.openPositions ?? runner?.openPositions?.length ?? null;
  const mission = truth.data?.founderMode?.focus?.trim()
    || truth.data?.founderMode?.goal?.trim()
    || 'Prove repeatable paper edge before capital cutover';
  const priority = buildPriority({ runnerVerified, riskBand, activeFlags, edgeStatus, economicPnl });
  const cutoverReady = founder.state === 'ready' && founder.data?.cutover.canExecute === true;
  const cutoverLocked = founder.state === 'ready' && founder.data?.cutover.canExecute === false;
  const capitalLabel = cutoverLocked ? 'LOCKED' : cutoverReady ? 'CUTOVER READY' : 'NOT VERIFIED';
  const capitalTone: CommandTone = cutoverLocked ? 'good' : cutoverReady ? 'watch' : 'bad';

  return (
    <section className="founder-command-bar" aria-label="Founder command layer">
      <div className="founder-command-bar__mission">
        <span className="founder-command-bar__eyebrow"><Crosshair size={12} /> FOUNDER MISSION</span>
        <strong title={mission}>{mission}</strong>
        <small>{symbol.replace('USDT', '')}/USDT · {timeframe} · verified desk context</small>
      </div>

      <button type="button" className={`founder-command-bar__priority is-${priority.tone}`} onClick={() => onOpen(priority.view)}>
        <span>NEXT VERIFIED PRIORITY</span>
        <strong>{priority.label}</strong>
        <small>{priority.detail}</small>
        <ArrowUpRight size={14} aria-hidden="true" />
      </button>

      <button type="button" className={`founder-command-bar__metric is-${riskBand === 'HEALTHY' ? 'good' : riskBand === 'WATCH' ? 'watch' : 'bad'}`} onClick={() => onOpen('risk')}>
        <span><ShieldAlert size={11} /> RISK GATE</span>
        <strong>{riskBand.replaceAll('_', ' ')}</strong>
        <small>{activeFlags.length === 0 ? '0 active flags' : `${activeFlags.length} active flags`}</small>
      </button>

      <div className={`founder-command-bar__metric is-${capitalTone}`}>
        <span><LockKeyhole size={11} /> CAPITAL</span>
        <strong>{capitalLabel}</strong>
        <small>{runnerVerified ? `${openPaper ?? '—'} paper open · ${formatMoney(economicPnl)}` : 'paper execution not verified'}</small>
      </div>
    </section>
  );
}
