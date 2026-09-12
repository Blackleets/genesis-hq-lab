import { useEffect, useMemo, useState } from 'react';
import { fetchMicroCanary, type MicroCanarySnapshot } from '@services/microCanaryClient';
import { useExecutions, useRunnerTelemetry } from './useTradingDesk';
import { finite, formatMoney, formatPrice, profileFromTrade } from './formatters';

type ExecutionScope = 'current' | 'all';
const CURRENT_V8 = 'futures_breakout_short_micro:v8';

function signedMoney(value: number | null | undefined) {
  if (!finite(value)) return 'UNAVAILABLE';
  const abs = Math.abs(Number(value)).toFixed(2);
  return `${Number(value) > 0 ? '+' : Number(value) < 0 ? '-' : ''}$${abs}`;
}

export function ExecutionTable() {
  const executions = useExecutions();
  const { runner } = useRunnerTelemetry();
  const [scope, setScope] = useState<ExecutionScope>('current');
  const [canary, setCanary] = useState<MicroCanarySnapshot | null>(null);
  const [canaryState, setCanaryState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    fetchMicroCanary(controller.signal)
      .then((snapshot) => {
        setCanary(snapshot);
        setCanaryState('ready');
      })
      .catch(() => {
        if (!controller.signal.aborted) setCanaryState('error');
      });
    return () => controller.abort();
  }, []);

  const closedAll = useMemo(() => (executions.data ?? [])
    .filter((trade) => trade.status === 'closed')
    .sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? '')), [executions.data]);

  const currentV8 = useMemo(() => closedAll.filter((trade) =>
    trade.strategyVersionId === CURRENT_V8 && trade.validationStatus === 'EXPERIMENT'
  ), [closedAll]);

  const visible = scope === 'current' ? currentV8 : closedAll;
  const currentPnl = useMemo(() => currentV8.reduce((sum, trade) => sum + (finite(trade.pnl) ? Number(trade.pnl) : 0), 0), [currentV8]);
  const validation = runner?.validationEngine?.validations?.short_micro;
  const sampleClosed = Number(validation?.metrics?.closed ?? currentV8.length);
  const sampleTarget = Number(runner?.validationEngine?.policy?.validated?.minClosed ?? 50);
  const canaryRun = canary?.baseline ?? null;
  const canaryPnl = canaryRun?.netPnlUsd ?? null;
  const canaryEquity = canaryRun?.finalEquityUsd ?? null;

  return (
    <div className="execution-surface" data-source="CURRENT V8 PAPER + MICRO CANARY">
      <section className="execution-overview" aria-label="Current paper performance">
        <div className="execution-overview__card execution-overview__card--canary">
          <span>MICRO CANARY · $10 · 1X</span>
          {canaryState === 'ready' && canaryRun ? (
            <>
              <strong className={finite(canaryPnl) ? Number(canaryPnl) > 0 ? 'is-positive' : Number(canaryPnl) < 0 ? 'is-negative' : 'is-neutral' : ''}>
                ${Number(canaryEquity).toFixed(2)}
              </strong>
              <small>{signedMoney(canaryPnl)} · {canaryRun.trades} CLOSED · {canary?.diagnosticVerdict.replaceAll('_', ' ')}</small>
            </>
          ) : (
            <><strong>—</strong><small>{canaryState === 'loading' ? 'VERIFYING DURABLE EVIDENCE' : 'CANARY EVIDENCE UNAVAILABLE'}</small></>
          )}
        </div>

        <div className="execution-overview__card">
          <span>CURRENT V8 · SHORT MICRO</span>
          <strong className={currentPnl > 0 ? 'is-positive' : currentPnl < 0 ? 'is-negative' : 'is-neutral'}>{signedMoney(currentPnl)}</strong>
          <small>{sampleClosed}/{sampleTarget} CLEAN SAMPLE · {validation?.status ?? 'EXPERIMENT'} · PAPER ONLY</small>
        </div>

        <div className="execution-overview__filters" role="group" aria-label="Execution history scope">
          <button type="button" className={scope === 'current' ? 'is-active' : ''} onClick={() => setScope('current')}>CURRENT V8</button>
          <button type="button" className={scope === 'all' ? 'is-active' : ''} onClick={() => setScope('all')}>ALL HISTORY</button>
        </div>
      </section>

      <div className="trading-table-wrap execution-table-scroll">
        {visible.length ? (
          <table className="trading-table">
            <thead><tr><th>PAIR</th><th>SIDE</th><th>ENTRY</th><th>EXIT</th><th>REASON</th><th>P&amp;L</th><th>STRATEGY</th><th>TIME</th></tr></thead>
            <tbody>{visible.map((trade) => (
              <tr key={trade.id}>
                <td className="is-primary">{trade.pair}</td>
                <td className={trade.side === 'LONG' ? 'is-positive' : 'is-short'}>{trade.side === 'LONG' ? 'LONG ↑' : 'SHORT ↓'}</td>
                <td>{formatPrice(trade.entryPrice)}</td>
                <td>{formatPrice(trade.exitPrice)}</td>
                <td>{trade.exitReason?.replaceAll('_', ' ').toUpperCase() ?? 'UNAVAILABLE'}</td>
                <td className={finite(trade.pnl) ? trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : 'is-neutral' : 'is-unavailable'}>{formatMoney(trade.pnl)}</td>
                <td>{trade.strategyVersionId === CURRENT_V8 ? 'SHORT MICRO · V8' : profileFromTrade(trade)}</td>
                <td>{trade.closedAt ? new Date(trade.closedAt).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'UNAVAILABLE'}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="terminal-empty">{executions.state === 'loading' ? 'PENDING EXECUTION DATA' : scope === 'current' ? 'NO CLOSED CURRENT V8 PAPER EXECUTIONS' : executions.data ? 'NO VERIFIED CLOSED PAPER EXECUTIONS' : 'EXECUTION DATA UNAVAILABLE'}</div>}
      </div>
    </div>
  );
}
