import { Activity, BarChart3, FlaskConical, LockKeyhole, Radar, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMarketData, useRiskState, useRunnerTelemetry } from './useTradingDesk';
import { finite, formatMoney } from './formatters';

type ProfitView = 'strategies' | 'truth' | 'risk' | 'engine';

function Gate({ icon, label, value, detail, state, onClick }: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
  state: 'ready' | 'watch' | 'blocked';
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`profit-engine-rail__gate is-${state}`} onClick={onClick}>
      <span className="profit-engine-rail__icon">{icon}</span>
      <span><small>{label}</small><strong>{value}</strong><i>{detail}</i></span>
    </button>
  );
}

export function ProfitEngineRail({ onOpen }: { onOpen: (view: ProfitView) => void }) {
  const { market } = useMarketData();
  const { runner, resource } = useRunnerTelemetry();
  const { capture, founder } = useRiskState();
  const funding = capture.state === 'ready' ? capture.data?.funding : null;
  const economicPnl = funding?.economicPnlUsdt;
  const edgeStatus = funding?.scorecard?.edgeEvidence?.status ?? 'NO EVIDENCE';
  const runnerActive = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;
  const truthReady = capture.state === 'ready' && funding?.ledgerVersion === 2;
  const cutoverLocked = founder.state === 'ready' && founder.data?.cutover.canExecute === false;

  return (
    <section className="profit-engine-rail" aria-label="Genesis profit engine status">
      <div className="profit-engine-rail__title">
        <span>MOTOR DE RENTABILIDAD</span>
        <strong>{finite(economicPnl) && economicPnl > 0 ? 'EVIDENCIA POSITIVA' : 'SIN BENEFICIO PROBADO'}</strong>
      </div>
      <div className="profit-engine-rail__flow">
        <Gate icon={<Radar size={15} />} label="1 · MERCADO" value={market.state === 'ready' ? 'CONECTADO' : market.state.toUpperCase()} detail="Binance spot público" state={market.state === 'ready' ? 'ready' : 'watch'} />
        <Gate icon={<FlaskConical size={15} />} label="2 · EDGE" value={edgeStatus.replaceAll('_', ' ')} detail="Costes + validación" state={edgeStatus === 'RESEARCH_GO' ? 'ready' : 'watch'} onClick={() => onOpen('strategies')} />
        <Gate icon={<Activity size={15} />} label="3 · PAPER" value={runnerActive ? 'EJECUTANDO' : 'DETENIDO'} detail={resource.state === 'ready' ? 'Futuros · sin órdenes reales' : 'Telemetría no disponible'} state={runnerActive ? 'ready' : 'blocked'} onClick={() => onOpen('engine')} />
        <Gate icon={<BarChart3 size={15} />} label="4 · RESULTADO" value={truthReady ? formatMoney(economicPnl) : 'NO VERIFICADO'} detail="Truth Ledger v2" state={truthReady && finite(economicPnl) && economicPnl > 0 ? 'ready' : truthReady ? 'watch' : 'blocked'} onClick={() => onOpen('truth')} />
        <Gate icon={cutoverLocked ? <LockKeyhole size={15} /> : <ShieldCheck size={15} />} label="5 · CAPITAL REAL" value={cutoverLocked ? 'BLOQUEADO' : 'NO VERIFICADO'} detail="Founder + Sentinel" state="blocked" onClick={() => onOpen('risk')} />
      </div>
    </section>
  );
}
