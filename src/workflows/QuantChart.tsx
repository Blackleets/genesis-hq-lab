// QuantChart.tsx — TradingView Lightweight Charts (v5) candlestick chart with
// the paper bot's real trade markers. Data: /api/genesis/candles (real Binance
// klines) + trades from /api/genesis/live. No fabricated data.

import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  createSeriesMarkers,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';

export interface ChartCandle { time: number; open: number; high: number; low: number; close: number }
export interface ChartTrade {
  openedAt: string;
  closedAt: string;
  side: string;
  entry: number;
  exit: number;
  reason: string;
  pnlUsd?: number;
}

interface Props {
  candles: ChartCandle[];
  trades?: ChartTrade[];
  height?: number;
}

const CARBON_BG = '#0a0c12';
const GRID = '#1a1d24';
const TEXT = '#e6edf3';

type MarkerTime = number & { [Symbol.species]: 'UTCTimestamp' };
const asMarker = (t: number) => t as MarkerTime;

function toMarkerTime(iso: string, fallback: number): MarkerTime {
  const t = Math.floor(new Date(iso).getTime() / 1000);
  return asMarker(Number.isFinite(t) && t > 0 ? t : fallback);
}

function snapTime(time: MarkerTime, times: number[], round: 'down' | 'up'): MarkerTime {
  if (times.length === 0) return time;
  for (const t of times) {
    if (round === 'up' ? t >= time : t <= time) return asMarker(t);
  }
  return asMarker(times[round === 'up' ? times.length - 1 : 0]);
}

export default function QuantChart({ candles, trades = [], height = 320 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: CARBON_BG },
        textColor: TEXT,
        fontSize: 11,
      },
      grid: {
        vertLines: { color: GRID },
        horzLines: { color: GRID },
      },
      timeScale: { borderColor: GRID },
      rightPriceScale: { borderColor: GRID },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#14b8a6',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#14b8a6',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;
    series.setData(candles.map(c => ({ ...c, time: c.time as UTCTimestamp })));
    chartRef.current?.timeScale().fitContent();

    // Trade markers: entry (open) and exit (close) of each real paper trade.
    const times = candles.map(c => c.time);
    const markers = [];
    for (const t of trades) {
      const entryT = asMarker(snapTime(toMarkerTime(t.openedAt, times[0]), times, 'down'));
      const exitT = asMarker(snapTime(toMarkerTime(t.closedAt, times[times.length - 1]), times, 'up'));
      const long = t.side === 'long';
      const pnl = t.pnlUsd ?? 0;
      markers.push({
        time: entryT,
        position: 'belowBar' as const,
        color: long ? '#34d399' : '#2dd4bf',
        shape: 'arrowUp' as const,
        text: `${long ? 'L' : 'S'} @${t.entry}`,
      });
      markers.push({
        time: exitT,
        position: 'aboveBar' as const,
        color: pnl > 0 ? '#22d3ee' : '#94a3b8',
        shape: long ? 'arrowDown' as const : 'arrowUp' as const,
        text: `${t.reason} ${pnl > 0 ? '+' : ''}${pnl.toFixed(2)}`,
      });
    }
    markers.sort((a, b) => a.time - b.time);
    createSeriesMarkers(series, markers);
  }, [candles, trades]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
