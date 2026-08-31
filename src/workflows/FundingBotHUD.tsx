// FundingBotHUD — PAPER funding bot, fed ONLY by useFundingBotState.
// Trader lines use real fields (equity, openCount, fundingPaid). No invented
// PF, DD, or "47 mercados".
import { useFundingBotState } from '@services/useFundingBotState';
import type { BotTrade } from '@services/useFundingBotState';

const TRADERS = [
  { id: 'scanner', name: 'Orion', role: 'scanner', color: '#3da9fc' },
  { id: 'risk', name: 'Vega', role: 'risk', color: '#ff4757' },
  { id: 'regime', name: 'Atlas', role: 'regime', color: '#22d3ee' },
  { id: 'validation', name: 'Nova', role: 'validation', color: '#7c5cff' },
  { id: 'capital', name: 'Maya', role: 'capital', color: '#ffd24a' },
] as const;

function traderLine(role: string, st: ReturnType<typeof useFundingBotState>): { status: string; line: string; pulse: boolean } {
  const opps = st.openCount;
  const fp = st.fundingPaid;
  switch (role) {
    case 'scanner':
      return {
        status: opps > 0 ? 'DETECTÓ' : 'ESCANEANDO',
        line: `${opps} ops abiertas · paper`,
        pulse: opps > 0,
      };
    case 'risk':
      return {
        status: 'PAPER',
        line: `${st.openCount} pos · LIVE_OFF`,
        pulse: false,
      };
    case 'regime':
      return {
        status: fp > 0 ? 'COBRANDO' : 'CALMA',
        line: fp !== 0 ? `${fp >= 0 ? '+' : ''}$${fp.toFixed(4)} cobrado` : 'sin cobro aún',
        pulse: fp > 0,
      };
    case 'validation':
      return {
        status: 'NO CLAIM',
        line: '6 gates en Laboratorio · sin PF inventado',
        pulse: false,
      };
    case 'capital':
      return {
        status: 'PAPER',
        line: `equity $${st.equity.toFixed(2)} · start $${st.startCapital.toFixed(2)}`,
        pulse: st.booted,
      };
    default:
      return { status: '—', line: '', pulse: false };
  }
}

function fmtUsd(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FundingBotHUD() {
  const st = useFundingBotState();
  return (
    <div className="w-[300px] shrink-0 bg-[#0b0f16] border-l border-zinc-800 flex flex-col">
      <div className="px-3 py-2.5 border-b border-zinc-800">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500">Funding Bot · PAPER · LIVE_OFF</div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-[22px] font-bold text-zinc-100">{fmtUsd(st.equity)}</span>
          <span className={`text-[11px] ${st.fundingPaid >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {st.fundingPaid >= 0 ? '+' : ''}{fmtUsd(st.fundingPaid)} cobrado
          </span>
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5">
          {st.openCount} pos abiertas · {st.trades.length} eventos
        </div>
      </div>

      <div className="px-3 py-2 space-y-1.5 flex-1 overflow-y-auto">
        {TRADERS.map((t) => {
          const { status, line, pulse } = traderLine(t.role, st);
          return (
            <div key={t.id} className="border border-zinc-800/70 rounded px-2 py-1.5 bg-[#0d111a]">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2 h-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: t.color }} />
                <span className="text-[12px] font-bold text-zinc-100">{t.name}</span>
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 ml-auto">{status}</span>
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5 truncate">{line}</div>
            </div>
          );
        })}
      </div>

      <div className="px-3 py-2 border-t border-zinc-800">
        <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Últimos eventos</div>
        <div className="space-y-0.5 max-h-28 overflow-y-auto">
          {st.last.length === 0 && <div className="text-[10px] text-zinc-600">esperando feed real…</div>}
          {st.last.map((e: BotTrade, i: number) => (
            <div key={i} className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-300">{e.pair}</span>
              <span className={e.event === 'FUNDING' ? 'text-emerald-400' : e.event === 'OPEN' ? 'text-cyan-400' : 'text-zinc-500'}>
                {e.event}{e.pnl != null ? ` ${e.pnl >= 0 ? '+' : ''}$${e.pnl.toFixed(4)}` : ''}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[9px] text-amber-500/70 mt-2 font-bold">PAPER · NO REAL MONEY · NO 6-GATE GO</div>
      </div>
    </div>
  );
}
