// QuantChart.tsx — TradingView Lightweight Charts (v5) candlestick chart with
// verified paper futures markers, animated bot execution traces and open-position risk levels.
// Visuals are derived only from runner/market facts; no fabricated execution data.

import { useEffect, useMemo, useRef, useState } from 'react';
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
import './quantChartBotOverlay.css';

export interface ChartCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface ChartTrade {
  id?: string;
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
  capitalUsed?: number | null;
  mode?: string | null;
  tradeType?: string | null;
  strategyVersionId?: string | null;
  entryRegime?: string | null;
  entrySession?: string | null;
  runnerVersion?: string | null;
  validationStatus?: string | null;
  latestDecisionReason?: string | null;
  latestDecisionStatus?: string | null;
  decisionProfile?: string | null;
}

interface Props {
  candles: ChartCandle[];
  trades?: ChartTrade[];
  height?: number | string;
  seriesKey?: string;
}

type LineName = 'entry' | 'target' | 'stop';

interface OverlaySegment {
  key: string;
  tradeKey: string;
  status: 'open' | 'closed';
  side: 'LONG' | 'SHORT';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  entry: number;
  endPrice: number;
  pnlUsd: number | null;
  movePct: number | null;
  exitReason: string | null;
}

const CARBON_BG = '#0a0c12';
const GRID = '#1a1d24';
const TEXT = '#cbd5e1';
const MAX_TRACE_SEGMENTS = 12;

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
  return value < 1 ? value.toFixed(5) : value < 100 ? value.toFixed(3) : value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function moneyLabel(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 'UNAVAILABLE';
  return `${value >= 0 ? '+' : ''}$${value.toFixed(2)}`;
}

function humanize(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (!normalized) return 'UNAVAILABLE';
  return normalized.replaceAll('_', ' ').replaceAll('-', ' ').toUpperCase();
}

function tradeKey(trade: ChartTrade) {
  return trade.id || `${trade.openedAt}:${trade.side}:${trade.entry}`;
}

function sideOf(trade: ChartTrade): 'LONG' | 'SHORT' {
  return String(trade.side).toUpperCase() === 'SHORT' ? 'SHORT' : 'LONG';
}

function exitVisual(reason: string | null | undefined) {
  const normalized = String(reason || '').toLowerCase();
  if (normalized === 'take_profit') return { color: '#34d399', label: 'TP' };
  if (normalized === 'stop_loss') return { color: '#f87171', label: 'SL' };
  if (normalized === 'timeout') return { color: '#fbbf24', label: 'TIME' };
  return { color: '#94a3b8', label: 'EXIT' };
}

function signedMovePct(trade: ChartTrade, mark: number) {
  if (!Number.isFinite(trade.entry) || trade.entry === 0 || !Number.isFinite(mark)) return null;
  const raw = sideOf(trade) === 'LONG'
    ? ((mark - trade.entry) / trade.entry) * 100
    : ((trade.entry - mark) / trade.entry) * 100;
  return Number.isFinite(raw) ? raw : null;
}

function tradeTooltip(trade: ChartTrade, phase: 'entry' | 'exit') {
  const side = sideOf(trade);
  const rows = [
    `${side} ${trade.pair ?? ''} · ${(trade.mode || 'paper').toUpperCase()}`,
    `Entry: ${priceLabel(trade.entry)}`,
    `Leverage: ${trade.leverage ? `${trade.leverage}x` : 'UNAVAILABLE'}`,
    `Strategy: ${humanize(trade.tradeType)}`,
    `Regime: ${humanize(trade.entryRegime)}`,
    `Session: ${humanize(trade.entrySession)}`,
    `Validation: ${humanize(trade.validationStatus)}`,
  ];
  if (phase === 'exit') {
    rows.splice(2, 0, `Exit: ${trade.exit == null ? 'UNAVAILABLE' : priceLabel(trade.exit)}`);
    rows.push(`PnL: ${moneyLabel(trade.pnlUsd)}`);
    rows.push(`Exit reason: ${humanize(trade.reason)}`);
  } else {
    rows.push(`Status: ${trade.status === 'open' ? 'OPEN PAPER' : 'CLOSED PAPER'}`);
  }
  if (trade.latestDecisionReason) rows.push(`Latest pair decision: ${humanize(trade.latestDecisionReason)}`);
  return rows.join('\n');
}

function traceTone(segment: OverlaySegment) {
  if (segment.status === 'open') return 'open';
  if (segment.pnlUsd == null) return 'neutral';
  return segment.pnlUsd >= 0 ? 'profit' : 'loss';
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
  const overlaySyncRef = useRef<() => void>(() => undefined);
  const [segments, setSegments] = useState<OverlaySegment[]>([]);
  const [selectedTradeKey, setSelectedTradeKey] = useState<string | null>(null);

  const sortedTrades = useMemo(
    () => [...trades].sort((a, b) => (Date.parse(b.openedAt || '') || 0) - (Date.parse(a.openedAt || '') || 0)),
    [trades],
  );
  const selectedTrade = useMemo(() => {
    if (selectedTradeKey) {
      const explicit = sortedTrades.find((trade) => tradeKey(trade) === selectedTradeKey);
      if (explicit) return explicit;
    }
    return sortedTrades.find((trade) => trade.status === 'open') ?? sortedTrades[0] ?? null;
  }, [selectedTradeKey, sortedTrades]);

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

    let overlayFrame = 0;
    const scheduleOverlaySync = () => {
      window.cancelAnimationFrame(overlayFrame);
      overlayFrame = window.requestAnimationFrame(() => overlaySyncRef.current());
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(scheduleOverlaySync);

    const observer = new ResizeObserver(() => {
      if (!container.isConnected) return;
      chart.resize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
      scheduleOverlaySync();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(overlayFrame);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(scheduleOverlaySync);
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
    if (!series || !volume || candles.length === 0) {
      setSegments([]);
      return;
    }
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
      const isLong = sideOf(trade) === 'LONG';
      const openedAt = toSeconds(trade.openedAt);
      if (Number.isFinite(openedAt) && openedAt >= windowStart && openedAt <= windowEnd) {
        const snapped = snapToCandle(openedAt, times, 'down');
        markers.push({
          time: snapped,
          position: isLong ? 'belowBar' : 'aboveBar',
          color: isLong ? '#34d399' : '#fb7185',
          shape: isLong ? 'arrowUp' : 'arrowDown',
          text: `BOT ${isLong ? 'LONG' : 'SHORT'} ${priceLabel(trade.entry)}`,
        });
        tooltipRows.set(Number(snapped), tradeTooltip(trade, 'entry'));
      }

      if (trade.status !== 'open' && trade.closedAt && trade.exit != null && Number.isFinite(trade.exit)) {
        const closedAt = toSeconds(trade.closedAt);
        if (Number.isFinite(closedAt) && closedAt >= windowStart && closedAt <= windowEnd) {
          const exit = exitVisual(trade.reason);
          const snapped = snapToCandle(closedAt, times, 'up');
          markers.push({
            time: snapped,
            position: isLong ? 'aboveBar' : 'belowBar',
            color: exit.color,
            shape: 'circle',
            text: `${exit.label}${typeof trade.pnlUsd === 'number' ? ` ${moneyLabel(trade.pnlUsd)}` : ''}`,
          });
          const previousRow = tooltipRows.get(Number(snapped));
          const nextRow = tradeTooltip(trade, 'exit');
          tooltipRows.set(Number(snapped), previousRow ? `${previousRow}\n\n${nextRow}` : nextRow);
        }
      }
    }

    markers.sort((a, b) => Number(a.time) - Number(b.time));
    markersRef.current?.setMarkers(markers);
    tooltipRowsRef.current = tooltipRows;

    const active = [...trades]
      .filter((trade) => trade.status === 'open')
      .sort((a, b) => (Date.parse(b.openedAt || '') || 0) - (Date.parse(a.openedAt || '') || 0))[0];
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
    syncLine('entry', active?.entry, '#22d3ee', `BOT ENTRY${active?.leverage ? ` ${active.leverage}x` : ''}`);
    syncLine('target', active?.target, '#34d399', 'BOT TP');
    syncLine('stop', active?.stop, '#f87171', 'BOT SL');
  }, [candles, trades]);

  useEffect(() => {
    overlaySyncRef.current = () => {
      const chart = chartRef.current;
      const series = seriesRef.current;
      const container = containerRef.current;
      if (!chart || !series || !container || candles.length === 0) {
        setSegments([]);
        return;
      }

      const times = candles.map((candle) => candle.time).sort((a, b) => a - b);
      const latestCandle = candles[candles.length - 1];
      const width = container.clientWidth;
      const heightPx = container.clientHeight;
      const next: OverlaySegment[] = [];

      for (const trade of sortedTrades.slice(0, MAX_TRACE_SEGMENTS)) {
        if (!trade.openedAt || !Number.isFinite(trade.entry)) continue;
        const openedAt = toSeconds(trade.openedAt);
        if (!Number.isFinite(openedAt)) continue;

        const windowStart = times[0];
        const windowEnd = times[times.length - 1];
        if (openedAt < windowStart || openedAt > windowEnd) continue;

        const startTime = snapToCandle(openedAt, times, 'down');
        const x1 = chart.timeScale().timeToCoordinate(startTime);
        const y1 = series.priceToCoordinate(trade.entry);
        if (x1 == null || y1 == null) continue;

        let endTime: UTCTimestamp;
        let endPrice: number;
        if (trade.status === 'closed' && trade.closedAt && trade.exit != null && Number.isFinite(trade.exit)) {
          const closedAt = toSeconds(trade.closedAt);
          if (!Number.isFinite(closedAt) || closedAt < windowStart || closedAt > windowEnd) continue;
          endTime = snapToCandle(closedAt, times, 'up');
          endPrice = trade.exit;
        } else {
          endTime = latestCandle.time as UTCTimestamp;
          endPrice = latestCandle.close;
        }

        const x2 = chart.timeScale().timeToCoordinate(endTime);
        const y2 = series.priceToCoordinate(endPrice);
        if (x2 == null || y2 == null) continue;

        const padding = 80;
        if (
          (x1 < -padding && x2 < -padding)
          || (x1 > width + padding && x2 > width + padding)
          || (y1 < -padding && y2 < -padding)
          || (y1 > heightPx + padding && y2 > heightPx + padding)
        ) continue;

        next.push({
          key: `${tradeKey(trade)}:${trade.status}`,
          tradeKey: tradeKey(trade),
          status: trade.status === 'open' ? 'open' : 'closed',
          side: sideOf(trade),
          x1: Number(x1),
          y1: Number(y1),
          x2: Number(x2),
          y2: Number(y2),
          entry: trade.entry,
          endPrice,
          pnlUsd: trade.pnlUsd == null ? null : trade.pnlUsd,
          movePct: trade.status === 'open' ? signedMovePct(trade, endPrice) : null,
          exitReason: trade.reason ?? null,
        });
      }
      setSegments(next);
    };

    const frame = window.requestAnimationFrame(() => overlaySyncRef.current());
    return () => window.cancelAnimationFrame(frame);
  }, [candles, sortedTrades]);

  const inspectorSide = selectedTrade ? sideOf(selectedTrade) : null;
  const inspectorExit = selectedTrade ? exitVisual(selectedTrade.reason) : null;

  return (
    <div className="quant-chart-shell relative h-full w-full" style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />

      <svg className="quant-bot-overlay" aria-hidden="true">
        {segments.map((segment) => {
          const tone = traceTone(segment);
          return (
            <g key={segment.key} className={`quant-bot-trace quant-bot-trace--${tone}`}>
              <line className="quant-bot-trace__line" x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} />
              <circle className="quant-bot-trace__entry" cx={segment.x1} cy={segment.y1} r="4.5" />
              {segment.status === 'open' ? <circle className="quant-bot-trace__pulse" cx={segment.x1} cy={segment.y1} r="8" /> : null}
              <circle className="quant-bot-trace__end" cx={segment.x2} cy={segment.y2} r={segment.status === 'open' ? 4.5 : 3.5} />
            </g>
          );
        })}
      </svg>

      <div className="quant-bot-badges" aria-label="Bot execution traces">
        {segments.map((segment) => {
          const tone = traceTone(segment);
          const exit = exitVisual(segment.exitReason);
          const top = Math.max(24, Math.min(segment.y2, (containerRef.current?.clientHeight ?? 360) - 28));
          const left = Math.max(60, Math.min(segment.x2, (containerRef.current?.clientWidth ?? 900) - 86));
          return (
            <button
              key={`${segment.key}:badge`}
              type="button"
              className={`quant-bot-badge quant-bot-badge--${tone}`}
              style={{ left, top }}
              onClick={() => setSelectedTradeKey(segment.tradeKey)}
              aria-label={`Inspect ${segment.side} bot trade`}
            >
              <strong>{segment.status === 'open' ? `BOT ${segment.side}` : `${exit.label} ${moneyLabel(segment.pnlUsd)}`}</strong>
              <span>
                {segment.status === 'open'
                  ? `ENTRY ${priceLabel(segment.entry)} · MARK ${priceLabel(segment.endPrice)}${segment.movePct == null ? '' : ` · ${segment.movePct >= 0 ? '+' : ''}${segment.movePct.toFixed(2)}% MOVE`}`
                  : `EXIT ${priceLabel(segment.endPrice)}`}
              </span>
            </button>
          );
        })}
      </div>

      {selectedTrade ? (
        <aside className={`quant-bot-inspector quant-bot-inspector--${selectedTrade.status === 'open' ? 'open' : selectedTrade.pnlUsd != null && selectedTrade.pnlUsd >= 0 ? 'profit' : 'closed'}`} data-source="PAPER EXECUTION TRACE">
          <div className="quant-bot-inspector__head">
            <div>
              <span>BOT EXECUTION TRACE</span>
              <strong>{inspectorSide} {selectedTrade.pair || 'MARKET'}</strong>
            </div>
            <b>READ-ONLY · {(selectedTrade.mode || 'paper').toUpperCase()}</b>
          </div>
          <div className="quant-bot-inspector__prices">
            <span>ENTRY <strong>{priceLabel(selectedTrade.entry)}</strong></span>
            <i>→</i>
            <span>{selectedTrade.status === 'open' ? 'MARK' : 'EXIT'} <strong>{selectedTrade.status === 'open' ? 'LIVE CANDLE' : selectedTrade.exit == null ? 'UNAVAILABLE' : priceLabel(selectedTrade.exit)}</strong></span>
            {selectedTrade.status === 'closed' ? <em className={selectedTrade.pnlUsd != null && selectedTrade.pnlUsd >= 0 ? 'is-positive' : selectedTrade.pnlUsd != null ? 'is-negative' : ''}>{moneyLabel(selectedTrade.pnlUsd)}</em> : null}
          </div>
          <div className="quant-bot-inspector__logic">
            <span>STRATEGY <strong>{humanize(selectedTrade.tradeType)}</strong></span>
            <span>REGIME <strong>{humanize(selectedTrade.entryRegime)}</strong></span>
            <span>SESSION <strong>{humanize(selectedTrade.entrySession)}</strong></span>
            <span>VALIDATION <strong>{humanize(selectedTrade.validationStatus)}</strong></span>
          </div>
          <div className="quant-bot-inspector__reason">
            <span>{selectedTrade.status === 'closed' ? 'EXIT LOGIC' : 'LATEST ENGINE DECISION'}</span>
            <strong>
              {selectedTrade.status === 'closed'
                ? `${inspectorExit?.label ?? 'EXIT'} · ${humanize(selectedTrade.reason)}`
                : selectedTrade.latestDecisionReason
                  ? humanize(selectedTrade.latestDecisionReason)
                  : 'DECISION CONTEXT UNAVAILABLE'}
            </strong>
            {selectedTrade.latestDecisionStatus ? <small>PAIR DECISION STATUS · {humanize(selectedTrade.latestDecisionStatus)}</small> : null}
            {selectedTrade.decisionProfile ? <small>ENGINE PROFILE · {humanize(selectedTrade.decisionProfile)}</small> : null}
          </div>
          <div className="quant-bot-inspector__meta">
            <span>{selectedTrade.leverage ? `${selectedTrade.leverage}x LEVERAGE` : 'LEVERAGE UNAVAILABLE'}</span>
            <span>{selectedTrade.capitalUsed == null ? 'MARGIN UNAVAILABLE' : `$${selectedTrade.capitalUsed.toFixed(2)} MARGIN`}</span>
            <span>{selectedTrade.runnerVersion ? `RUNNER ${selectedTrade.runnerVersion}` : 'RUNNER VERSION UNAVAILABLE'}</span>
          </div>
        </aside>
      ) : null}

      <div ref={tooltipRef} hidden className="quant-chart-crosshair-tooltip pointer-events-none absolute left-3 top-3 whitespace-pre-line border border-[#344157] bg-[#070a0f]/95 px-3 py-2 font-mono text-[10px] leading-4 text-zinc-200 shadow-2xl" />
    </div>
  );
}
