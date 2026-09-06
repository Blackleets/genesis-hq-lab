import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Crosshair, RefreshCw, ShieldCheck, WifiOff, Zap } from 'lucide-react';
import QuantChart, { type ChartCandle, type ChartTrade } from '@workflows/QuantChart';
import { useTruthLayer, type RunnerTrade } from '@hooks/useTruthLayer';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '4h'] as const;
type Pair = typeof PAIRS[number];
type Timeframe = typeof TIMEFRAMES[number];

interface MarketPayload {
  ok: boolean;
  pair: string;
  tf: string;
  market: string;
  candles: ChartCandle[];
  lastPrice: number | null;
  changePct: number | null;
  updatedAt: string;
}

const money = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
  ? `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  : '—';

const price = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('en-US', { minimumFractionDigits: value < 1 ? 4 : 2, maximumFractionDigits: value < 1 ? 6 : 2 })
  : '—';

const ageLabel = (iso: string | null | undefined) => {
  if (!iso) return 'NO HEARTBEAT';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
};

const shortPair = (pair: string) => pair.replace('USDT', '');

function tradeTone(trade: RunnerTrade) {
  if (trade.status === 'open') return trade.side === 'LONG' ? 'text-emerald-300' : 'text-rose-300';
  if (typeof trade.pnl !== 'number') return 'text-zinc-400';
  return trade.pnl > 0 ? 'text-emerald-300' : trade.pnl < 0 ? 'text-red-300' : 'text-zinc-400';
}

export function AutonomousTradingTerminal({ es = true }: { es?: boolean }) {
  const [pair, setPair] = useState<Pair>('BTCUSDT');
  const [tf, setTf] = useState<Timeframe>('5m');
  const [market, setMarket] = useState<MarketPayload | null>(null);
  const [marketError, setMarketError] = useState(false);
  const [busy, setBusy] = useState(false);
  const { truth } = useTruthLayer();

  const loadMarket = useCallback(async () => {
    try {
      const response = await fetch(`/api/genesis/candles?pair=${encodeURIComponent(pair)}&tf=${encodeURIComponent(tf)}&limit=320`, { cache: 'no-store' });
      if (!response.ok) throw new Error('market feed unavailable');
      const payload = await response.json() as MarketPayload;
      if (!payload.ok || !Array.isArray(payload.candles) || payload.candles.length < 20) throw new Error('invalid market payload');
      setMarket(payload);
      setMarketError(false);
    } catch {
      setMarket(null);
      setMarketError(true);
    }
  }, [pair, tf]);

  const refresh = useCallback(async () => {
    setBusy(true);
    await loadMarket();
    setBusy(false);
  }, [loadMarket]);

  useEffect(() => {
    void refresh();
    const marketTimer = window.setInterval(() => void loadMarket(), 15_000);
    return () => window.clearInterval(marketTimer);
  }, [refresh, loadMarket]);

  const runner = truth?.agentRunner;
  const runnerAlive = runner?.agentAlive === true && runner?.paperOnly === true && runner?.liveOrders !== true;
  const cycle = runner?.lastResult;
  const recentTrades = runner?.recentTrades ?? [];
  const openPositions = runner?.openPositions ?? [];
  const stats = runner?.stats;
  const selectedTrades = useMemo(() => recentTrades.filter((trade) => trade.pair === pair), [recentTrades, pair]);
  const chartTrades = useMemo<ChartTrade[]>(() => selectedTrades.flatMap((trade) => {
    if (!trade.openedAt || trade.entryPrice == null) return [];
    return [{
      openedAt: trade.openedAt,
      closedAt: trade.closedAt,
      side: trade.side,
      entry: trade.entryPrice,
      exit: trade.exitPrice,
      reason: trade.exitReason,
      pnlUsd: trade.pnl,
      target: trade.targetPrice,
      stop: trade.stopPrice,
      status: trade.status,
      leverage: trade.leverage,
    }];
  }), [selectedTrades]);

  const latestDecisions = useMemo(() => [...(cycle?.decisions ?? [])].slice(-8).reverse(), [cycle?.decisions]);
  const blockers = useMemo(() => {
    const reasons = new Map<string, number>();
    for (const decision of cycle?.decisions ?? []) {
      const reason = typeof decision.reason === 'string' ? decision.reason : null;
      if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
    return [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [cycle?.decisions]);

  const change = market?.changePct ?? null;
  const positive = typeof change === 'number' && change >= 0;
  const recentClosed = recentTrades.filter((trade) => trade.status === 'closed').slice(0, 8);

  return (
    <section className="shrink-0 border-b border-[#202736] bg-[#05070b] text-zinc-100" aria-label="Autonomous paper futures trading terminal">
      <div className="flex flex-col gap-3 border-b border-[#202736] px-3 py-3 md:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-cyan-400/30 bg-cyan-400/5 text-cyan-300"><Crosshair className="h-4 w-4" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold tracking-[.12em] text-zinc-100">GENESIS FUTURES DESK</span>
              <span className="border border-amber-400/30 bg-amber-400/5 px-2 py-1 font-mono text-[8px] text-amber-300">AUTONOMOUS PAPER</span>
              <span className="border border-red-400/30 bg-red-400/5 px-2 py-1 font-mono text-[8px] text-red-300">LIVE LOCKED</span>
            </div>
            <p className="mt-1 text-[9px] text-zinc-600">{es ? 'Mercado real · señales reales · posiciones paper verificadas · cero órdenes reales' : 'Real market · real signals · verified paper positions · zero real orders'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PAIRS.map((item) => <button key={item} type="button" onClick={() => setPair(item)} className={`border px-2.5 py-1.5 font-mono text-[9px] ${pair === item ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200' : 'border-[#252d3c] text-zinc-500 hover:text-zinc-200'}`}>{shortPair(item)}</button>)}
          <span className="mx-1 h-5 w-px bg-[#252d3c]" />
          {TIMEFRAMES.map((item) => <button key={item} type="button" onClick={() => setTf(item)} className={`border px-2 py-1.5 font-mono text-[9px] ${tf === item ? 'border-violet-400/40 bg-violet-400/10 text-violet-200' : 'border-[#252d3c] text-zinc-500 hover:text-zinc-200'}`}>{item}</button>)}
          <button type="button" onClick={() => void refresh()} disabled={busy} className="ml-1 inline-flex items-center gap-1.5 border border-[#2b3445] px-2.5 py-1.5 font-mono text-[9px] text-zinc-400 disabled:opacity-40"><RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> SYNC</button>
        </div>
      </div>

      <div className="grid min-h-[470px] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 border-b border-[#202736] xl:border-b-0 xl:border-r">
          <div className="flex h-11 items-center justify-between border-b border-[#1c2330] px-3 md:px-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] font-semibold text-zinc-100">{pair.replace('USDT', '/USDT')}</span>
              <span className="font-mono text-[9px] text-zinc-600">BINANCE PUBLIC FEED · {tf}</span>
              <span className="font-mono text-[8px] text-cyan-300/70">FUTURES PAPER OVERLAY</span>
            </div>
            <div className="flex items-baseline gap-2 font-mono">
              <span className="text-[12px] text-zinc-100">{price(market?.lastPrice)}</span>
              <span className={`text-[9px] ${change == null ? 'text-zinc-600' : positive ? 'text-emerald-300' : 'text-red-300'}`}>{change == null ? '' : `${positive ? '+' : ''}${change.toFixed(2)}%`}</span>
            </div>
          </div>
          <div className="relative min-h-[410px] bg-[#0a0c12]">
            {market && market.candles.length ? <QuantChart candles={market.candles} trades={chartTrades} height={410} /> : (
              <div className="flex h-[410px] items-center justify-center">
                <div className="text-center">
                  {marketError ? <WifiOff className="mx-auto h-5 w-5 text-red-300" /> : <Activity className="mx-auto h-5 w-5 animate-pulse text-cyan-300" />}
                  <p className={`mt-3 font-mono text-[9px] uppercase tracking-[.14em] ${marketError ? 'text-red-300' : 'text-zinc-500'}`}>{marketError ? 'MARKET FEED UNAVAILABLE' : 'LOADING REAL CANDLES'}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="bg-[#080b11]">
          <div className="border-b border-[#202736] p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-mono text-[9px] uppercase tracking-[.16em] text-cyan-300"><Bot className="h-3.5 w-3.5" /> ENGINE STATE</div>
              <span className={`h-2 w-2 rounded-full ${runnerAlive ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.75)]' : 'bg-red-400'}`} />
            </div>
            <div className={`mt-3 font-mono text-[15px] font-semibold ${runnerAlive ? 'text-emerald-300' : 'text-red-300'}`}>{runnerAlive ? 'AUTONOMOUS PAPER ACTIVE' : 'RUNNER NOT VERIFIED'}</div>
            <p className="mt-1 text-[9px] leading-4 text-zinc-600">Heartbeat {ageLabel(runner?.lastTickAt)} · cycle #{Number(runner?.totalCycles ?? 0).toLocaleString()} · {runner?.source ?? 'unknown source'}</p>
          </div>

          <div className="grid grid-cols-2 border-b border-[#202736]">
            {[
              ['OPEN POSITIONS', String(openPositions.length)],
              ['CYCLE SCANNED', String(cycle?.scanned ?? '—')],
              ['CLOSED / CYCLE', String(cycle?.closed ?? '—')],
              ['SAMPLE P&L', money(stats?.sampleRealizedPnl)],
            ].map(([label, value], index) => <div key={label} className={`p-3 ${index % 2 === 0 ? 'border-r' : ''} ${index < 2 ? 'border-b' : ''} border-[#202736]`}><div className="font-mono text-[8px] uppercase tracking-[.12em] text-zinc-600">{label}</div><div className={`mt-1.5 font-mono text-[12px] ${label === 'SAMPLE P&L' && (stats?.sampleRealizedPnl ?? 0) < 0 ? 'text-red-300' : label === 'SAMPLE P&L' && (stats?.sampleRealizedPnl ?? 0) > 0 ? 'text-emerald-300' : 'text-zinc-200'}`}>{value}</div></div>)}
          </div>

          <div className="p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[8px] uppercase tracking-[.16em] text-zinc-600">AUTONOMOUS DECISION TAPE</span>
              <span className={`font-mono text-[8px] ${runnerAlive ? 'text-emerald-300' : 'text-amber-300'}`}>{runnerAlive ? 'LIVE HEARTBEAT' : 'STALE'}</span>
            </div>
            <div className="mt-3 space-y-2">
              {latestDecisions.length ? latestDecisions.map((decision, index) => {
                const opened = decision.status === 'paper_open';
                return <div key={`${decision.profile ?? 'profile'}-${decision.pair ?? 'pair'}-${index}`} className="border border-[#1f2633] bg-[#070a0f] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-[9px] text-zinc-200">{shortPair(String(decision.pair ?? '—'))}</span><span className={`font-mono text-[8px] ${opened ? 'text-emerald-300' : 'text-amber-300'}`}>{opened ? `${decision.side ?? ''} OPEN` : 'NO TRADE'}</span></div>
                  <div className="mt-1 flex items-center justify-between gap-2 font-mono text-[8px] text-zinc-600"><span>{String(decision.profile ?? 'engine')}</span><span className="truncate">{String(decision.reason ?? decision.status ?? 'evaluated')}</span></div>
                </div>;
              }) : <div className="border border-[#1f2633] p-3 text-[9px] text-zinc-600">Awaiting a verified autonomous cycle.</div>}
            </div>
          </div>
        </aside>
      </div>

      <div className="grid grid-cols-1 border-t border-[#202736] xl:grid-cols-2">
        <div className="border-b border-[#202736] bg-[#070a0f] xl:border-b-0 xl:border-r">
          <div className="flex h-9 items-center justify-between border-b border-[#202736] px-3.5">
            <span className="font-mono text-[8px] uppercase tracking-[.16em] text-zinc-500">OPEN PAPER POSITIONS</span>
            <span className="font-mono text-[8px] text-zinc-600">ENTRY · TP · SL · LEVERAGE</span>
          </div>
          <div className="overflow-x-auto">
            {openPositions.length ? <table className="w-full min-w-[620px] border-collapse font-mono text-[9px]">
              <thead className="text-zinc-600"><tr className="border-b border-[#1b2230]"><th className="px-3 py-2 text-left font-normal">PAIR</th><th className="px-3 py-2 text-left font-normal">SIDE</th><th className="px-3 py-2 text-right font-normal">ENTRY</th><th className="px-3 py-2 text-right font-normal">TP</th><th className="px-3 py-2 text-right font-normal">SL</th><th className="px-3 py-2 text-right font-normal">LEV</th><th className="px-3 py-2 text-right font-normal">MARGIN</th></tr></thead>
              <tbody>{openPositions.map((trade) => <tr key={trade.id} className="border-b border-[#141a24] last:border-b-0"><td className="px-3 py-2.5 text-zinc-200">{trade.pair}</td><td className={`px-3 py-2.5 ${trade.side === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}`}>{trade.side}</td><td className="px-3 py-2.5 text-right text-zinc-300">{price(trade.entryPrice)}</td><td className="px-3 py-2.5 text-right text-emerald-300/80">{price(trade.targetPrice)}</td><td className="px-3 py-2.5 text-right text-red-300/80">{price(trade.stopPrice)}</td><td className="px-3 py-2.5 text-right text-zinc-400">{trade.leverage ? `${trade.leverage}x` : '—'}</td><td className="px-3 py-2.5 text-right text-zinc-400">{money(trade.capitalUsed)}</td></tr>)}</tbody>
            </table> : <div className="flex min-h-[92px] items-center justify-center px-4 text-center font-mono text-[9px] text-zinc-600">NO OPEN PAPER POSITION · CAPITAL STAYS IDLE UNTIL A SETUP PASSES THE GATES</div>}
          </div>
        </div>

        <div className="bg-[#070a0f]">
          <div className="flex h-9 items-center justify-between border-b border-[#202736] px-3.5">
            <span className="font-mono text-[8px] uppercase tracking-[.16em] text-zinc-500">RECENT FUTURES EXECUTIONS</span>
            <span className="font-mono text-[8px] text-zinc-600">VERIFIED PAPER LEDGER</span>
          </div>
          <div className="overflow-x-auto">
            {recentClosed.length ? <table className="w-full min-w-[620px] border-collapse font-mono text-[9px]">
              <thead className="text-zinc-600"><tr className="border-b border-[#1b2230]"><th className="px-3 py-2 text-left font-normal">PAIR</th><th className="px-3 py-2 text-left font-normal">SIDE</th><th className="px-3 py-2 text-left font-normal">EXIT</th><th className="px-3 py-2 text-right font-normal">ENTRY</th><th className="px-3 py-2 text-right font-normal">CLOSE</th><th className="px-3 py-2 text-right font-normal">P&L</th></tr></thead>
              <tbody>{recentClosed.map((trade) => <tr key={trade.id} className="border-b border-[#141a24] last:border-b-0"><td className="px-3 py-2.5 text-zinc-200">{trade.pair}</td><td className={`px-3 py-2.5 ${trade.side === 'LONG' ? 'text-emerald-300' : 'text-rose-300'}`}>{trade.side}</td><td className="px-3 py-2.5 text-zinc-500">{trade.exitReason ?? 'exit'}</td><td className="px-3 py-2.5 text-right text-zinc-400">{price(trade.entryPrice)}</td><td className="px-3 py-2.5 text-right text-zinc-400">{price(trade.exitPrice)}</td><td className={`px-3 py-2.5 text-right ${tradeTone(trade)}`}>{money(trade.pnl)}</td></tr>)}</tbody>
            </table> : <div className="flex min-h-[92px] items-center justify-center px-4 text-center font-mono text-[9px] text-zinc-600">NO VERIFIED CLOSED FUTURES TRADES IN THE STATUS WINDOW</div>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-px border-t border-[#202736] bg-[#202736] sm:grid-cols-3">
        <div className="bg-[#080b11] px-3 py-2.5"><div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-red-300" /><span className="font-mono text-[8px] text-zinc-500">EXECUTION BOUNDARY</span></div><div className="mt-1 font-mono text-[10px] text-red-300">REAL ORDERS DISABLED</div></div>
        <div className="bg-[#080b11] px-3 py-2.5"><div className="flex items-center gap-2"><Zap className="h-3.5 w-3.5 text-amber-300" /><span className="font-mono text-[8px] text-zinc-500">TOP NO-TRADE GATES</span></div><div className="mt-1 truncate font-mono text-[9px] text-zinc-300">{blockers.length ? blockers.map(([reason, count]) => `${reason}×${count}`).join(' · ') : 'AWAITING SCAN'}</div></div>
        <div className="bg-[#080b11] px-3 py-2.5"><div className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-cyan-300" /><span className="font-mono text-[8px] text-zinc-500">DATA PROVENANCE</span></div><div className="mt-1 font-mono text-[9px] text-zinc-300">BINANCE MARKET DATA · SUPABASE PAPER LEDGER</div></div>
      </div>
    </section>
  );
}
