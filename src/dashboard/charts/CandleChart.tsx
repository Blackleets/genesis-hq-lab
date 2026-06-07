import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import type { UTCTimestamp, ISeriesApi, SeriesType } from 'lightweight-charts';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAIRS     = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
// Binance API uses lowercase intervals: 1m 5m 15m 1h 4h 1d
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
const C = { up: '#00ff9c', down: '#ff4757', ema9: '#3da9fc', ema21: '#f59e0b' };

// Binance public REST — CORS allowed from browser, no key needed
const BINANCE = 'https://api.binance.com/api/v3';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Candle {
  time: UTCTimestamp;
  open: number; high: number; low: number; close: number; volume: number;
}

export interface AgentPosition {
  id: string; pair: string; side: string;
  entry_price: number; target_price: number; stop_price: number;
  capital_used: number; opened_at: string;
}

interface Props {
  positions?: AgentPosition[];
  onManualOrder?: (side: 'LONG' | 'SHORT', pair: string) => void;
}

// ─── EMA helper ───────────────────────────────────────────────────────────────

function ema(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = closes[0] ?? 0;
  for (const c of closes) { const v = c * k + prev * (1 - k); out.push(v); prev = v; }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CandleChart({ positions = [], onManualOrder }: Props) {
  const wrapRef  = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  // Keep series in refs so we only create them once
  const csRef  = useRef<ISeriesApi<SeriesType> | null>(null);
  const e9Ref  = useRef<ISeriesApi<SeriesType> | null>(null);
  const e21Ref = useRef<ISeriesApi<SeriesType> | null>(null);
  const volRef = useRef<ISeriesApi<SeriesType> | null>(null);

  const [pair, setPair]         = useState('BTCUSDT');
  const [tf, setTf]             = useState('1h');
  const [price, setPrice]       = useState<number | null>(null);
  const [change, setChange]     = useState(0);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  // ── Create chart + series ONCE ──────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current) return;

    const chart = createChart(wrapRef.current, {
      layout:    { background: { color: '#0d0d0f' }, textColor: '#71717a' },
      grid:      { vertLines: { color: '#1c1c22' }, horzLines: { color: '#1c1c22' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale:       { borderColor: '#27272a', timeVisible: true },
      width:  wrapRef.current.clientWidth,
      height: wrapRef.current.clientHeight || 380,
    });
    chartRef.current = chart;

    // Candlestick
    csRef.current = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down,
      borderUpColor: C.up, borderDownColor: C.down,
      wickUpColor: C.up, wickDownColor: C.down,
    });

    // EMA 9
    e9Ref.current = chart.addSeries(LineSeries, {
      color: C.ema9, lineWidth: 1, crosshairMarkerVisible: false,
    });

    // EMA 21
    e21Ref.current = chart.addSeries(LineSeries, {
      color: C.ema21, lineWidth: 1, crosshairMarkerVisible: false,
    });

    // Volume (separate price scale)
    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    // Responsive width + height — chart fills its container cell
    const ro = new ResizeObserver(() => {
      if (wrapRef.current) chart.applyOptions({
        width:  wrapRef.current.clientWidth,
        height: wrapRef.current.clientHeight || 380,
      });
    });
    ro.observe(wrapRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);

  // ── Load candles whenever pair or tf changes ────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!chartRef.current || !csRef.current) return;
      setLoading(true);
      setError(null);
      try {
        const limit = tf === '1m' ? 300 : 200;
        const r = await fetch(
          `${BINANCE}/klines?symbol=${pair}&interval=${tf}&limit=${limit}`,
          { signal: AbortSignal.timeout(8000) }
        );
        if (!r.ok) throw new Error(`Binance HTTP ${r.status}`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: any[] = await r.json();
        if (cancelled) return;

        const candles: Candle[] = raw.map(k => ({
          time:   Math.floor(k[0] / 1000) as UTCTimestamp,
          open:   parseFloat(k[1]),
          high:   parseFloat(k[2]),
          low:    parseFloat(k[3]),
          close:  parseFloat(k[4]),
          volume: parseFloat(k[5]),
        }));

        const closes = candles.map(c => c.close);
        const ema9  = ema(closes, 9);
        const ema21 = ema(closes, 21);

        // Update all series data
        csRef.current!.setData(candles);
        e9Ref.current!.setData(candles.map((c, i) => ({ time: c.time, value: ema9[i] })));
        e21Ref.current!.setData(candles.map((c, i) => ({ time: c.time, value: ema21[i] })));
        volRef.current!.setData(candles.map(c => ({
          time:  c.time,
          value: c.volume,
          color: c.close >= c.open ? C.up + '55' : C.down + '55',
        })));

        chartRef.current!.timeScale().fitContent();

        // Price = last close; % change = 24h (last 24 candles for 1h, else first vs last)
        const last = candles[candles.length - 1];
        setPrice(last.close);
        const refIdx = tf === '1h' ? Math.max(0, candles.length - 24)
                     : tf === '4h' ? Math.max(0, candles.length - 6)
                     : tf === '1d' ? Math.max(0, candles.length - 1)
                     : 0;
        const ref24h = candles[refIdx].open;
        setChange(((last.close - ref24h) / ref24h) * 100);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    // Small delay to let the chart render first
    const init = setTimeout(() => void load(), 100);
    const poll  = setInterval(() => void load(), 60_000);

    return () => { cancelled = true; clearTimeout(init); clearInterval(poll); };
  }, [pair, tf]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const symbol   = pair.replace('USDT', '');
  const isUp     = change >= 0;
  const myPos    = positions.filter(p => p.pair === pair);

  return (
    <div className="gx-card overflow-hidden h-full flex flex-col min-h-0">

      {/* ── Top bar: pairs + price + timeframes ─────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-800 flex-wrap">
        {/* Pair tabs */}
        <div className="flex gap-1">
          {PAIRS.map(p => (
            <button key={p} onClick={() => setPair(p)}
              className={`font-mono text-[11px] px-2.5 py-1 rounded transition-colors
                ${pair === p
                  ? 'bg-zinc-700 text-zinc-100 font-bold'
                  : 'text-zinc-500 hover:text-zinc-300'}`}>
              {p.replace('USDT', '')}
            </button>
          ))}
        </div>

        {/* Live price */}
        {price !== null && (
          <div className="flex items-baseline gap-1.5 ml-3">
            <span className="font-mono text-[18px] font-bold text-zinc-100 tabular-nums">
              ${price.toLocaleString('en-US', { maximumFractionDigits: price < 10 ? 4 : 2 })}
            </span>
            <span className={`font-mono text-[11px] font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(2)}%
            </span>
          </div>
        )}

        {/* Timeframe selector */}
        <div className="flex gap-1 ml-auto">
          {INTERVALS.map(iv => (
            <button key={iv} onClick={() => setTf(iv)}
              className={`font-mono text-[10px] px-2 py-1 rounded transition-colors
                ${tf === iv
                  ? 'text-emerald-400 bg-emerald-400/10 border border-emerald-400/30'
                  : 'text-zinc-600 hover:text-zinc-400'}`}>
              {iv === '1d' ? '1D' : iv}
            </button>
          ))}
        </div>
      </div>

      {/* ── Indicator legend ────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b border-zinc-800/60 text-[9px] font-mono">
        <span style={{ color: C.ema9 }}>● EMA 9</span>
        <span style={{ color: C.ema21 }}>● EMA 21</span>
        <span className="text-zinc-700">▌ Vol</span>
        <span className="ml-auto text-zinc-600 tabular-nums">
          {loading
            ? <span className="animate-pulse">Cargando {symbol}…</span>
            : `${symbol}/USDT · ${tf === '1d' ? '1D' : tf}`}
        </span>
      </div>

      {/* ── Error state ─────────────────────────────────────────────────── */}
      {error && (
        <div className="px-4 py-2 font-mono text-[10px] text-rose-400 border-b border-zinc-800/60 bg-rose-500/5">
          ✗ {error}
        </div>
      )}

      {/* ── Agent position badges ────────────────────────────────────────── */}
      {myPos.length > 0 && (
        <div className="flex gap-2 px-4 py-2 border-b border-zinc-800/60 flex-wrap">
          {myPos.map(pos => (
            <div key={pos.id}
              className={`flex items-center gap-2 px-2 py-1 rounded border text-[10px] font-mono
                ${pos.side === 'LONG'
                  ? 'border-emerald-500/40 bg-emerald-500/5 text-emerald-400'
                  : 'border-rose-500/40 bg-rose-500/5 text-rose-400'}`}>
              <span className="font-bold">●{pos.side}</span>
              <span className="text-zinc-400">
                ${pos.entry_price.toLocaleString()} → TP ${pos.target_price.toLocaleString()} · SL ${pos.stop_price.toLocaleString()}
              </span>
              <span className="text-zinc-600">${pos.capital_used}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Chart canvas — flex-fills the remaining card height ─────────── */}
      <div ref={wrapRef} className="w-full flex-1 min-h-0" style={{ minHeight: 200 }} />

      {/* ── Manual order panel ──────────────────────────────────────────── */}
      {onManualOrder && (
        <div className="border-t border-zinc-800 px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[12px] text-zinc-300 font-bold">{symbol}/USDT</div>
            <div className="font-mono text-[10px] text-zinc-600">$100 · paper trade · ejecución inmediata</div>
          </div>
          <button
            onClick={() => onManualOrder('LONG', pair)}
            className="font-mono text-[13px] font-bold px-6 py-2.5 rounded
              bg-emerald-500 hover:bg-emerald-400 active:scale-95
              text-black transition-all">
            Long ▲
          </button>
          <button
            onClick={() => onManualOrder('SHORT', pair)}
            className="font-mono text-[13px] font-bold px-6 py-2.5 rounded
              bg-rose-500 hover:bg-rose-400 active:scale-95
              text-white transition-all">
            Short ▼
          </button>
        </div>
      )}
    </div>
  );
}
