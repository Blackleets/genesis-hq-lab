// FuturesSummaryPanel — compact futures desk summary for the main dashboard.
// Reads the same Supabase snapshot the full Crypto Lab desk uses, but shows only
// capital + open positions in a small card. No action buttons, no "backend
// degraded" banner — those belong to the full desk view, not the dashboard.

import type { FuturesDeskSnapshot } from '@services/cryptoClient';

function usd(n: number | null | undefined) {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}
function plain(n: number | null | undefined) {
  if (n == null) return '—';
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function FuturesSummaryPanel({
  futuresDesk,
  es,
}: {
  futuresDesk: FuturesDeskSnapshot | null;
  es: boolean;
}) {
  if (!futuresDesk) {
    return (
      <div className="gx-card px-4 py-3">
        <div className="gx-overline mb-1">{es ? 'Desk de futuros' : 'Futures desk'}</div>
        <div className="font-mono text-[10px] text-zinc-600">
          {es ? 'Cargando snapshot…' : 'Loading snapshot…'}
        </div>
      </div>
    );
  }

  const cap = futuresDesk.futuresCapital;
  const positions = futuresDesk.openPositions ?? [];
  const netPnl = cap.netPnl ?? ((cap.realizedPnl ?? 0) + (cap.unrealizedPnl ?? 0));
  const paused = futuresDesk.treasury?.isPaused ?? false;

  return (
    <div className="gx-card px-4 py-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="gx-overline">{es ? 'Desk de futuros' : 'Futures desk'}</span>
        <span
          className="font-mono text-[8px] uppercase tracking-[0.18em] rounded px-1.5 py-0.5"
          style={{
            color: paused ? '#f59e0b' : '#22c55e',
            background: paused ? '#1c1917' : '#052e16',
          }}
        >
          {paused ? (es ? 'pausado' : 'paused') : 'live'}
        </span>
      </div>

      {/* Capital numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: es ? 'Equity' : 'Equity', val: plain(cap.equity), col: 'text-zinc-100' },
          { label: es ? 'Disponible' : 'Available', val: plain(cap.available), col: 'text-emerald-400' },
          { label: es ? 'Margen' : 'Margin', val: plain(cap.reservedMargin), col: 'text-amber-400' },
          { label: es ? 'PnL neto' : 'Net PnL', val: usd(netPnl), col: netPnl >= 0 ? 'text-emerald-300' : 'text-red-400' },
        ].map(({ label, val, col }) => (
          <div key={label}>
            <div className="font-mono text-[8px] text-zinc-600 uppercase tracking-wider">{label}</div>
            <div className={`font-mono text-[13px] font-semibold ${col}`}>{val}</div>
          </div>
        ))}
      </div>

      {/* Open positions */}
      <div>
        <div className="font-mono text-[8px] text-zinc-600 uppercase tracking-wider mb-1">
          {es ? `Posiciones abiertas · ${positions.length}` : `Open positions · ${positions.length}`}
        </div>
        {positions.length === 0 ? (
          <div className="font-mono text-[10px] text-zinc-700">
            {es ? 'Sin posiciones abiertas ahora.' : 'No open positions right now.'}
          </div>
        ) : (
          <ul className="space-y-1">
            {positions.slice(0, 6).map((p) => {
              const long = p.side === 'LONG';
              const pnl = p.grossMarkPnlApproxUsd;
              return (
                <li key={p.id} className="flex items-center gap-2 font-mono text-[10px]">
                  <span
                    className="inline-block px-1 rounded text-[8px] font-bold"
                    style={{ color: long ? '#052e16' : '#450a0a', background: long ? '#22c55e' : '#ef4444' }}
                  >
                    {p.side}
                  </span>
                  <span className="text-zinc-300">{p.pair}</span>
                  <span className="text-zinc-600">@{p.entryPrice ?? '—'}</span>
                  <span className="ml-auto" style={{ color: (pnl ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                    {usd(pnl)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
