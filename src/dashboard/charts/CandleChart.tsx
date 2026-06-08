import { useEffect, useRef, useState } from 'react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers, LineStyle } from 'lightweight-charts';
import type { UTCTimestamp, ISeriesApi, SeriesType, SeriesMarker, Time, ISeriesMarkersPluginApi, IPriceLine } from 'lightweight-charts';
import type { TradeStory, CopilotAnalysis } from '@services/cryptoClient';
import { analyzeCopilot } from '@services/cryptoClient';
import { loadChartTicker, type ChartTickerStats } from '@services/chartTicker';
import { TradeStoryCard } from '../../components/crypto/TradeStoryCard';
import { CopilotPanel } from '../../components/crypto/CopilotPanel';
import { ChartStatsHeader } from '../../components/crypto/ChartStatsHeader';

// ─── Constants ────────────────────────────────────────────────────────────────

const PAIRS     = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'];
// Binance API uses lowercase intervals: 1m 5m 15m 1h 4h 1d
const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'];
// Pro palette (DexScreener-ish): crisp green/red, calm EMAs.
const C = { up: '#16c784', down: '#ea3943', ema9: '#3b82f6', ema21: '#f59e0b' };

// Binance public REST — CORS allowed from browser, no key needed
const BINANCE = 'https://api.binance.com/api/v3';

// Timeframe → seconds (for click tolerance + replay padding)
const TF_SECONDS: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
};

const EXIT_COLOR: Record<string, string> = {
  TP: '#22c55e', SL: '#ef4444', TIMEOUT: '#f59e0b', CONFIDENCE: '#f97316', EXIT: '#9ca3af',
};

function toUnix(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

// Build entry + exit markers for the trades on the current pair.
function buildMarkers(trades: TradeStory[], pair: string, selectedId: string | null): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];
  for (const t of trades) {
    if (t.pair !== pair) continue;
    const sel = t.id === selectedId;
    const entryT = toUnix(t.opened_at);
    if (entryT != null) {
      const isLong = t.side === 'LONG';
      markers.push({
        time: entryT as UTCTimestamp,
        position: isLong ? 'belowBar' : 'aboveBar',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        color: sel ? (isLong ? '#4ade80' : '#c084fc') : (isLong ? '#22c55e' : '#a855f7'),
        text: sel ? t.side : '',
        size: sel ? 2 : 1,
      });
    }
    const exitT = toUnix(t.closed_at);
    if (exitT != null && t.exit_kind) {
      const col = EXIT_COLOR[t.exit_kind] ?? '#9ca3af';
      const kind = t.exit_kind === 'TP' ? 'TP' : t.exit_kind === 'SL' ? 'SL' : 'EXIT';
      const pnlTxt = t.pnl != null ? ` ${t.pnl >= 0 ? '+' : ''}$${Math.abs(t.pnl).toFixed(1)}` : '';
      markers.push({
        time: exitT as UTCTimestamp,
        position: 'aboveBar',
        shape: 'circle',
        color: sel ? '#ffffff' : col,
        text: sel ? `${kind}${pnlTxt}` : '',
        size: sel ? 2 : 1,
      });
    }
  }
  // lightweight-charts requires markers sorted ascending by time
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  return markers;
}

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
  tradeStories?: TradeStory[];
  selectedTradeId?: string | null;
  onSelectTrade?: (id: string | null) => void;
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

export default function CandleChart({
  positions = [], onManualOrder,
  tradeStories = [], selectedTradeId = null, onSelectTrade,
}: Props) {
  const wrapRef  = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  // Keep series in refs so we only create them once
  const csRef      = useRef<ISeriesApi<SeriesType> | null>(null);
  const e9Ref      = useRef<ISeriesApi<SeriesType> | null>(null);
  const e21Ref     = useRef<ISeriesApi<SeriesType> | null>(null);
  const volRef     = useRef<ISeriesApi<SeriesType> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  // Latest props/state for use inside the once-created click handler
  const tradesRef   = useRef<TradeStory[]>(tradeStories);
  const onSelectRef = useRef(onSelectTrade);
  const selectedRef = useRef<string | null>(selectedTradeId);
  const pairRef     = useRef('BTCUSDT');
  const tfRef       = useRef('1h');

  const [pair, setPair]         = useState('BTCUSDT');
  const [tf, setTf]             = useState('1h');
  const [price, setPrice]       = useState<number | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [candlesLoadedAt, setCandlesLoadedAt] = useState(0);
  const [stats, setStats]       = useState<ChartTickerStats | null>(null);
  const [showEma9, setShowEma9] = useState(true);
  const [showEma21, setShowEma21] = useState(true);

  // Co-pilot pre-trade state
  const [copilotSide, setCopilotSide]         = useState<'LONG' | 'SHORT' | null>(null);
  const [copilotAnalysis, setCopilotAnalysis] = useState<CopilotAnalysis | null>(null);
  const [copilotLoading, setCopilotLoading]   = useState(false);
  const [copilotExecuting, setCopilotExecuting] = useState(false);

  useEffect(() => { tradesRef.current = tradeStories; }, [tradeStories]);
  useEffect(() => { onSelectRef.current = onSelectTrade; }, [onSelectTrade]);
  useEffect(() => { selectedRef.current = selectedTradeId; }, [selectedTradeId]);
  useEffect(() => { pairRef.current = pair; }, [pair]);
  useEffect(() => { tfRef.current = tf; }, [tf]);

  const selectedTrade = tradeStories.find(t => t.id === selectedTradeId) ?? null;

  // ── Create chart + series ONCE ──────────────────────────────────────────────
  useEffect(() => {
    if (!wrapRef.current) return;

    const chart = createChart(wrapRef.current, {
      layout:    { background: { color: '#0b0e11' }, textColor: '#8b93a7', fontFamily: 'ui-monospace, monospace' },
      grid:      { vertLines: { color: '#161a22' }, horzLines: { color: '#161a22' } },
      crosshair: { mode: 1 },
      rightPriceScale: { borderColor: '#222732', scaleMargins: { top: 0.08, bottom: 0.22 } },
      timeScale:       { borderColor: '#222732', timeVisible: true },
      width:  wrapRef.current.clientWidth,
      height: wrapRef.current.clientHeight || 380,
    });
    chartRef.current = chart;

    // Candlestick — last-price line on for a pro terminal feel.
    csRef.current = chart.addSeries(CandlestickSeries, {
      upColor: C.up, downColor: C.down,
      borderUpColor: C.up, borderDownColor: C.down,
      wickUpColor: C.up, wickDownColor: C.down,
      priceLineVisible: true, lastValueVisible: true,
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
      priceLineVisible: false,
      lastValueVisible: false,
    });
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });

    // Trade markers primitive (v5) — attached to the candlestick series
    markersRef.current = createSeriesMarkers(csRef.current, []);

    // Click → select the nearest trade marker (entry or exit) by time
    chart.subscribeClick((param) => {
      if (param.time == null || !onSelectRef.current) return;
      const clicked = param.time as number;
      const tol = (TF_SECONDS[tfRef.current] ?? 3600) * 2.5;
      let best: { id: string; d: number } | null = null;
      for (const t of tradesRef.current) {
        if (t.pair !== pairRef.current) continue;
        for (const iso of [t.opened_at, t.closed_at]) {
          const u = toUnix(iso);
          if (u == null) continue;
          const d = Math.abs(u - clicked);
          if (d <= tol && (!best || d < best.d)) best = { id: t.id, d };
        }
      }
      // Toggle off if re-clicking the already-selected trade
      onSelectRef.current(best ? (best.id === selectedRef.current ? null : best.id) : null);
    });

    // Responsive width + height — chart fills its container cell
    const ro = new ResizeObserver(() => {
      if (wrapRef.current) chart.applyOptions({
        width:  wrapRef.current.clientWidth,
        height: wrapRef.current.clientHeight || 380,
      });
    });
    ro.observe(wrapRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; markersRef.current = null; };
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
        setCandlesLoadedAt(Date.now());  // signals marker/replay effects to re-run

        // Price = last close; multi-window changes come from chartTicker.
        const last = candles[candles.length - 1];
        setPrice(last.close);
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

  // ── Real-time tick: update the live candle + price every 8s (between full reloads),
  //    so the chart feels alive without re-pulling the whole series. ───────────────
  useEffect(() => {
    let cancelled = false;
    async function tick() {
      if (!csRef.current) return;
      try {
        const r = await fetch(`${BINANCE}/klines?symbol=${pair}&interval=${tf}&limit=2`, { signal: AbortSignal.timeout(5000) });
        if (!r.ok || cancelled) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw: any[] = await r.json();
        if (cancelled || !raw?.length) return;
        const k = raw[raw.length - 1];
        const bar = {
          time:  Math.floor(k[0] / 1000) as UTCTimestamp,
          open:  parseFloat(k[1]), high: parseFloat(k[2]),
          low:   parseFloat(k[3]), close: parseFloat(k[4]),
        };
        csRef.current.update(bar);                 // updates the live bar in place
        volRef.current?.update({ time: bar.time, value: parseFloat(k[5]), color: bar.close >= bar.open ? C.up + '55' : C.down + '55' });
        setPrice(bar.close);
      } catch { /* transient — next tick retries */ }
    }
    const id = setInterval(() => void tick(), 8_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pair, tf]);

  // ── Trade markers: recompute when trades/pair/selection/data change ──────────
  useEffect(() => {
    if (!markersRef.current) return;
    markersRef.current.setMarkers(buildMarkers(tradeStories, pair, selectedTradeId));
  }, [tradeStories, pair, selectedTradeId, candlesLoadedAt]);

  useEffect(() => {
    e9Ref.current?.applyOptions({ visible: showEma9 });
  }, [showEma9]);

  useEffect(() => {
    e21Ref.current?.applyOptions({ visible: showEma21 });
  }, [showEma21]);

  // ── 24h ticker stats for the DexScreener-style header ────────────────────────
  useEffect(() => {
    let cancelled = false;
    setStats(null);
    const run = async () => {
      const s = await loadChartTicker(pair);
      if (!cancelled && s) setStats(s);
    };
    void run();
    const id = setInterval(() => void run(), 30_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [pair]);

  // ── Agent price lines: entry / TP / SL for OPEN positions on the current pair ─
  useEffect(() => {
    const cs = csRef.current;
    if (!cs) return;
    for (const pl of priceLinesRef.current) { try { cs.removePriceLine(pl); } catch { /* gone */ } }
    priceLinesRef.current = [];
    for (const pos of positions.filter(p => p.pair === pair)) {
      const isLong = pos.side === 'LONG';
      const add = (price: number, color: string, title: string, style: LineStyle, width: 1 | 2 = 1) => {
        if (!Number.isFinite(price) || price <= 0) return;
        priceLinesRef.current.push(cs.createPriceLine({ price, color, lineWidth: width, lineStyle: style, axisLabelVisible: true, title }));
      };
      add(pos.entry_price, isLong ? '#3b82f6' : '#a855f7', `ENTRY ${pos.side}`, LineStyle.Solid, 2);
      add(pos.target_price, C.up, 'TP', LineStyle.Dashed);
      add(pos.stop_price, C.down, 'SL', LineStyle.Dashed);
    }
  }, [positions, pair, candlesLoadedAt]);

  // ── When a trade on another pair is selected, switch the chart to its pair ───
  useEffect(() => {
    if (selectedTrade && selectedTrade.pair && selectedTrade.pair !== pair) {
      setPair(selectedTrade.pair);
    }
  }, [selectedTrade, pair]);

  // ── Replay: pan/zoom the chart to the selected trade's time window ───────────
  useEffect(() => {
    if (!chartRef.current || !selectedTrade || selectedTrade.pair !== pair) return;
    const from = toUnix(selectedTrade.opened_at);
    const to   = toUnix(selectedTrade.closed_at) ?? Math.floor(Date.now() / 1000);
    if (from == null) return;
    const pad = (TF_SECONDS[tf] ?? 3600) * 12;  // ~12 candles of context each side
    try {
      chartRef.current.timeScale().setVisibleRange({
        from: (from - pad) as UTCTimestamp,
        to:   (to + pad) as UTCTimestamp,
      });
    } catch { /* range outside loaded data — ignore */ }
  }, [selectedTrade, pair, tf, candlesLoadedAt]);

  // ── Co-pilot handlers ────────────────────────────────────────────────────────
  async function openCopilot(side: 'LONG' | 'SHORT') {
    setCopilotSide(side);
    setCopilotAnalysis(null);
    setCopilotLoading(true);
    const a = await analyzeCopilot(pair, side);
    setCopilotAnalysis(a);
    setCopilotLoading(false);
  }
  function closeCopilot() {
    setCopilotSide(null);
    setCopilotAnalysis(null);
    setCopilotLoading(false);
  }
  async function executeCopilot() {
    if (!copilotSide || !onManualOrder) return;
    setCopilotExecuting(true);
    try { await onManualOrder(copilotSide, pair); } finally {
      setCopilotExecuting(false);
      closeCopilot();
    }
  }

  // ── Derived ────────────────────────────────────────────────────────────────
  const symbol   = pair.replace('USDT', '');
  const myPos    = positions.filter(p => p.pair === pair);

  return (
    <div className="gx-card overflow-hidden h-full flex flex-col min-h-0">

      {/* ── DexScreener-style stats header: pairs · price · changes · vol · TF ── */}
      <ChartStatsHeader
        pairs={PAIRS}
        intervals={INTERVALS}
        pair={pair}
        tf={tf}
        symbol={symbol}
        livePrice={price}
        stats={stats}
        loading={loading}
        showEma9={showEma9}
        showEma21={showEma21}
        onPair={setPair}
        onTf={setTf}
        onToggleEma9={() => setShowEma9(v => !v)}
        onToggleEma21={() => setShowEma21(v => !v)}
      />

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
      <div className="relative w-full flex-1 min-h-0" style={{ minHeight: 200 }}>
        <div ref={wrapRef} className="absolute inset-0" />
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center">
          <div className="font-mono text-[72px] md:text-[96px] font-black tracking-[-0.08em] text-zinc-500/10 select-none">
            {symbol}
          </div>
        </div>
        {selectedTrade && !copilotSide && (
          <TradeStoryCard trade={selectedTrade} onClose={() => onSelectTrade?.(null)} />
        )}
        {copilotSide && (
          <CopilotPanel
            analysis={copilotAnalysis}
            loading={copilotLoading}
            executing={copilotExecuting}
            onExecute={executeCopilot}
            onClose={closeCopilot}
          />
        )}
      </div>

      {/* ── Manual order panel — opens the Co-Pilot pre-trade analysis ───── */}
      {onManualOrder && (
        <div className="border-t border-zinc-800 px-4 py-3 flex items-center gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="font-mono text-[12px] text-zinc-300 font-bold">{symbol}/USDT</div>
            <div className="font-mono text-[10px] text-zinc-600">$100 · paper · ◆ co-pilot asistido</div>
          </div>
          <button
            type="button"
            onClick={() => openCopilot('LONG')}
            disabled={copilotSide !== null}
            className="font-mono text-[13px] font-bold px-6 py-2.5 rounded
              bg-emerald-500 hover:bg-emerald-400 active:scale-95 disabled:opacity-50
              text-black transition-all">
            Long ▲
          </button>
          <button
            type="button"
            onClick={() => openCopilot('SHORT')}
            disabled={copilotSide !== null}
            className="font-mono text-[13px] font-bold px-6 py-2.5 rounded
              bg-rose-500 hover:bg-rose-400 active:scale-95 disabled:opacity-50
              text-white transition-all">
            Short ▼
          </button>
        </div>
      )}
    </div>
  );
}
