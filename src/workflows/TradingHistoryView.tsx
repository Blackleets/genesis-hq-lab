import { useMemo } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { useLiveTrading } from '@dashboard/hooks/useLiveTrading';
import { useAgents } from '@core/store/genesisStore';
import type { AgentTrade } from '@services/agentClient';

function exportToCsv(rows: ReturnType<typeof buildRows>) {
  const header = 'Agent,Market,Outcome,Entry,PnL,Status,Opened,Closed\n';
  const body = rows.map((r) =>
    [r.agentName, r.question, r.outcome, r.entryPrice.toFixed(3),
     r.pnl?.toFixed(2) ?? '—', r.status, r.openedAt, r.closedAt ?? '—'].join(',')
  ).join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `genesis-trades-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildRows(trades: AgentTrade[], agentMap: Record<string, string>) {
  return [...trades]
    .sort((a, b) => (b.closed_at ?? b.opened_at).localeCompare(a.closed_at ?? a.opened_at))
    .map((t) => ({
      id: t.id,
      agentName: agentMap[t.agent_id] ?? t.agent_id,
      question: t.market_question,
      outcome: t.outcome,
      entryPrice: t.entry_price,
      pnl: t.pnl,
      status: t.status,
      openedAt: new Date(t.opened_at).toLocaleString(),
      closedAt: t.closed_at ? new Date(t.closed_at).toLocaleString() : undefined,
    }));
}

export default function TradingHistoryView() {
  const lang = useLanguage();
  const live = useLiveTrading();
  const agents = useAgents();

  const agentMap = useMemo(
    () => Object.fromEntries(agents.map((a) => [a.id, a.name])),
    [agents],
  );
  const rows = useMemo(
    () => buildRows(live.closedTrades, agentMap),
    [live.closedTrades, agentMap],
  );

  if (!live.online) {
    return (
      <div className="px-4 py-8 font-mono text-[12px] text-amber-400/90">
        {lang === 'es' ? 'Backend offline — sin historial de trades.' : 'Backend offline — no trade history.'}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 font-mono text-[12px] text-zinc-500">
        {lang === 'es' ? 'Sin trades cerrados aún. El agente opera cada 5 min con npm run agent.' : 'No closed trades yet. Agent runs every 5 min with npm run agent.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex gap-4 font-mono text-[11px]">
          <span className="text-zinc-500">{lang === 'es' ? 'Trades' : 'Trades'}: <span className="text-zinc-200">{live.totalTrades}</span></span>
          <span className="text-zinc-500">Win rate: <span style={{ color: '#ffd24a' }}>{(live.winRate * 100).toFixed(0)}%</span></span>
          <span className="text-zinc-500">P&L: <span style={{ color: live.totalPnL >= 0 ? '#00ff9c' : '#ff4757' }}>
            {live.totalPnL >= 0 ? '+' : ''}${live.totalPnL.toFixed(2)}
          </span></span>
        </div>
        <button
          type="button"
          onClick={() => exportToCsv(rows)}
          className="font-mono text-[10px] uppercase tracking-wider px-3 py-1 border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-400"
        >
          {lang === 'es' ? 'Exportar CSV' : 'Export CSV'}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full font-mono text-[11px]">
          <thead>
            <tr className="border-b border-trim text-zinc-500 text-[10px] uppercase tracking-wider">
              <th className="px-4 py-2 text-left">{lang === 'es' ? 'Agente' : 'Agent'}</th>
              <th className="px-4 py-2 text-left">{lang === 'es' ? 'Mercado' : 'Market'}</th>
              <th className="px-3 py-2 text-center">Out</th>
              <th className="px-3 py-2 text-right">{lang === 'es' ? 'Entrada' : 'Entry'}</th>
              <th className="px-3 py-2 text-right">P&L</th>
              <th className="px-4 py-2 text-right">{lang === 'es' ? 'Cerrado' : 'Closed'}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-trim hover:bg-white/5"
                style={{ background: (r.pnl ?? 0) > 0 ? 'rgba(0,255,156,0.03)' : (r.pnl ?? 0) < 0 ? 'rgba(255,71,87,0.03)' : undefined }}
              >
                <td className="px-4 py-2 text-zinc-300">{r.agentName}</td>
                <td className="px-4 py-2 text-zinc-400 max-w-[200px] truncate" title={r.question}>{r.question}</td>
                <td className="px-3 py-2 text-center">
                  <span
                    className="px-1.5 py-0.5 text-[9px] uppercase tracking-wider"
                    style={{ color: r.outcome === 'YES' ? '#00ff9c' : '#ff4757', border: '1px solid currentColor' }}
                  >
                    {r.outcome}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">${r.entryPrice.toFixed(3)}</td>
                <td
                  className="px-3 py-2 text-right"
                  style={{ color: (r.pnl ?? 0) >= 0 ? '#00ff9c' : '#ff4757' }}
                >
                  {r.pnl !== undefined ? `${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}` : '—'}
                </td>
                <td className="px-4 py-2 text-right text-zinc-600 text-[9px]">{r.closedAt ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
