import { useMemo } from 'react';
import { useExecutions } from './useTradingDesk';
import { finite, formatMoney, formatPrice, profileFromTrade } from './formatters';

export function ExecutionTable() {
  const executions = useExecutions();
  const closed = useMemo(() => (executions.data ?? []).filter((trade) => trade.status === 'closed').sort((a, b) => Date.parse(b.closedAt ?? '') - Date.parse(a.closedAt ?? '')), [executions.data]);
  return (
    <div className="trading-table-wrap" data-source="PAPER EXECUTION DATA">
      {closed.length ? (
        <table className="trading-table">
          <thead><tr><th>PAIR</th><th>SIDE</th><th>ENTRY</th><th>EXIT</th><th>REASON</th><th>P&amp;L</th><th>STRATEGY</th><th>TIME</th></tr></thead>
          <tbody>{closed.map((trade) => (
            <tr key={trade.id}>
              <td className="is-primary">{trade.pair}</td>
              <td className={trade.side === 'LONG' ? 'is-positive' : 'is-short'}>{trade.side}</td>
              <td>{formatPrice(trade.entryPrice)}</td>
              <td>{formatPrice(trade.exitPrice)}</td>
              <td>{trade.exitReason?.replaceAll('_', ' ').toUpperCase() ?? 'UNAVAILABLE'}</td>
              <td className={finite(trade.pnl) ? trade.pnl > 0 ? 'is-positive' : trade.pnl < 0 ? 'is-negative' : 'is-neutral' : 'is-unavailable'}>{formatMoney(trade.pnl)}</td>
              <td>{profileFromTrade(trade)}</td>
              <td>{trade.closedAt ? new Date(trade.closedAt).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'UNAVAILABLE'}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <div className="terminal-empty">{executions.state === 'loading' ? 'PENDING EXECUTION DATA' : executions.data ? 'NO VERIFIED CLOSED PAPER EXECUTIONS' : 'EXECUTION DATA UNAVAILABLE'}</div>}
    </div>
  );
}
