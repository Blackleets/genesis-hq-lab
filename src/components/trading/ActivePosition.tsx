import { Crosshair } from 'lucide-react';
import { useMarketData, usePaperPositions } from './useTradingDesk';
import { durationLabel, formatMoney, formatPrice, profileFromTrade } from './formatters';

export function ActivePosition({ overlay = false }: { overlay?: boolean }) {
  const { symbol, market } = useMarketData();
  const positions = usePaperPositions();
  const position = positions.data?.find((row) => row.pair === symbol) ?? null;

  if (positions.state === 'loading') return <div className={`active-position ${overlay ? 'active-position--overlay' : ''}`}><span>PENDING PAPER POSITION DATA</span></div>;
  if (!position) return <div className={`active-position active-position--empty ${overlay ? 'active-position--overlay' : ''}`}><Crosshair size={13} /><span>{positions.data ? 'NO OPEN PAPER POSITION FOR THIS MARKET' : 'POSITION DATA UNAVAILABLE'}</span></div>;

  return (
    <article className={`active-position ${overlay ? 'active-position--overlay' : ''}`} data-source="PAPER EXECUTION DATA">
      <div className="active-position__head">
        <span className={position.side === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}>{position.side} {position.pair}</span>
        <b>PAPER · {profileFromTrade(position)}</b>
      </div>
      <div className="active-position__grid">
        <div><span>ENTRY</span><strong>{formatPrice(position.entryPrice)}</strong></div>
        <div><span>SPOT REF</span><strong>{market.state === 'ready' ? formatPrice(market.data?.lastPrice) : 'UNAVAILABLE'}</strong></div>
        <div><span>TP</span><strong className="text-emerald-300">{formatPrice(position.targetPrice)}</strong></div>
        <div><span>SL</span><strong className="text-red-300">{formatPrice(position.stopPrice)}</strong></div>
        <div><span>LEV</span><strong>{position.leverage == null ? 'UNAVAILABLE' : `${position.leverage}x`}</strong></div>
        <div><span>AGE</span><strong>{durationLabel(position.openedAt)}</strong></div>
        {!overlay ? <div><span>MARGIN</span><strong>{formatMoney(position.capitalUsed)}</strong></div> : null}
        {!overlay ? <div><span>MARK / UPNL</span><strong>NOT VERIFIED</strong></div> : null}
      </div>
      <div className="active-position__truth">SPOT REFERENCE IS NOT A FUTURES MARK · UPNL NOT CALCULATED</div>
    </article>
  );
}
