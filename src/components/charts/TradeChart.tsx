// TradeChart — TradingView Lightweight Charts showing probability curve per trade.
// Displays entry/exit markers and TP/SL reference lines.
// Data source: /api/trading/trade/:id/price-history (polled every 30s while open)

import { useEffect, useRef, useState } from 'react';
import { createChart, createSeriesMarkers, LineSeries, type IChartApi, type ISeriesApi, type LineSeriesOptions } from 'lightweight-charts';
import { agentClient, type TradeChartData } from '../../lib/agentClient';
import { useLanguage } from '../../i18n/languageStore';

interface Props {
  tradeId: string;
  isOpen?: boolean;
}

export default function TradeChart({ tradeId, isOpen = true }: Props) {
  const lang = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [chartData, setChartData] = useState<TradeChartData | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadData() {
    const res = await agentClient.getTradeChart(tradeId);
    if (res?.ok) setChartData(res);
    setLoading(false);
  }

  // Mount/destroy chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: 'transparent' },
        textColor: '#71717a',
      },
      grid: {
        vertLines: { color: 'rgba(61,169,252,0.06)' },
        horzLines: { color: 'rgba(61,169,252,0.06)' },
      },
      crosshair: {
        vertLine: { color: 'rgba(61,169,252,0.4)', width: 1, style: 3 },
        horzLine: { color: 'rgba(61,169,252,0.4)', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: '#262d3d',
        scaleMargins: { top: 0.15, bottom: 0.15 },
      },
      timeScale: {
        borderColor: '#262d3d',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { axisPressedMouseMove: false },
      height: 180,
    });

    const series = chart.addSeries(LineSeries, {
      color: 'rgba(61,169,252,0.9)',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    } as Partial<LineSeriesOptions>);

    chartRef.current = chart;
    seriesRef.current = series;

    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Load data on mount + poll if trade is open
  useEffect(() => {
    void loadData();
    if (!isOpen) return;
    const id = setInterval(() => void loadData(), 30_000);
    return () => clearInterval(id);
  }, [tradeId, isOpen]);

  // Update chart when data arrives
  useEffect(() => {
    if (!chartData || !seriesRef.current || !chartRef.current) return;

    const { trade, snapshots } = chartData;
    const priceSide = trade.outcome === 'YES' ? 'yes_price' : 'no_price';

    // Build time series from snapshots
    const points = snapshots.map((s) => ({
      time: Math.floor(new Date(s.recorded_at).getTime() / 1000) as unknown as import('lightweight-charts').Time,
      value: s[priceSide],
    }));

    // If no snapshots yet, show single entry price point at open time
    if (points.length === 0 && trade.entry_price != null) {
      points.push({
        time: Math.floor(new Date(trade.opened_at).getTime() / 1000) as unknown as import('lightweight-charts').Time,
        value: trade.entry_price,
      });
    }

    if (points.length === 0) return;

    seriesRef.current.setData(points);

    // TP / SL reference price lines
    const tp = trade.take_profit_price ?? (trade.entry_price * 1.28);
    const sl = trade.stop_loss_price  ?? (trade.entry_price * 0.80);

    seriesRef.current.applyOptions({
      autoscaleInfoProvider: () => ({
        priceRange: { minValue: Math.min(sl * 0.95, ...points.map(p => p.value)), maxValue: Math.max(tp * 1.05, ...points.map(p => p.value)) },
        margins: undefined,
      }),
    });

    // Markers: entry and exit
    const markers: import('lightweight-charts').SeriesMarker<import('lightweight-charts').Time>[] = [
      {
        time: Math.floor(new Date(trade.opened_at).getTime() / 1000) as unknown as import('lightweight-charts').Time,
        position: 'belowBar',
        color: '#00ff9c',
        shape: 'arrowUp',
        text: `ENTRY ${trade.entry_price.toFixed(3)}`,
        size: 1,
      },
    ];

    if (trade.closed_at && trade.exit_price != null) {
      const pnlStr = trade.pnl != null ? ` / PnL ${trade.pnl >= 0 ? '+' : ''}$${trade.pnl.toFixed(2)}` : '';
      markers.push({
        time: Math.floor(new Date(trade.closed_at).getTime() / 1000) as unknown as import('lightweight-charts').Time,
        position: 'aboveBar',
        color: (trade.pnl ?? 0) >= 0 ? '#00ff9c' : '#ff4757',
        shape: 'arrowDown',
        text: `EXIT ${trade.exit_price.toFixed(3)}${pnlStr}`,
        size: 1,
      });
    }

    createSeriesMarkers(seriesRef.current, markers);

    chartRef.current.timeScale().fitContent();
  }, [chartData]);

  if (loading) {
    return (
      <div className="h-[180px] flex items-center justify-center font-mono text-[10px] text-zinc-600">
        {lang === 'es' ? 'Cargando gráfico…' : 'Loading chart…'}
      </div>
    );
  }

  if (!chartData) {
    return (
      <div className="h-[180px] flex items-center justify-center font-mono text-[10px] text-zinc-600">
        {lang === 'es' ? 'Sin datos de precio' : 'No price data yet'}
      </div>
    );
  }

  const { trade } = chartData;
  const tp = trade.take_profit_price ?? (trade.entry_price * 1.28);
  const sl = trade.stop_loss_price  ?? (trade.entry_price * 0.80);

  return (
    <div className="bg-carbon-300 rounded-sm overflow-hidden">
      {/* TP / SL legend */}
      <div className="flex items-center gap-3 px-2 pt-1.5 pb-0.5">
        <span className="font-mono text-[9px]" style={{ color: '#00ff9c' }}>
          TP {tp.toFixed(3)}
        </span>
        <span className="font-mono text-[9px]" style={{ color: '#ff4757' }}>
          SL {sl.toFixed(3)}
        </span>
        <span className="font-mono text-[9px] text-zinc-600 ml-auto">
          {trade.outcome} · {trade.market_question.slice(0, 38)}{trade.market_question.length > 38 ? '…' : ''}
        </span>
      </div>

      {/* Chart canvas */}
      <div ref={containerRef} className="w-full" style={{ height: 180 }} />

      {/* Snapshot count */}
      {chartData.snapshots.length === 0 && (
        <div className="px-2 pb-1.5 font-mono text-[9px] text-zinc-700">
          {lang === 'es'
            ? 'El gráfico se pobla cada 2 min con el monitor de posiciones.'
            : 'Chart populates every 2 min as the position monitor runs.'}
        </div>
      )}
    </div>
  );
}
