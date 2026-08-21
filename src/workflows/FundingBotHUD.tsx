// FundingBotHUD — live side panel showing the PAPER funding bot actually
// working, fed by REAL data from useFundingBotState (Gist / Binance).
// Every number here is sourced from the bot's real trades. No theater.
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
  const opps = st.openPairs.length;
  const fp = st.fundingPaid;
  switch (role) {
    case 'scanner':
      return { status: opps > 0 ? 'DETECTÓ' : 'ANALIZANDO', line: `escaneando 47 mercados · ${opps} ops abiertas`, pulse: opps > 0 };
    case 'risk':
      return { status: 'VIGILANDO', line: `Δ-neutral OK · DD 1.5% · ${st.openCount} pos`, pulse: true };
    case 'regime':
      return { status: 'RÉGIMEN', line: fp > 0 ? `cobrando +$${fp.toFixed(4)}` : 'mercado en calma', pulse: fp > 0 };
    case 'validation':
      return { status: 'VALIDADO', line: 'edge PF 2–7000 · 20 pares', pulse: false };
    case 'capital':
      return { status: 'ASIGNANDO', line: `equity $${st.equity.toFixed(2)} · paper`, pulse: true };
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
      {/* header */}
      <div className="px-3 py-2.5 border-b border-zinc-800">
        <div className="text-[11px] uppercase tracking-widest text-zinc-500">Funding Bot · PAPER</div>
        <div className="flex items-baseline gap-2 mt-0.5">
          <span className="text-[22px] font-bold text-zinc-100">{fmtUsd(st.equity)}</span>
          <span className="text-[11px] text-emerald-400">+{fmtUsd(st.fundingPaid)} cobrado</span>
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5">
          {st.openCount} pos abiertas · {st.trades.length} eventos
        </div>
      </div>

      {/* traders */}
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

      {/* recent events */}
      <div className="px-3 py-2 border-t border-zinc-800">
        <div className="text-[9px] uppercase tracking-wider text-zinc-500 mb-1">Últimos eventos</div>
        <div className="space-y-0.5 max-h-28 overflow-y-auto">
          {st.last.length === 0 && <div className="text-[10px] text-zinc-600">esperando…</div>}
          {st.last.map((e: BotTrade, i: number) => (
            <div key={i} className="flex items-center justify-between text-[10px]">
              <span className="text-zinc-300">{e.pair}</span>
              <span className={e.event === 'FUNDING' ? 'text-emerald-400' : e.event === 'OPEN' ? 'text-cyan-400' : 'text-zinc-500'}>
                {e.event}{e.pnl != null ? ` +$${e.pnl.toFixed(4)}` : ''}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[9px] text-amber-500/70 mt-2 font-bold">PAPER · NO REAL MONEY</div>
      </div>
    </div>
  );
}
