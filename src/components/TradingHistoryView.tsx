import { useMemo } from 'react';
import { useLanguage } from '../i18n/languageStore';
import { useGenesisState, useTradingStats } from '../state/genesisStore';

function exportToCsv(rows: ReturnType<typeof buildRows>) {
  const header = 'Agent,Market,Outcome,Entry,Exit,PnL,Opened,Closed\n';
  const body = rows.map((r) =>
    [r.agentName, r.question, r.outcome, r.entryPrice.toFixed(3), r.exitPrice?.toFixed(3) ?? '—',
     r.pnl?.toFixed(2) ?? '—', r.openedAt, r.closedAt ?? '—'].join(',')
  ).join('\n');
  const blob = new Blob([header + body], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `genesis-trades-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildRows(closedPositions: ReturnType<typeof useGenesisState>['closedPositions'], agentMap: Record<string, string>) {
  return [...closedPositions]
    .sort((a, b) => (b.closedAt ?? '').localeCompare(a.closedAt ?? ''))
    .map((p) => ({
      id: p.id,
      agentName: agentMap[p.agentId] ?? p.agentId,
      question: p.question.en,
      outcome: p.outcome,
      entryPrice: p.entryPrice,
      exitPrice: p.exitPrice,
      pnl: p.pnl,
      openedAt: new Date(p.openedAt).toLocaleString(),
      closedAt: p.closedAt ? new Date(p.closedAt).toLocaleString() : undefined,
    }));
}

export default function TradingHistoryView() {
  const lang = useLanguage();
  const state = useGenesisState();
  const stats = useTradingStats();

  const agentMap = useMemo(
    () => Object.fromEntries(Object.values(state.agents).map((a) => [a.id, a.name])),
    [state.agents]
  );
  const rows = useMemo(() => buildRows(state.closedPositions, agentMap), [state.closedPositions, agentMap]);

  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 font-mono text-[12px] text-zinc-500">
        {lang === 'es' ? 'Sin trades cerrados aún.' : 'No closed trades yet.'}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-4 pt-3">
        <div className="flex gap-4 font-mono text-[11px]">
          <span className="text-zinc-500">{lang === 'es' ? 'Trades' : 'Trades'}: <span className="text-zinc-200">{stats.totalTrades}</span></span>
          <span className="text-zinc-500">Win rate: <span style={{ color: '#ffd24a' }}>{(stats.winRate * 100).toFixed(0)}%</span></span>
          <span className="text-zinc-500">P&L: <span style={{ color: stats.totalPnL >= 0 ? '#00ff9c' : '#ff4757' }}>
            {stats.totalPnL >= 0 ? '+' : ''}${stats.totalPnL.toFixed(2)}
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
              <th className="px-3 py-2 text-right">{lang === 'es' ? 'Salida' : 'Exit'}</th>
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
                    style={{ color: r.outcome === 'YES' ? '#00ff9c' : '#ff4757', border: `1px solid currentColor` }}
                  >
                    {r.outcome}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-zinc-400">${r.entryPrice.toFixed(3)}</td>
                <td className="px-3 py-2 text-right text-zinc-400">{r.exitPrice !== undefined ? `$${r.exitPrice.toFixed(3)}` : '—'}</td>
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
