import { usePaperPositions } from './useTradingDesk';
import { durationLabel, formatMoney, formatPrice, profileFromTrade } from './formatters';

export function PositionsTable() {
  const positions = usePaperPositions();
  return (
    <div className="trading-table-wrap" data-source="PAPER EXECUTION DATA">
      {positions.data?.length ? (
        <table className="trading-table">
          <thead><tr><th>PAIR</th><th>SIDE</th><th>SIZE (MARGIN)</th><th>ENTRY</th><th>MARK</th><th>TP</th><th>SL</th><th>LEV</th><th>UPNL</th><th>AGE</th><th>STRATEGY</th></tr></thead>
          <tbody>{positions.data.map((position) => (
            <tr key={position.id}>
              <td className="is-primary">{position.pair}</td>
              <td className={position.side === 'LONG' ? 'is-positive' : 'is-short'}>{position.side}</td>
              <td>{formatMoney(position.capitalUsed)}</td>
              <td>{formatPrice(position.entryPrice)}</td>
              <td className="is-unavailable">UNAVAILABLE</td>
              <td className="is-positive">{formatPrice(position.targetPrice)}</td>
              <td className="is-negative">{formatPrice(position.stopPrice)}</td>
              <td>{position.leverage == null ? 'UNAVAILABLE' : `${position.leverage}x`}</td>
              <td className="is-unavailable">NOT VERIFIED</td>
              <td>{durationLabel(position.openedAt)}</td>
              <td>{profileFromTrade(position)}</td>
            </tr>
          ))}</tbody>
        </table>
      ) : <div className="terminal-empty">{positions.state === 'loading' ? 'PENDING PAPER POSITION DATA' : positions.data ? 'NO OPEN PAPER POSITIONS' : 'POSITION DATA UNAVAILABLE'}</div>}
    </div>
  );
}
