import { Cpu, Radio, ShieldOff } from 'lucide-react';
import { useMarketData, usePaperPositions, useRunnerTelemetry } from './useTradingDesk';
import { heartbeatLabel, profileFromTrade } from './formatters';

const metric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('en-US') : 'UNAVAILABLE';

export function EngineTelemetry() {
  const { symbol } = useMarketData();
  const { resource, runner } = useRunnerTelemetry();
  const positions = usePaperPositions();
  const cycle = runner?.lastResult;
  const active = positions.data?.find((position) => position.pair === symbol) ?? positions.data?.[0] ?? null;
  const verified = runner?.agentAlive === true && runner.paperOnly === true && runner.liveOrders === false;

  return (
    <section className="engine-telemetry" aria-label="Engine telemetry" data-source="SYSTEM HEALTH">
      <div className="terminal-panel-head">
        <div><span>ENGINE</span><small>{runner?.source ?? 'SOURCE UNAVAILABLE'}</small></div>
        <Cpu size={14} />
      </div>
      <div className="engine-telemetry__status">
        <span className={verified ? 'is-ready' : 'is-blocked'}><i />{verified ? 'ACTIVE' : resource.state === 'loading' ? 'PENDING' : 'NOT VERIFIED'}</span>
        <b>AUTONOMOUS PAPER</b>
      </div>
      <dl className="telemetry-list">
        <div><dt>Heartbeat</dt><dd>{heartbeatLabel(runner?.lastTickAt)}</dd></div>
        <div><dt>Cycle</dt><dd>{runner && typeof runner.totalCycles === 'number' ? `#${metric(runner.totalCycles)}` : 'UNAVAILABLE'}</dd></div>
        <div><dt>Mode</dt><dd>{runner?.paperOnly === true ? 'PAPER' : 'NOT VERIFIED'}</dd></div>
        <div><dt>Live orders</dt><dd className={runner?.liveOrders === false ? 'text-emerald-300' : 'text-red-300'}>{runner?.liveOrders === false ? 'OFF' : runner?.liveOrders === true ? 'ON' : 'NOT VERIFIED'}</dd></div>
      </dl>
      <div className="engine-telemetry__section-title"><Radio size={11} /> THIS CYCLE</div>
      <div className="engine-telemetry__cycle">
        <div><span>SCANNED</span><strong>{metric(cycle?.scanned)}</strong></div>
        <div><span>QUALIFIED</span><strong>{metric(cycle?.qualified)}</strong></div>
        <div><span>OPENED</span><strong>{metric(cycle?.executed)}</strong></div>
        <div><span>CLOSED</span><strong>{metric(cycle?.closed)}</strong></div>
      </div>
      <div className="engine-telemetry__section-title"><ShieldOff size={11} /> ACTIVE PROFILE</div>
      {active ? (
        <div className="engine-telemetry__profile">
          <strong>{profileFromTrade(active)}</strong>
          <span>{active.pair}</span>
          <b className={active.side === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}>{active.side}</b>
        </div>
      ) : <div className="engine-telemetry__unavailable">{positions.data ? 'NO OPEN PROFILE' : 'UNAVAILABLE'}</div>}
    </section>
  );
}
