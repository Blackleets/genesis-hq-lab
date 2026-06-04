import { useMemo } from 'react';
import { useAgents } from '@core/store/genesisStore';
import { useLanguage } from '@core/i18n/languageStore';
import { useLiveTrading } from '@dashboard/hooks/useLiveTrading';
import type { AgentTrade } from '@services/agentClient';

function PulseDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0 animate-pulse"
      style={{ background: color }}
    />
  );
}

function TradeRow({ trade, agentName, lang }: { trade: AgentTrade; agentName: string; lang: string }) {
  const shortQ = trade.market_question.length > 38
    ? trade.market_question.slice(0, 37) + '…'
    : trade.market_question;

  return (
    <li className="px-3 py-2 border-b border-trim last:border-b-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <PulseDot color="#00ff9c" />
        <span className="font-mono text-[10px] text-zinc-300 font-medium">{agentName}</span>
        <span
          className="font-mono text-[9px] px-1 border"
          style={{ color: trade.outcome === 'YES' ? '#00ff9c' : '#ff4757', borderColor: trade.outcome === 'YES' ? '#00ff9c44' : '#ff475744' }}
        >
          {trade.outcome}
        </span>
      </div>
      <div className="font-mono text-[9px] text-zinc-500 truncate mb-0.5">{shortQ}</div>
      <div className="flex items-center justify-between font-mono text-[9px]">
        <span className="text-zinc-600">
          {trade.shares} {lang === 'es' ? 'acc' : 'shr'} @ ${trade.entry_price.toFixed(3)}
        </span>
        <span className="text-zinc-500">${trade.capital_used.toFixed(2)}</span>
      </div>
    </li>
  );
}

export default function LiveTradingPanel() {
  const lang = useLanguage();
  const agents = useAgents();
  const live = useLiveTrading();

  const agentMap = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name])),
    [agents],
  );

  const openList = live.openTrades;
  const recentClosed = live.closedTrades.slice(0, 6);

  if (!live.online) {
    return (
      <section className="gx-card">
        <header className="px-3 py-2 border-b border-trim">
          <span className="gx-card-title">
            {lang === 'es' ? 'Trading en vivo' : 'Live trading'}
          </span>
        </header>
        <div className="px-3 py-4 font-mono text-[11px] text-amber-400/90">
          {lang === 'es'
            ? 'Backend no conectado. Ejecuta npm run start para ver trades reales.'
            : 'Backend not connected. Run npm run start to see real trades.'}
        </div>
      </section>
    );
  }

  return (
    <section className="gx-card">
      <header className="px-3 py-2 border-b border-trim flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PulseDot color={openList.length > 0 ? '#00ff9c' : '#4a5568'} />
          <span className="gx-card-title">
            {lang === 'es' ? 'Trading en vivo' : 'Live trading'}
          </span>
        </div>
        <span className="font-mono text-[9px] text-zinc-600">
          {openList.length} {lang === 'es' ? 'posición(es) abierta(s)' : 'open position(s)'}
        </span>
      </header>

      {openList.length > 0 ? (
        <ul>
          {openList.map((trade) => (
            <TradeRow
              key={trade.id}
              trade={trade}
              agentName={agentMap[trade.agent_id] ?? trade.agent_id}
              lang={lang}
            />
          ))}
        </ul>
      ) : (
        <div className="px-3 py-4 font-mono text-[11px] text-zinc-600">
          {lang === 'es' ? 'Sin posiciones abiertas.' : 'No open positions.'}
        </div>
      )}

      {recentClosed.length > 0 && (
        <>
          <div className="px-3 py-1.5 border-t border-trim bg-carbon-300">
            <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">
              {lang === 'es' ? 'Cerrados recientes' : 'Recently closed'}
            </span>
          </div>
          <ul>
            {recentClosed.map((trade) => {
              const pnl = trade.pnl ?? 0;
              const dotColor = pnl > 0 ? '#00ff9c' : pnl < 0 ? '#ff4757' : '#4a5568';
              const ts = new Date(trade.closed_at ?? trade.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const shortQ = trade.market_question.length > 52
                ? trade.market_question.slice(0, 51) + '…'
                : trade.market_question;
              return (
                <li key={trade.id} className="px-3 py-1.5 border-b border-trim last:border-b-0 flex items-start gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: dotColor }} />
                  <span className="font-mono text-[9px] text-zinc-500 flex-1 leading-snug">{shortQ}</span>
                  <span className="font-mono text-[9px] shrink-0" style={{ color: dotColor }}>
                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                  </span>
                  <span className="font-mono text-[8px] text-zinc-700 shrink-0">{ts}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
