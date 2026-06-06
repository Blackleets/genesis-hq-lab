import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import type { UTCTimestamp } from 'lightweight-charts';
import { apiUrl } from '@services/apiBase';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1D'];
const COLORS = { up: '#00ff9c', down: '#ff4757', ema9: '#3da9fc', ema21: '#f59e0b' };

interface Candle {
  time: UTCTimestamp;
  open: number; high: number; low: number; close: number; volume: number;
}
interface AgentPosition { side: string; entry_price: number; target_price: number; stop_price: number; opened_at: string; pair: string; capital_used: number; id: string; }

function computeEma(closes: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = closes[0];
  for (const c of closes) { const v = c * k + prev * (1 - k); out.push(v); prev = v; }
  return out;
}

interface Props {
  positions?: AgentPosition[];
  onManualOrder?: (side: 'LONG' | 'SHORT', pair: string) => void;
}

export default function CandleChart({ positions = [], onManualOrder }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const [pair, setPair] = useState('BTCUSDT');
  const [interval, setIntervalVal] = useState('1h');
  const [price, setPrice] = useState<number | null>(null);
  const [change, setChange] = useState(0);
  const [loading, setLoading] = useState(true);

  // Create chart once
  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: { background: { color: '#0d0d0f' }, textColor: '#71717a' },
      grid: { vertLines: { color: '#1c1c22' }, horzLines: { color: '#1c1c22' } },
      rightPriceScale: { borderColor: '#27272a' },
      timeScale: { borderColor: '#27272a', timeVisible: true },
      width: containerRef.current.clientWidth,
      height: 380,
    });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    ro.observe(containerRef.current);
    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, []);

  const loadCandles = useCallback(async (p: string, iv: string) => {
    if (!chartRef.current) return;
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/crypto/candles?pair=${p}&interval=${iv}&limit=200`));
      const data = await res.json();
      if (!data.ok || !chartRef.current) return;

      const chart = chartRef.current;

      // Remove all existing series via internal API (v5 has no getSeries())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const seriesList: any[] = (chart as any)._private__seriesMapReversed?.keys ? [...(chart as any)._private__seriesMapReversed.keys()] : [];
      seriesList.forEach(s => { try { chart.removeSeries(s); } catch { /* ignore */ } });

      const candles: Candle[] = data.candles.map((c: { time: number; open: number; high: number; low: number; close: number; volume: number }) => ({
        ...c, time: c.time as UTCTimestamp,
      }));

      const closes = candles.map(c => c.close);
      const ema9  = computeEma(closes, 9);
      const ema21 = computeEma(closes, 21);

      const last = candles[candles.length - 1];
      setPrice(last.close);
      setChange(((last.close - candles[0].open) / candles[0].open) * 100);

      // Candlestick
      const cs = chart.addSeries(CandlestickSeries, {
        upColor: COLORS.up, downColor: COLORS.down,
        borderUpColor: COLORS.up, borderDownColor: COLORS.down,
        wickUpColor: COLORS.up, wickDownColor: COLORS.down,
      });
      cs.setData(candles);

      // EMA 9
      chart.addSeries(LineSeries, { color: COLORS.ema9, lineWidth: 1 as const, title: 'EMA9', crosshairMarkerVisible: false })
          .setData(candles.map((c, i) => ({ time: c.time, value: ema9[i] })));

      // EMA 21
      chart.addSeries(LineSeries, { color: COLORS.ema21, lineWidth: 1 as const, title: 'EMA21', crosshairMarkerVisible: false })
          .setData(candles.map((c, i) => ({ time: c.time, value: ema21[i] })));

      // Volume
      const vs = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'volume' });
      chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
      vs.setData(candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? COLORS.up + '44' : COLORS.down + '44',
      })));

      chart.timeScale().fitContent();
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCandles(pair, interval);
    const id = setInterval(() => void loadCandles(pair, interval), 60_000);
    return () => clearInterval(id);
  }, [pair, interval, loadCandles]);

  const symbol = pair.replace('USDT', '');
  const isUp = change >= 0;

  return (
    <div className="gx-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800 flex-wrap">
        <div className="flex gap-1">
          {PAIRS.map(p => (
            <button key={p} onClick={() => setPair(p)}
              className={`font-mono text-[11px] px-2 py-1 rounded transition-colors ${pair === p ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}>
              {p.replace('USDT', '')}
            </button>
          ))}
        </div>
        {price !== null && (
          <div className="flex items-baseline gap-2 ml-2">
            <span className="font-mono text-xl font-bold text-zinc-100">
              ${price.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            <span className={`font-mono text-[11px] font-bold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isUp ? '+' : ''}{change.toFixed(2)}%
            </span>
          </div>
        )}
        <div className="flex gap-1 ml-auto">
          {INTERVALS.map(iv => (
            <button key={iv} onClick={() => setIntervalVal(iv)}
              className={`font-mono text-[10px] px-2 py-1 rounded ${interval === iv ? 'text-emerald-400 border border-emerald-400/30' : 'text-zinc-600 hover:text-zinc-400'}`}>
              {iv}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 px-4 py-1.5 border-b border-zinc-800/50 text-[9px] font-mono">
        <span style={{ color: COLORS.ema9 }}>● EMA 9</span>
        <span style={{ color: COLORS.ema21 }}>● EMA 21</span>
        <span className="text-zinc-600">▌ VOL</span>
        {loading && <span className="text-zinc-600 ml-auto animate-pulse">Cargando…</span>}
      </div>

      {/* Agent positions overlay info */}
      {positions.filter(pos => pos.pair === pair).length > 0 && (
        <div className="flex gap-2 px-4 py-1.5 border-b border-zinc-800/50 flex-wrap">
          {positions.filter(pos => pos.pair === pair).map(pos => (
            <span key={pos.id} className={`font-mono text-[10px] px-2 py-0.5 rounded border ${pos.side === 'LONG' ? 'border-emerald-500/40 text-emerald-400' : 'border-rose-500/40 text-rose-400'}`}>
              {pos.side} ${pos.entry_price} → TP ${pos.target_price}
            </span>
          ))}
        </div>
      )}

      {/* Chart */}
      <div ref={containerRef} className="w-full" />

      {/* Manual order panel */}
      {onManualOrder && (
        <div className="border-t border-zinc-800 px-4 py-3 flex items-center gap-3">
          <div className="flex-1">
            <span className="font-mono text-[11px] text-zinc-500">Orden manual</span>
            <span className="font-mono text-[11px] text-zinc-300 ml-1 font-bold">{symbol}/USDT</span>
            <span className="font-mono text-[10px] text-zinc-600 ml-2">$100 · paper trade</span>
          </div>
          <button
            onClick={() => onManualOrder('LONG', pair)}
            className="font-mono text-[12px] font-bold px-6 py-2 rounded bg-emerald-500 hover:bg-emerald-400 text-black transition-colors">
            Long ▲
          </button>
          <button
            onClick={() => onManualOrder('SHORT', pair)}
            className="font-mono text-[12px] font-bold px-6 py-2 rounded bg-rose-500 hover:bg-rose-400 text-white transition-colors">
            Short ▼
          </button>
        </div>
      )}
    </div>
  );
}
