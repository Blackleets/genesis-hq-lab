import { useEffect } from 'react';
import { Check, LockKeyhole, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useFounderState, useMarketData, useRiskState, useRunnerTelemetry } from './useTradingDesk';

export function ControlDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const founder = useFounderState();
  const { capture } = useRiskState();
  const { runner, resource: runnerResource } = useRunnerTelemetry();
  const { refresh } = useMarketData();
  const snapshot = founder.state === 'ready' ? founder.data : null;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const liveLocked = runnerResource.state === 'ready' && capture.state === 'ready'
    && runner?.liveOrders === false && capture.data?.liveOff === true && snapshot?.cutover.canExecute === false;
  const checks = snapshot?.cutover.checks ?? [];
  const passed = checks.filter((check) => check.passed).length;
  const connectors = snapshot?.connectors ?? [];

  return (
    <div className="control-drawer" role="dialog" aria-modal="true" aria-label="Founder control">
      <button type="button" className="control-drawer__backdrop" onClick={onClose} aria-label="Close founder control" />
      <aside className="control-drawer__panel">
        <header>
          <div><ShieldAlert size={16} /><span>FOUNDER CONTROL</span></div>
          <button type="button" onClick={onClose} aria-label="Close founder control"><X size={16} /></button>
        </header>
        <div className="control-drawer__lock">
          <LockKeyhole size={22} />
          <div><span>LIVE EXECUTION</span><strong>{liveLocked ? 'LOCKED' : 'NOT VERIFIED'}</strong></div>
        </div>
        <dl className="control-drawer__states">
          <div><dt>Operating mode</dt><dd>{snapshot?.mode?.replaceAll('_', ' ').toUpperCase() ?? 'UNAVAILABLE'}</dd></div>
          <div><dt>Kill switch</dt><dd>{snapshot ? snapshot.risk.killSwitchArmed && snapshot.risk.killSwitchTested ? 'ARMED + TESTED' : 'UNPROVEN' : 'NOT VERIFIED'}</dd></div>
          <div><dt>Emergency pause</dt><dd>{snapshot ? snapshot.risk.founderPaused ? 'ACTIVE' : 'CLEAR' : 'NOT VERIFIED'}</dd></div>
          <div><dt>Strategy approval</dt><dd>{snapshot ? snapshot.risk.strategyApproved ? 'APPROVED' : 'REQUIRED' : 'NOT VERIFIED'}</dd></div>
          <div><dt>Broker readiness</dt><dd>{snapshot?.readiness ?? 'NOT VERIFIED'}</dd></div>
          <div><dt>Can execute</dt><dd className="is-locked">{snapshot?.cutover.canExecute === false ? 'FALSE' : 'NOT VERIFIED'}</dd></div>
        </dl>
        <section className="control-drawer__gates">
          <div className="control-drawer__section-head"><span>SAFETY GATES</span><b>{checks.length ? `${passed}/${checks.length}` : 'UNAVAILABLE'}</b></div>
          <div>{checks.map((check) => <p key={check.id} className={check.passed ? 'is-passed' : 'is-blocked'}>{check.passed ? <Check size={11} /> : <X size={11} />}<span>{check.label}</span><b>{check.passed ? 'PASS' : 'BLOCKED'}</b></p>)}</div>
        </section>
        <section className="control-drawer__connectors">
          <div className="control-drawer__section-head"><span>CONNECTORS</span><b>{connectors.length ? `${connectors.filter((item) => item.health === 'online').length}/${connectors.length} VERIFIED` : 'UNAVAILABLE'}</b></div>
          <div>{connectors.map((connector) => <p key={connector.id}><i className={connector.health === 'online' ? 'is-online' : ''} /><span>{connector.name}</span><b>{connector.status.replaceAll('_', ' ').toUpperCase()}</b></p>)}</div>
        </section>
        {snapshot?.blockers.length ? <div className="control-drawer__blockers"><strong>ACTIVE BLOCKERS</strong>{snapshot.blockers.slice(0, 4).map((blocker) => <p key={blocker}>{blocker}</p>)}</div> : null}
        <footer><span>READ-ONLY CONTROL SURFACE</span><button type="button" onClick={refresh}><RefreshCw size={12} /> REFRESH EVIDENCE</button></footer>
      </aside>
    </div>
  );
}
