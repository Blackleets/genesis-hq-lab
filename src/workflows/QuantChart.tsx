// QuantChart.tsx — TradingView Lightweight Charts (v5) candlestick chart with
// verified paper futures markers and open-position risk levels. No fabricated data.

import { useEffect, useRef } from 'react';
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  ColorType,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

export interface ChartCandle { time: number; open: number; high: number; low: number; close: number; volume?: number }
export interface ChartTrade {
  pair?: string;
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
  height?: number | string;
  seriesKey?: string;
}

const CARBON_BG = '#0a0c12';
const GRID = '#1a1d24';
const TEXT = '#cbd5e1';

function toSeconds(iso: string) {
  return Math.floor(Date.parse(iso) / 1000);
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

type LineName = 'entry' | 'target' | 'stop';

function exitVisual(reason: string | null | undefined) {
  const normalized = String(reason || '').toLowerCase();
  if (normalized === 'take_profit') return { color: '#34d399', label: 'TP' };
  if (normalized === 'stop_loss') return { color: '#f87171', label: 'SL' };
  if (normalized === 'timeout') return { color: '#fbbf24', label: 'TIME' };
  return { color: '#94a3b8', label: 'EXIT' };
}

export default function QuantChart({ candles, trades = [], height = '100%', seriesKey = 'market' }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLinesRef = useRef<Record<LineName, IPriceLine | null>>({ entry: null, target: null, stop: null });
  const seriesKeyRef = useRef<string | null>(null);
  const candleMetaRef = useRef<{ first: number; last: number; length: number } | null>(null);
  const tooltipRowsRef = useRef(new Map<number, string>());
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: Math.max(1, container.clientHeight),
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
      rightPriceScale: { borderColor: GRID, scaleMargins: { top: 0.06, bottom: 0.24 } },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderUpColor: '#26a69a',
      borderDownColor: '#ef5350',
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    });
    const volume = chart.addSeries(HistogramSeries, {
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });
    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volume;
    markersRef.current = createSeriesMarkers(series, []);

    const crosshairHandler = (param: { time?: unknown }) => {
      const tooltip = tooltipRef.current;
      if (!tooltip) return;
      const row = param.time == null ? null : tooltipRowsRef.current.get(Number(param.time));
      if (!row) {
        tooltip.hidden = true;
        return;
      }
      tooltip.textContent = row;
      tooltip.hidden = false;
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    const observer = new ResizeObserver(() => {
      if (!container.isConnected) return;
      chart.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      priceLinesRef.current = { entry: null, target: null, stop: null };
      seriesKeyRef.current = null;
      candleMetaRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    const volume = volumeRef.current;
    if (!series || !volume || candles.length === 0) return;
    const candleData = candles.map((candle) => ({
      time: candle.time as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
    const volumeData = candles.filter((candle) => Number.isFinite(candle.volume)).map((candle) => ({
      time: candle.time as UTCTimestamp,
      value: Number(candle.volume),
      color: candle.close >= candle.open ? 'rgba(38,166,154,.28)' : 'rgba(239,83,80,.26)',
    }));
    const nextMeta = { first: candles[0].time, last: candles[candles.length - 1].time, length: candles.length };
    const previous = candleMetaRef.current;
    const sameSeries = seriesKeyRef.current === seriesKey;
    const onlyCurrentCandleChanged = sameSeries && previous && previous.first === nextMeta.first
      && previous.last === nextMeta.last && previous.length === nextMeta.length;
    if (onlyCurrentCandleChanged) {
      series.update(candleData[candleData.length - 1]);
      if (volumeData.length) volume.update(volumeData[volumeData.length - 1]);
    } else {
      series.setData(candleData);
      volume.setData(volumeData);
      if (!sameSeries) chartRef.current?.timeScale().fitContent();
    }
    seriesKeyRef.current = seriesKey;
    candleMetaRef.current = nextMeta;
  }, [candles, seriesKey]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || candles.length === 0) return;

    const times = candles.map((candle) => candle.time).sort((a, b) => a - b);
    const windowStart = times[0];
    const windowEnd = times[times.length - 1];
    const markers: Array<{
      time: UTCTimestamp;
      position: 'aboveBar' | 'belowBar';
      color: string;
      shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
      text: string;
    }> = [];
    const tooltipRows = new Map<number, string>();

    for (const trade of trades) {
      if (!trade.openedAt || !Number.isFinite(trade.entry)) continue;
      const isLong = String(trade.side).toUpperCase() === 'LONG';
      const openedAt = toSeconds(trade.openedAt);
      if (Number.isFinite(openedAt) && openedAt >= windowStart && openedAt <= windowEnd) {
        const snapped = snapToCandle(openedAt, times, 'down');
        markers.push({
          time: snapped,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: isLong ? '#34d399' : '#fb7185',
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: `${isLong ? 'L' : 'S'} ${priceLabel(trade.entry)}`,
        });
        tooltipRows.set(Number(snapped), `${isLong ? 'LONG' : 'SHORT'} ${trade.pair ?? ''}\nEntry: ${priceLabel(trade.entry)}\nLeverage: ${trade.leverage ? `${trade.leverage}x` : 'UNAVAILABLE'}\nStatus: ${trade.status === 'open' ? 'OPEN PAPER' : 'CLOSED PAPER'}`);
      }

      if (trade.status !== 'open' && trade.closedAt && trade.exit != null && Number.isFinite(trade.exit)) {
        const closedAt = toSeconds(trade.closedAt);
        if (Number.isFinite(closedAt) && closedAt >= windowStart && closedAt <= windowEnd) {
          const pnl = trade.pnlUsd;
          const exit = exitVisual(trade.reason);
          const snapped = snapToCandle(closedAt, times, 'up');
          markers.push({
            time: snapped,
            position: isLong ? 'aboveBar' : 'belowBar',
            color: exit.color,
            shape: 'circle',
            text: `${exit.label}${typeof pnl === 'number' ? ` ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : ''}`,
          });
          tooltipRows.set(Number(snapped), `${isLong ? 'LONG' : 'SHORT'} ${trade.pair ?? ''}\nEntry: ${priceLabel(trade.entry)}\nExit: ${priceLabel(trade.exit)}\nPnL: ${typeof pnl === 'number' ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : 'UNAVAILABLE'}\nExit: ${(trade.reason || 'EXIT').replaceAll('_', ' ').toUpperCase()}`);
        }
      }
    }

    markers.sort((a, b) => Number(a.time) - Number(b.time));
    markersRef.current?.setMarkers(markers);
    tooltipRowsRef.current = tooltipRows;

    const active = trades.find((trade) => trade.status === 'open');
    const syncLine = (name: LineName, value: number | null | undefined, color: string, title: string) => {
      const current = priceLinesRef.current[name];
      if (value == null || !Number.isFinite(value)) {
        if (current) series.removePriceLine(current);
        priceLinesRef.current[name] = null;
        return;
      }
      const options = { price: value, color, lineWidth: 1 as const, lineStyle: 2 as const, axisLabelVisible: true, title };
      if (current) current.applyOptions(options);
      else priceLinesRef.current[name] = series.createPriceLine(options);
    };
    syncLine('entry', active?.entry, '#22d3ee', `ENTRY${active?.leverage ? ` ${active.leverage}x` : ''}`);
    syncLine('target', active?.target, '#34d399', 'TP');
    syncLine('stop', active?.stop, '#f87171', 'SL');
  }, [candles, trades]);

  return (
    <div className="relative h-full w-full" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />
      <div ref={tooltipRef} hidden className="pointer-events-none absolute left-3 top-3 whitespace-pre-line border border-[#344157] bg-[#070a0f]/95 px-3 py-2 font-mono text-[10px] leading-4 text-zinc-200 shadow-2xl" />
    </div>
  );
}
