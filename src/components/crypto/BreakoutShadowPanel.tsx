import type { BreakoutShadowDiagnostics, BreakoutShadowMetrics } from '@services/cryptoClient';

const PANEL_BG = '#0a0f08';
const PANEL_BORDER = '#1c2a17';

const usd = (n: number | null | undefined) =>
  n == null ? '—' : `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`;
const pf = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2));
const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(0)}%`);

function evColor(ev: number) {
  return ev > 0 ? '#22c55e' : ev < 0 ? '#ef4444' : '#9ca3af';
}

function MetricRow({ label, m, es }: { label: string; m: BreakoutShadowMetrics; es: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-[#0c1409] px-2 py-1.5 font-mono text-[10px]">
      <span className="w-14 shrink-0 text-zinc-400">{label}</span>
      <span className="text-zinc-500">{m.trades}{es ? ' ops' : ' trd'}</span>
      <span className="text-zinc-400">WR {pct(m.winRate)}</span>
      <span style={{ color: evColor(m.expectancy) }}>EV ${m.expectancy.toFixed(2)}</span>
      <span style={{ color: (m.profitFactor ?? 0) >= 1 ? '#22c55e' : '#ef4444' }}>PF {pf(m.profitFactor)}</span>
    </div>
  );
}

const REGIME_COLOR: Record<string, string> = {
  bull: '#22c55e', bear: '#ef4444', range: '#9ca3af', unknown: '#6b7280',
};

export function BreakoutShadowPanel({
  shadow,
  es,
}: {
  shadow: BreakoutShadowDiagnostics | null;
  es: boolean;
}) {
  if (!shadow) {
    return (
      <div style={{ background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: 10 }}>
        <div className="font-mono text-[9px] uppercase tracking-wider text-green-400">
          {es ? 'Breakout 4h (sombra)' : 'Breakout 4h (shadow)'}
        </div>
        <div className="mt-2 font-mono text-[10px] text-zinc-600">
          {es ? 'Sin respuesta del backend.' : 'Backend did not return shadow data.'}
        </div>
      </div>
    );
  }

  const c = shadow.config;

  return (
    <div style={{ background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: 10 }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-green-400">
            {es ? 'Breakout 4h — edge validado' : 'Breakout 4h — validated edge'}
          </div>
          <div className="mt-1 font-mono text-[10px] text-zinc-500">
            SMA{c.regimeSmaPeriod} · Donchian{c.breakoutPeriod} · TP{(c.targetPct * 100).toFixed(0)}%/SL{(c.stopPct * 100).toFixed(0)}% · {c.pairs.join('/')}
          </div>
        </div>
        <span
          className="rounded border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.18em]"
          style={{ color: '#22c55e', borderColor: '#14532d', background: '#052e16' }}
        >
          {es ? 'observando' : 'observing'}
        </span>
      </div>

      {/* Rolling-window metrics (live data) */}
      <div className="mt-3 space-y-1">
        <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? `Ventana ${shadow.window.from ?? '—'} → ${shadow.window.to ?? '—'}` : `Window ${shadow.window.from ?? '—'} → ${shadow.window.to ?? '—'}`}
        </div>
        <MetricRow label={es ? 'Total' : 'Combined'} m={shadow.combined} es={es} />
        <MetricRow label="Short" m={shadow.short} es={es} />
        <MetricRow label="Long" m={shadow.long} es={es} />
      </div>

      {/* Current regime + live signal per pair */}
      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Régimen actual' : 'Current regime'}
        </div>
        <div className="space-y-1">
          {shadow.current.map((row) => (
            <div key={row.pair} className="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span className="w-16 text-zinc-300">{row.pair}</span>
              <span style={{ color: REGIME_COLOR[row.regime] ?? '#9ca3af' }} className="uppercase">{row.regime}</span>
              <span className="text-zinc-600">
                ${row.price != null ? row.price.toLocaleString() : '—'} / SMA ${row.sma != null ? row.sma.toLocaleString() : '—'}
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[9px]"
                style={{
                  color: row.signalNow ? '#0a0f08' : '#6b7280',
                  background: row.signalNow === 'LONG' ? '#22c55e' : row.signalNow === 'SHORT' ? '#ef4444' : 'transparent',
                  border: row.signalNow ? 'none' : '1px solid #1c2a17',
                }}
              >
                {row.signalNow ?? (es ? 'sin señal' : 'no signal')}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Per-pair contribution */}
      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Por par (ventana)' : 'By pair (window)'}
        </div>
        <div className="space-y-1">
          {shadow.byPair.map((row) => (
            <div key={row.pair} className="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span className="w-16 text-zinc-300">{row.pair}</span>
              <span className="text-zinc-600">{row.trades}{es ? ' ops' : ' trd'}</span>
              <span className="text-zinc-500">WR {pct(row.winRate)}</span>
              <span style={{ color: evColor(row.netPnl) }}>{usd(row.netPnl)}</span>
              <span style={{ color: (row.profitFactor ?? 0) >= 1 ? '#22c55e' : '#ef4444' }}>PF {pf(row.profitFactor)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 rounded bg-[#0c1409] px-2 py-1.5 font-mono text-[9px] leading-relaxed text-zinc-600">
        {es
          ? 'Observación read-only sobre klines 4h reales. El motor en vivo (breakout_v1) abre en paper cuando hay breakout in-regime. Nunca ejecuta desde este panel.'
          : 'Read-only observation on real 4h klines. The live engine (breakout_v1) opens paper trades on an in-regime breakout. This panel never executes.'}
      </div>
    </div>
  );
}
