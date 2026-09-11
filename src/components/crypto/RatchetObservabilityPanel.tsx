import { useEffect, useMemo, useState } from 'react';
import { Activity, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';

interface RatchetTrade {
  tradeId: string;
  strategyVersionId: string;
  runnerVersion: string | null;
  exitPolicyVersion: string | null;
  pair: string;
  side: string;
  entryRegime: string | null;
  entrySession: string | null;
  leverage: number | null;
  notionalUsd: number | null;
  initialStopPrice: number | null;
  currentRatchetStop: number | null;
  mfeNetUsd: number;
  maeObservedNetUsd: number | null;
  protectedFloorUsd: number;
  currentNetPnlUsd: number | null;
  realizedNetPnlUsd: number | null;
  givebackUsd: number | null;
  captureEfficiency: number | null;
  givebackPctMfe: number | null;
  protectedProfitEfficiency: number | null;
  ratchetActivated: boolean;
  ratchetRaiseCount: number;
  ratchetSaveExit: boolean;
  winnerLost: boolean;
  counterfactualWithoutRatchetProven: boolean;
  counterfactualNote: string | null;
  marketStrength: string | null;
  regime: string | null;
  momentum20: number | null;
  orderBookImbalance: number | null;
  atrPct: number | null;
  exitReason: string | null;
  openedAt: string | null;
  closedAt: string | null;
  observationCount: number;
}

interface RatchetStatus {
  ok: boolean;
  paperOnly: boolean;
  liveOrders: boolean;
  open: RatchetTrade[];
  closed: RatchetTrade[];
  summary: {
    closed: number;
    realizedPnl: number | null;
    expectancy: number | null;
    avgMfe: number | null;
    medianMfe: number | null;
    avgCaptureEfficiency: number | null;
    medianCaptureEfficiency: number | null;
    avgGivebackUsd: number | null;
    winnerLostCount: number;
    winnerLostRate: number | null;
    ratchetActivationRate: number | null;
    ratchetSaveExits: number;
    earlyDiagnosticReady: boolean;
    strongerReviewReady: boolean;
    automaticTuning: boolean;
  };
  updatedAt: string;
}

const money = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
  ? `${value < 0 ? '-' : value > 0 ? '+' : ''}$${Math.abs(value).toFixed(2)}`
  : '—';
const pct = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
  ? `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
  : '—';
const signed = (value: number | null | undefined, digits = 4) => typeof value === 'number' && Number.isFinite(value)
  ? `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`
  : '—';
const price = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('en-US', { maximumFractionDigits: value < 1 ? 6 : 2 })
  : '—';
const humanize = (value: string | null | undefined) => String(value || '—').replaceAll('_', ' ').toUpperCase();

function metricTone(value: number | null | undefined) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'text-zinc-500';
  return value > 0 ? 'text-emerald-300' : value < 0 ? 'text-red-300' : 'text-zinc-300';
}

export function RatchetObservabilityPanel({ pair, es = true }: { pair: string; es?: boolean }) {
  const [status, setStatus] = useState<RatchetStatus | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const response = await fetch('/api/genesis/ratchet-status', { cache: 'no-store' });
        if (!response.ok) throw new Error('ratchet telemetry unavailable');
        const payload = await response.json() as RatchetStatus;
        if (!payload.ok || payload.paperOnly !== true || payload.liveOrders === true) throw new Error('invalid ratchet telemetry boundary');
        if (live) { setStatus(payload); setError(false); }
      } catch {
        if (live) setError(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  const selectedOpen = useMemo(() => status?.open.find((trade) => trade.pair === pair) ?? null, [status?.open, pair]);
  const closed = useMemo(() => (status?.closed ?? []).slice(0, 6), [status?.closed]);
  const summary = status?.summary;

  return (
    <div className="border-t border-[#202736] bg-[#06090e]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#202736] px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-3.5 w-3.5 text-cyan-300" />
          <span className="font-mono text-[8px] uppercase tracking-[.18em] text-zinc-400">V9 PROFIT RATCHET OBSERVABILITY</span>
          <span className="border border-cyan-400/20 bg-cyan-400/5 px-1.5 py-0.5 font-mono text-[7px] text-cyan-300">NET ECONOMICS</span>
        </div>
        <div className={`font-mono text-[8px] ${error ? 'text-amber-300' : 'text-zinc-600'}`}>
          {error ? 'TELEMETRY DEGRADED' : `${summary?.closed ?? 0}/10 EARLY · ${summary?.closed ?? 0}/20 REVIEW`}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-[#202736] sm:grid-cols-4">
        {[
          ['V9 CLOSED', String(summary?.closed ?? 0), 'text-zinc-100'],
          ['AVG MFE', money(summary?.avgMfe), metricTone(summary?.avgMfe)],
          ['AVG CAPTURE', pct(summary?.avgCaptureEfficiency), metricTone(summary?.avgCaptureEfficiency)],
          ['WINNER LOST', String(summary?.winnerLostCount ?? 0), (summary?.winnerLostCount ?? 0) > 0 ? 'text-red-300' : 'text-zinc-200'],
        ].map(([label, value, tone]) => (
          <div key={label} className="bg-[#080b11] px-3 py-2.5">
            <div className="font-mono text-[7px] uppercase tracking-[.14em] text-zinc-600">{label}</div>
            <div className={`mt-1 font-mono text-[11px] ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      {selectedOpen ? (
        <div className="border-t border-[#202736] px-3.5 py-3">
          <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[.14em] text-cyan-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
              {selectedOpen.pair} · {selectedOpen.side} · {selectedOpen.strategyVersionId.split(':').at(-1)}
            </div>
            <div className="font-mono text-[8px] text-zinc-600">{selectedOpen.exitPolicyVersion ?? 'adaptive_profit_ratchet_v1'} · {selectedOpen.observationCount} obs</div>
          </div>
          <div className="grid grid-cols-2 gap-px overflow-hidden border border-[#1b2230] bg-[#1b2230] sm:grid-cols-5">
            {[
              ['CURRENT P&L', money(selectedOpen.currentNetPnlUsd), metricTone(selectedOpen.currentNetPnlUsd)],
              ['MFE', money(selectedOpen.mfeNetUsd), 'text-cyan-200'],
              ['PROTECTED FLOOR', money(selectedOpen.protectedFloorUsd), selectedOpen.ratchetActivated ? 'text-emerald-300' : 'text-zinc-500'],
              ['RATCHET STOP', price(selectedOpen.currentRatchetStop), selectedOpen.currentRatchetStop != null ? 'text-amber-200' : 'text-zinc-500'],
              ['CAPTURE / GIVEBACK', `${pct(selectedOpen.captureEfficiency)} / ${money(selectedOpen.givebackUsd)}`, 'text-zinc-200'],
              ['MARKET STRENGTH', humanize(selectedOpen.marketStrength), selectedOpen.marketStrength === 'STRONG' ? 'text-emerald-300' : selectedOpen.marketStrength === 'WEAK' ? 'text-red-300' : 'text-zinc-300'],
              ['REGIME', humanize(selectedOpen.regime), 'text-zinc-300'],
              ['MOMENTUM 20', signed(selectedOpen.momentum20, 5), metricTone(selectedOpen.momentum20)],
              ['ORDER BOOK IMB.', signed(selectedOpen.orderBookImbalance, 4), metricTone(selectedOpen.orderBookImbalance)],
              ['MAE OBSERVED', money(selectedOpen.maeObservedNetUsd), metricTone(selectedOpen.maeObservedNetUsd)],
            ].map(([label, value, tone]) => (
              <div key={label} className="bg-[#070a0f] px-2.5 py-2">
                <div className="font-mono text-[7px] uppercase tracking-[.1em] text-zinc-600">{label}</div>
                <div className={`mt-1 truncate font-mono text-[9px] ${tone}`}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="border-t border-[#202736] px-3.5 py-3 font-mono text-[8px] text-zinc-600">
          {es ? 'SIN POSICIÓN V9 ABIERTA EN EL PAR SELECCIONADO · LA TELEMETRÍA CERRADA SIGUE DISPONIBLE ABAJO' : 'NO OPEN V9 POSITION FOR SELECTED PAIR · CLOSED TELEMETRY REMAINS AVAILABLE BELOW'}
        </div>
      )}

      <div className="border-t border-[#202736]">
        <div className="flex h-8 items-center justify-between px-3.5">
          <span className="font-mono text-[7px] uppercase tracking-[.16em] text-zinc-600">V9 CLOSED · MFE → REALIZED</span>
          <span className="font-mono text-[7px] text-zinc-700">COUNTERFACTUAL: NOT CLAIMED</span>
        </div>
        {closed.length ? <div className="divide-y divide-[#151b25] border-t border-[#151b25]">{closed.map((trade) => (
          <div key={trade.tradeId} className={`flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 ${trade.winnerLost ? 'bg-red-500/[.045]' : ''}`}>
            <div className="flex min-w-0 items-center gap-2">
              {trade.winnerLost ? <TrendingDown className="h-3.5 w-3.5 shrink-0 text-red-300" /> : <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />}
              <span className="font-mono text-[9px] text-zinc-300">{trade.pair}</span>
              <span className="font-mono text-[8px] text-zinc-600">{humanize(trade.exitReason)}</span>
              {trade.winnerLost && <span className="border border-red-400/30 bg-red-400/5 px-1.5 py-0.5 font-mono text-[7px] text-red-300">WINNER LOST</span>}
              {trade.ratchetSaveExit && <span className="inline-flex items-center gap-1 border border-emerald-400/20 bg-emerald-400/5 px-1.5 py-0.5 font-mono text-[7px] text-emerald-300"><ShieldCheck className="h-2.5 w-2.5" /> RATCHET EXIT</span>}
            </div>
            <div className={`font-mono text-[9px] ${trade.winnerLost ? 'text-red-300' : 'text-zinc-200'}`}>
              {money(trade.mfeNetUsd)} MFE → {money(trade.realizedNetPnlUsd)} realized · {pct(trade.captureEfficiency)} captured
            </div>
          </div>
        ))}</div> : <div className="border-t border-[#151b25] px-3.5 py-4 text-center font-mono text-[8px] text-zinc-600">NO V9 CLOSED TRADES YET · EXIT EDGE REMAINS INSUFFICIENT EVIDENCE</div>}
      </div>
    </div>
  );
}
