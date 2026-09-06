// QuantChart.tsx — TradingView Lightweight Charts (v5) candlestick chart with
// verified paper futures markers and open-position risk levels. No fabricated data.

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
  closedAt?: string | null;
  side: string;
  entry: number;
  exit?: number | null;
  reason?: string | null;
  pnlUsd?: number | null;
  target?: number | null;
  stop?: number | null;
  status?: 'open' | 'closed';
  leverage?: number | null;
}

interface Props {
  candles: ChartCandle[];
  trades?: ChartTrade[];
  height?: number;
}

const CARBON_BG = '#0a0c12';
const GRID = '#1a1d24';
const TEXT = '#cbd5e1';

function toTimestamp(iso: string, fallback: number): UTCTimestamp {
  const value = Math.floor(Date.parse(iso) / 1000);
  return (Number.isFinite(value) && value > 0 ? value : fallback) as UTCTimestamp;
}

function snapToCandle(time: number, times: number[], direction: 'down' | 'up'): UTCTimestamp {
  if (!times.length) return time as UTCTimestamp;
  if (direction === 'down') {
    for (let index = times.length - 1; index >= 0; index--) {
      if (times[index] <= time) return times[index] as UTCTimestamp;
    }
    return times[0] as UTCTimestamp;
  }
  for (const candidate of times) {
    if (candidate >= time) return candidate as UTCTimestamp;
  }
  return times[times.length - 1] as UTCTimestamp;
}

function priceLabel(value: number) {
  if (!Number.isFinite(value)) return '—';
  return value < 1 ? value.toFixed(5) : value < 100 ? value.toFixed(3) : value.toFixed(2);
}

export default function QuantChart({ candles, trades = [], height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers> | null>(null);

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
      crosshair: {
        vertLine: { color: '#475569', labelBackgroundColor: '#111827' },
        horzLine: { color: '#475569', labelBackgroundColor: '#111827' },
      },
      timeScale: { borderColor: GRID, timeVisible: true, secondsVisible: false },
      rightPriceScale: { borderColor: GRID, scaleMargins: { top: 0.08, bottom: 0.08 } },
      autoSize: true,
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    chartRef.current = chart;
    seriesRef.current = series;
    markersRef.current = createSeriesMarkers(series, []);
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;

    series.setData(candles.map((candle) => ({ ...candle, time: candle.time as UTCTimestamp })));
    chartRef.current?.timeScale().fitContent();

    const times = candles.map((candle) => candle.time).sort((a, b) => a - b);
    const markers: Array<{
      time: UTCTimestamp;
      position: 'aboveBar' | 'belowBar';
      color: string;
      shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
      text: string;
    }> = [];

    for (const trade of trades) {
      if (!trade.openedAt || !Number.isFinite(trade.entry)) continue;
      const isLong = String(trade.side).toUpperCase() === 'LONG';
      const entryTime = snapToCandle(toTimestamp(trade.openedAt, times[0]), times, 'down');
      markers.push({
        time: entryTime,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: isLong ? '#34d399' : '#fb7185',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: `${isLong ? 'LONG' : 'SHORT'} ${priceLabel(trade.entry)}`,
      });

      if (trade.status !== 'open' && trade.closedAt && trade.exit != null && Number.isFinite(trade.exit)) {
        const exitTime = snapToCandle(toTimestamp(trade.closedAt, times[times.length - 1]), times, 'up');
        const pnl = trade.pnlUsd;
        const positive = typeof pnl === 'number' && pnl > 0;
        const negative = typeof pnl === 'number' && pnl < 0;
        markers.push({
          time: exitTime,
          position: isLong ? 'aboveBar' : 'belowBar',
          color: positive ? '#22d3ee' : negative ? '#f87171' : '#94a3b8',
          shape: 'circle',
          text: `${(trade.reason || 'EXIT').toUpperCase()}${typeof pnl === 'number' ? ` ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : ''}`,
        });
      }
    }

    markers.sort((a, b) => Number(a.time) - Number(b.time));
    markersRef.current?.setMarkers(markers);

    const active = trades.find((trade) => trade.status === 'open');
    const priceLines = [];
    if (active && Number.isFinite(active.entry)) {
      priceLines.push(series.createPriceLine({
        price: active.entry,
        color: '#22d3ee',
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title: `ENTRY${active.leverage ? ` ${active.leverage}x` : ''}`,
      }));
      if (active.target != null && Number.isFinite(active.target)) {
        priceLines.push(series.createPriceLine({
          price: active.target,
          color: '#34d399',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'TP',
        }));
      }
      if (active.stop != null && Number.isFinite(active.stop)) {
        priceLines.push(series.createPriceLine({
          price: active.stop,
          color: '#f87171',
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: 'SL',
        }));
      }
    }

    return () => {
      for (const line of priceLines) series.removePriceLine(line);
    };
  }, [candles, trades]);

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
