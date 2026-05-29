import { useMemo } from 'react';
import { useAgents, useEvents, usePositions } from '../state/genesisStore';
import { useLanguage } from '../i18n/languageStore';
import type { PaperPosition } from '../types/trading';

function PulseDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full shrink-0 animate-pulse"
      style={{ background: color }}
    />
  );
}

function PositionRow({ pos, agentName, lang }: { pos: PaperPosition; agentName: string; lang: string }) {
  const unrealizedPnL = (pos.currentPrice - pos.entryPrice) * pos.shares * (pos.outcome === 'YES' ? 1 : -1);
  const pnlColor = unrealizedPnL >= 0 ? '#00ff9c' : '#ff4757';
  const question = pos.question[lang as 'es' | 'en'];
  const shortQ = question.length > 38 ? question.slice(0, 37) + '…' : question;

  return (
    <li className="px-3 py-2 border-b border-trim last:border-b-0">
      <div className="flex items-center gap-1.5 mb-0.5">
        <PulseDot color="#00ff9c" />
        <span className="font-mono text-[10px] text-zinc-300 font-medium">{agentName}</span>
        <span
          className="font-mono text-[9px] px-1 border"
          style={{ color: pos.outcome === 'YES' ? '#00ff9c' : '#ff4757', borderColor: pos.outcome === 'YES' ? '#00ff9c44' : '#ff475744' }}
        >
          {pos.outcome}
        </span>
      </div>
      <div className="font-mono text-[9px] text-zinc-500 truncate mb-0.5">{shortQ}</div>
      <div className="flex items-center justify-between font-mono text-[9px]">
        <span className="text-zinc-600">
          {pos.shares} {lang === 'es' ? 'acc' : 'shr'} @ ${pos.entryPrice.toFixed(3)} → ${pos.currentPrice.toFixed(3)}
        </span>
        <span style={{ color: pnlColor }} className="font-medium">
          {unrealizedPnL >= 0 ? '+' : ''}${unrealizedPnL.toFixed(2)}
        </span>
      </div>
    </li>
  );
}

export default function LiveTradingPanel() {
  const lang = useLanguage();
  const agents = useAgents();
  const openPositions = usePositions();
  const events = useEvents();

  const agentMap = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name])),
    [agents],
  );

  const tradeEvents = useMemo(() => {
    const kinds = new Set(['trade.opened', 'trade.profit', 'trade.loss', 'trade.closed']);
    return [...events].filter((e) => kinds.has(e.kind)).reverse().slice(0, 6);
  }, [events]);

  const openList = openPositions.filter((p) => p.status === 'open');

  return (
    <section className="border border-trim bg-carbon-200">
      <header className="px-3 py-2 border-b border-trim flex items-center justify-between">
        <div className="flex items-center gap-2">
          <PulseDot color={openList.length > 0 ? '#00ff9c' : '#4a5568'} />
          <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300">
            {lang === 'es' ? 'Trading en vivo' : 'Live trading'}
          </span>
        </div>
        <span className="font-mono text-[9px] text-zinc-600">
          {openList.length} {lang === 'es' ? 'posición(es) abierta(s)' : 'open position(s)'}
        </span>
      </header>

      {/* Open positions */}
      {openList.length > 0 ? (
        <ul>
          {openList.map((pos) => (
            <PositionRow
              key={pos.id}
              pos={pos}
              agentName={agentMap[pos.agentId] ?? pos.agentId}
              lang={lang}
            />
          ))}
        </ul>
      ) : (
        <div className="px-3 py-4 font-mono text-[11px] text-zinc-600">
          {lang === 'es' ? 'Sin posiciones abiertas.' : 'No open positions.'}
        </div>
      )}

      {/* Recent trade events */}
      {tradeEvents.length > 0 && (
        <>
          <div className="px-3 py-1.5 border-t border-trim bg-carbon-300">
            <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">
              {lang === 'es' ? 'Historial reciente' : 'Recent history'}
            </span>
          </div>
          <ul>
            {tradeEvents.map((e) => {
              const isProfit = e.kind === 'trade.profit';
              const isLoss = e.kind === 'trade.loss';
              const isOpen = e.kind === 'trade.opened';
              const dotColor = isProfit ? '#00ff9c' : isLoss ? '#ff4757' : isOpen ? '#3da9fc' : '#4a5568';
              const ts = new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              const msg = e.message[lang as 'es' | 'en'];
              const shortMsg = msg.length > 52 ? msg.slice(0, 51) + '…' : msg;
              return (
                <li key={e.id} className="px-3 py-1.5 border-b border-trim last:border-b-0 flex items-start gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: dotColor }} />
                  <span className="font-mono text-[9px] text-zinc-500 flex-1 leading-snug">{shortMsg}</span>
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
