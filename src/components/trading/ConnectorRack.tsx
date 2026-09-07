import { Cable, LockKeyhole, RadioTower } from 'lucide-react';
import { heartbeatLabel } from './formatters';
import { useFounderState } from './useTradingDesk';

function connectorTone(status: string | undefined) {
  if (status === 'online') return 'online';
  if (status === 'paper_only' || status === 'pending') return 'gated';
  if (status === 'missing_credentials' || status === 'locked') return 'blocked';
  return 'unknown';
}

function label(value: string | null | undefined) {
  return value ? value.replaceAll('_', ' ').toUpperCase() : 'UNAVAILABLE';
}

export function ConnectorRack() {
  const founder = useFounderState();
  const verified = founder.state === 'ready' && founder.data != null;
  const connectors = verified ? founder.data?.connectors ?? [] : [];

  return (
    <section className="connector-rack" data-source="FOUNDER CONNECTOR REGISTRY" aria-label="Hermes connector rack">
      <div className="connector-rack__head">
        <div><Cable size={12} /><span>HERMES CONNECTOR RACK</span></div>
        <small>{verified ? `${connectors.length} CONTRACT CONNECTORS` : founder.state.toUpperCase()}</small>
      </div>

      <div className="connector-rack__grid">
        {connectors.length ? connectors.map((connector) => {
          const tone = connectorTone(connector.status);
          const blockers = Array.isArray(connector.blockers) ? connector.blockers.length : 0;
          return (
            <article key={connector.id} className={`connector-rack__card connector-rack__card--${tone}`}>
              <div className="connector-rack__identity">
                <span className="connector-rack__glyph">{tone === 'blocked' ? <LockKeyhole size={11} /> : <RadioTower size={11} />}</span>
                <div><strong>{connector.name}</strong><small>{label(connector.category)}</small></div>
              </div>
              <div className="connector-rack__meta">
                <span>{label(connector.mode)}</span>
                <b>{label(connector.status)}</b>
              </div>
              <div className="connector-rack__foot">
                <span>{blockers ? `${blockers} BLOCKER${blockers === 1 ? '' : 'S'}` : 'NO CONTRACT BLOCKERS'}</span>
                <span>{connector.lastCheck ? `CHECK ${heartbeatLabel(connector.lastCheck)} AGO` : 'CHECK UNAVAILABLE'}</span>
              </div>
            </article>
          );
        }) : (
          <div className="connector-rack__empty">CONNECTOR STATE UNAVAILABLE · NO CREDENTIALS OR STATUS INFERRED</div>
        )}
      </div>
    </section>
  );
}
