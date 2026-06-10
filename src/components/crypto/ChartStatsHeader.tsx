import { useEffect, useRef, useState } from 'react';
import type { ChartTickerStats } from '@services/chartTicker';

const C = { up: '#16c784', down: '#ea3943', ema9: '#3b82f6', ema21: '#f59e0b' };

function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '-';
  return n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 4 : 2 });
}

function fmtVol(n: number): string {
  if (!Number.isFinite(n)) return '-';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function Change({ label, value }: { label: string; value: number | null | undefined }) {
  const up = (value ?? 0) >= 0;
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-zinc-600">{label}</span>
      <span
        className="font-mono text-[11px] font-bold tabular-nums"
        style={{ color: value == null ? '#6b7280' : up ? C.up : C.down }}
      >
        {value == null ? '-' : `${up ? '+' : ''}${value.toFixed(2)}%`}
      </span>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-start leading-tight">
      <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-zinc-600">{label}</span>
      <span className="font-mono text-[11px] font-bold text-zinc-300 tabular-nums">{value}</span>
    </div>
  );
}

interface Props {
  pairs: string[];
  intervals: string[];
  pair: string;
  tf: string;
  symbol: string;
  livePrice: number | null;
  stats: ChartTickerStats | null;
  loading: boolean;
  showEma9: boolean;
  showEma21: boolean;
  showTrades: boolean;
  showEntries: boolean;
  showExits: boolean;
  showLabels: boolean;
  visibleTradeCount: number;
  onPair: (p: string) => void;
  onTf: (tf: string) => void;
  onToggleEma9: () => void;
  onToggleEma21: () => void;
  onToggleTrades: () => void;
  onToggleEntries: () => void;
  onToggleExits: () => void;
  onToggleLabels: () => void;
}

export function ChartStatsHeader({
  pairs,
  intervals,
  pair,
  tf,
  symbol,
  livePrice,
  stats,
  loading,
  showEma9,
  showEma21,
  showTrades,
  showEntries,
  showExits,
  showLabels,
  visibleTradeCount,
  onPair,
  onTf,
  onToggleEma9,
  onToggleEma21,
  onToggleTrades,
  onToggleEntries,
  onToggleExits,
  onToggleLabels,
}: Props) {
  const price = livePrice ?? stats?.price ?? null;
  const change24h = stats?.change24h ?? null;
  const up24 = (change24h ?? 0) >= 0;
  const previousPrice = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (price == null) return;
    if (previousPrice.current != null && price !== previousPrice.current) {
      setFlash(price > previousPrice.current ? 'up' : 'down');
      const id = window.setTimeout(() => setFlash(null), 450);
      previousPrice.current = price;
      return () => window.clearTimeout(id);
    }
    previousPrice.current = price;
  }, [price]);

  return (
    <div className="border-b border-zinc-800 bg-[#0b0e11]">
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {pairs.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onPair(p)}
              className={`font-mono text-[11px] px-2.5 py-1 rounded transition-colors ${
                pair === p ? 'bg-zinc-700/80 text-zinc-50 font-bold' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {p.replace('USDT', '')}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
          <div className="flex items-center gap-1 rounded border border-[#1f2937] bg-[#11151c] px-2 py-1">
            <span className="font-mono text-[8px] uppercase tracking-[0.16em] text-zinc-600">Events</span>
            <span className="font-mono text-[10px] font-bold text-zinc-200">{visibleTradeCount}</span>
          </div>

          <div className="flex gap-0.5 rounded bg-[#11151c] p-0.5">
            {intervals.map((iv) => (
              <button
                key={iv}
                type="button"
                onClick={() => onTf(iv)}
                className={`font-mono text-[10px] px-2 py-1 rounded transition-colors ${
                  tf === iv ? 'text-zinc-50 bg-zinc-700/80 font-bold' : 'text-zinc-500 hover:text-zinc-300'
                }`}
              >
                {iv === '1d' ? '1D' : iv}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-end gap-4 px-3 pb-2.5 flex-wrap">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-mono text-[12px] font-bold text-zinc-400 shrink-0">
            {symbol}<span className="text-zinc-600">/USDT</span>
          </span>
          <span
            className={`font-mono text-[22px] md:text-[26px] font-bold tabular-nums leading-none rounded px-1 -mx-1 transition-colors duration-300 ${
              flash === 'up'
                ? 'bg-emerald-400/15 text-emerald-300'
                : flash === 'down'
                  ? 'bg-rose-400/15 text-rose-300'
                  : 'text-zinc-50'
            }`}
          >
            ${fmtPrice(price)}
          </span>
          <span
            className="font-mono text-[11px] font-bold tabular-nums"
            style={{ color: change24h == null ? '#6b7280' : up24 ? C.up : C.down }}
          >
            {change24h == null ? '' : `${up24 ? '+' : ''}${change24h.toFixed(2)}%`}
          </span>
        </div>

        <div className="flex items-center gap-x-4 gap-y-2 ml-auto flex-wrap justify-end">
          <Change label="1h" value={stats?.change1h} />
          <Change label="24h" value={stats?.change24h} />
          <div className="h-6 w-px bg-zinc-800 hidden md:block" />
          <StatChip label="Vol 24h" value={stats ? fmtVol(stats.quoteVol24h) : '-'} />
          <StatChip label="High 24h" value={stats ? `$${fmtPrice(stats.high24h)}` : '-'} />
          <StatChip label="Low 24h" value={stats ? `$${fmtPrice(stats.low24h)}` : '-'} />
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 pb-2 text-[9px] font-mono border-t border-zinc-800/50 pt-1.5 flex-wrap">
        <button
          type="button"
          onClick={onToggleEma9}
          className={`transition-opacity ${showEma9 ? 'opacity-100' : 'opacity-35'}`}
          style={{ color: C.ema9 }}
          aria-pressed={showEma9}
        >
          EMA 9
        </button>
        <button
          type="button"
          onClick={onToggleEma21}
          className={`transition-opacity ${showEma21 ? 'opacity-100' : 'opacity-35'}`}
          style={{ color: C.ema21 }}
          aria-pressed={showEma21}
        >
          EMA 21
        </button>
        <span className="text-zinc-700">Vol</span>
        <button
          type="button"
          onClick={onToggleTrades}
          className={`rounded border px-1.5 py-0.5 transition-colors ${
            showTrades
              ? 'border-zinc-500 bg-zinc-800/80 text-zinc-100'
              : 'border-zinc-800 bg-transparent text-zinc-500 hover:text-zinc-300'
          }`}
          aria-pressed={showTrades}
        >
          Trades
        </button>
        <button
          type="button"
          onClick={onToggleEntries}
          className={`rounded border px-1.5 py-0.5 transition-colors ${
            showEntries
              ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-300'
              : 'border-zinc-800 bg-transparent text-zinc-500 hover:text-zinc-300'
          }`}
          aria-pressed={showEntries}
        >
          Entries
        </button>
        <button
          type="button"
          onClick={onToggleExits}
          className={`rounded border px-1.5 py-0.5 transition-colors ${
            showExits
              ? 'border-amber-500/60 bg-amber-500/10 text-amber-300'
              : 'border-zinc-800 bg-transparent text-zinc-500 hover:text-zinc-300'
          }`}
          aria-pressed={showExits}
        >
          Exits
        </button>
        <button
          type="button"
          onClick={onToggleLabels}
          className={`rounded border px-1.5 py-0.5 transition-colors ${
            showLabels
              ? 'border-sky-500/60 bg-sky-500/10 text-sky-300'
              : 'border-zinc-800 bg-transparent text-zinc-500 hover:text-zinc-300'
          }`}
          aria-pressed={showLabels}
        >
          Labels
        </button>
        <span className="ml-auto text-zinc-600 tabular-nums">
          {loading ? <span className="animate-pulse">Loading {symbol}...</span> : `${symbol}/USDT - ${tf === '1d' ? '1D' : tf}`}
        </span>
      </div>
    </div>
  );
}
