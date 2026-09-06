import { ListFilter } from 'lucide-react';
import { useRunnerTelemetry } from './useTradingDesk';
import { shortSymbol } from './formatters';

function decisionTone(status: unknown, reason: unknown) {
  if (status === 'paper_open') return 'open';
  const text = `${String(status ?? '')} ${String(reason ?? '')}`.toLowerCase();
  if (/risk|veto|block|max_open|halt|pause/.test(text)) return 'blocked';
  if (status === 'skip') return 'skip';
  return 'evaluation';
}

export function DecisionTape({ onViewAll, limit = 6 }: { onViewAll?: () => void; limit?: number }) {
  const { runner, resource } = useRunnerTelemetry();
  const sourceDecisions = runner?.lastResult?.decisions;
  const decisions = [...(sourceDecisions ?? [])].slice(-limit).reverse();
  const timestamp = runner?.lastTickAt ? new Date(runner.lastTickAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'TIME UNAVAILABLE';

  return (
    <section className="decision-tape" aria-label="Autonomous decision tape" data-source="SYSTEM / DECISION DATA">
      <div className="terminal-panel-head">
        <div><span>DECISION TAPE</span><small>{runner?.agentAlive === true ? 'LATEST VERIFIED CYCLE' : resource.state.toUpperCase()}</small></div>
        <ListFilter size={13} />
      </div>
      <div className="decision-tape__rows">
        {decisions.length ? decisions.map((decision, index) => {
          const tone = decisionTone(decision.status, decision.reason);
          const opened = decision.status === 'paper_open';
          return (
            <div key={`${decision.profile ?? 'profile'}-${decision.pair ?? 'pair'}-${index}`} className={`decision-tape__row decision-tape__row--${tone}`}>
              <time>{timestamp}</time>
              <strong>{shortSymbol(String(decision.pair ?? 'UNAVAILABLE'))}</strong>
              <b>{opened ? `${String(decision.side ?? '')} OPEN` : tone === 'evaluation' ? 'EVALUATED' : tone === 'blocked' ? 'BLOCKED' : 'NO TRADE'}</b>
              <span>{String(decision.profile ?? 'PROFILE UNAVAILABLE')} · {String(decision.reason ?? decision.status ?? 'REASON UNAVAILABLE')}</span>
            </div>
          );
        }) : <div className="terminal-empty">{resource.state === 'loading' ? 'PENDING DECISION DATA' : Array.isArray(sourceDecisions) ? 'NO DECISIONS IN VERIFIED CYCLE' : 'DECISIONS UNAVAILABLE'}</div>}
      </div>
      {onViewAll ? <button type="button" className="decision-tape__all" onClick={onViewAll}>VIEW ALL</button> : null}
    </section>
  );
}
