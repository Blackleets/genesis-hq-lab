import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, Crosshair, RefreshCw, ShieldCheck, WifiOff, Zap } from 'lucide-react';
import QuantChart, { type ChartCandle } from '@workflows/QuantChart';
import { fetchCaptureReport, type CaptureReport } from '@services/captureClient';
import { useTruthLayer } from '@hooks/useTruthLayer';

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT'] as const;
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

const ageLabel = (iso: string | null | undefined) => {
  if (!iso) return 'NO HEARTBEAT';
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 90) return `${seconds}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
};

export function AutonomousTradingTerminal({ es = true }: { es?: boolean }) {
  const [pair, setPair] = useState<Pair>('BTCUSDT');
  const [tf, setTf] = useState<Timeframe>('5m');
  const [market, setMarket] = useState<MarketPayload | null>(null);
  const [capture, setCapture] = useState<CaptureReport | null>(null);
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

  const loadCapture = useCallback(async () => {
    try {
      const report = await fetchCaptureReport(40);
      if (report.ok && report.paper === true) setCapture(report);
    } catch {
      setCapture(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy(true);
    await Promise.all([loadMarket(), loadCapture()]);
    setBusy(false);
  }, [loadCapture, loadMarket]);

  useEffect(() => {
    void refresh();
    const marketTimer = window.setInterval(() => void loadMarket(), 15_000);
    const captureTimer = window.setInterval(() => void loadCapture(), 30_000);
    return () => { window.clearInterval(marketTimer); window.clearInterval(captureTimer); };
  }, [refresh, loadMarket, loadCapture]);

  const f = capture?.funding;
  const runner = truth?.agentRunner;
  const runnerAlive = runner?.agentAlive === true;
  const captureFresh = capture?.updatedAt ? Date.now() - Date.parse(capture.updatedAt) < 10 * 60_000 : false;
  const latestRows = capture?.rows?.slice(0, 6) ?? [];
  const blockers = useMemo(() => {
    const reasons = new Map<string, number>();
    for (const row of capture?.rows ?? []) reasons.set(row.reason, (reasons.get(row.reason) ?? 0) + 1);
    return [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [capture]);

  const change = market?.changePct ?? null;
  const positive = typeof change === 'number' && change >= 0;

  return (
    <section className="shrink-0 border-b border-[#202736] bg-[#05070b] text-zinc-100" aria-label="Autonomous paper trading terminal">
      <div className="flex flex-col gap-3 border-b border-[#202736] px-3 py-3 md:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center border border-cyan-400/30 bg-cyan-400/5 text-cyan-300"><Crosshair className="h-4 w-4" /></div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] font-semibold tracking-[.12em] text-zinc-100">TRADING DESK</span>
              <span className="border border-amber-400/30 bg-amber-400/5 px-2 py-1 font-mono text-[8px] text-amber-300">AUTONOMOUS PAPER</span>
              <span className="border border-red-400/30 bg-red-400/5 px-2 py-1 font-mono text-[8px] text-red-300">LIVE LOCKED</span>
            </div>
            <p className="mt-1 text-[9px] text-zinc-600">{es ? 'Velas reales de mercado · decisiones paper · ejecución real desactivada' : 'Real market candles · paper decisions · real execution disabled'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PAIRS.map((item) => <button key={item} type="button" onClick={() => setPair(item)} className={`border px-2.5 py-1.5 font-mono text-[9px] ${pair === item ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-200' : 'border-[#252d3c] text-zinc-500 hover:text-zinc-200'}`}>{item.replace('USDT', '')}</button>)}
          <span className="mx-1 h-5 w-px bg-[#252d3c]" />
          {TIMEFRAMES.map((item) => <button key={item} type="button" onClick={() => setTf(item)} className={`border px-2 py-1.5 font-mono text-[9px] ${tf === item ? 'border-violet-400/40 bg-violet-400/10 text-violet-200' : 'border-[#252d3c] text-zinc-500 hover:text-zinc-200'}`}>{item}</button>)}
          <button type="button" onClick={() => void refresh()} disabled={busy} className="ml-1 inline-flex items-center gap-1.5 border border-[#2b3445] px-2.5 py-1.5 font-mono text-[9px] text-zinc-400 disabled:opacity-40"><RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> SYNC</button>
        </div>
      </div>

      <div className="grid min-h-[420px] grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 border-b border-[#202736] xl:border-b-0 xl:border-r">
          <div className="flex h-10 items-center justify-between border-b border-[#1c2330] px-3 md:px-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[11px] font-semibold text-zinc-100">{pair.replace('USDT', '/USDT')}</span>
              <span className="font-mono text-[9px] text-zinc-600">BINANCE SPOT · {tf}</span>
            </div>
            <div className="flex items-baseline gap-2 font-mono">
              <span className="text-[12px] text-zinc-100">{market?.lastPrice != null ? market.lastPrice.toLocaleString('en-US', { maximumFractionDigits: market.lastPrice < 1 ? 6 : 2 }) : '—'}</span>
              <span className={`text-[9px] ${change == null ? 'text-zinc-600' : positive ? 'text-emerald-300' : 'text-red-300'}`}>{change == null ? '' : `${positive ? '+' : ''}${change.toFixed(2)}%`}</span>
            </div>
          </div>
          <div className="relative min-h-[360px] bg-[#0a0c12]">
            {market && market.candles.length ? <QuantChart candles={market.candles} trades={[]} height={360} /> : (
              <div className="flex h-[360px] items-center justify-center">
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
            <div className={`mt-3 font-mono text-[15px] font-semibold ${runnerAlive ? 'text-emerald-300' : 'text-red-300'}`}>{runnerAlive ? 'RUNNER ACTIVE' : 'RUNNER NOT VERIFIED'}</div>
            <p className="mt-1 text-[9px] leading-4 text-zinc-600">Heartbeat {ageLabel(runner?.lastTickAt)} · {Number(runner?.totalCycles ?? 0).toLocaleString()} recorded cycles</p>
          </div>

          <div className="grid grid-cols-2 border-b border-[#202736]">
            {[
              ['PAPER EQUITY', money(f?.equityUsdt)],
              ['ECONOMIC P&L', money(f?.economicPnlUsdt)],
              ['OPEN HOLDS', String(f?.holds?.length ?? 0)],
              ['SCAN / QUOTE', `${capture?.scanned ?? 0} / ${capture?.quoted ?? 0}`],
            ].map(([label, value], index) => <div key={label} className={`p-3 ${index % 2 === 0 ? 'border-r' : ''} ${index < 2 ? 'border-b' : ''} border-[#202736]`}><div className="font-mono text-[8px] uppercase tracking-[.12em] text-zinc-600">{label}</div><div className={`mt-1.5 font-mono text-[12px] ${label === 'ECONOMIC P&L' && (f?.economicPnlUsdt ?? 0) < 0 ? 'text-red-300' : 'text-zinc-200'}`}>{value}</div></div>)}
          </div>

          <div className="p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[8px] uppercase tracking-[.16em] text-zinc-600">DECISION TAPE</span>
              <span className={`font-mono text-[8px] ${captureFresh ? 'text-emerald-300' : 'text-amber-300'}`}>{captureFresh ? 'FRESH' : 'STALE'}</span>
            </div>
            <div className="mt-3 space-y-2">
              {latestRows.length ? latestRows.map((row) => <div key={row.symbol} className="border border-[#1f2633] bg-[#070a0f] px-2.5 py-2">
                <div className="flex items-center justify-between gap-2"><span className="font-mono text-[9px] text-zinc-200">{row.symbol.replace('-USDT-SWAP', '')}</span><span className="font-mono text-[8px] text-amber-300">{row.reason}</span></div>
                <div className="mt-1 flex gap-3 font-mono text-[8px] text-zinc-600"><span>SPR {Number.isFinite(row.spreadBps) ? row.spreadBps.toFixed(2) : '—'}bp</span><span>VPIN {Number.isFinite(row.vpin) ? row.vpin.toFixed(2) : '—'}</span></div>
              </div>) : <div className="border border-[#1f2633] p-3 text-[9px] text-zinc-600">No verified scanner rows.</div>}
            </div>
          </div>
        </aside>
      </div>

      <div className="grid grid-cols-1 gap-px border-t border-[#202736] bg-[#202736] sm:grid-cols-3">
        <div className="bg-[#080b11] px-3 py-2.5"><div className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-red-300" /><span className="font-mono text-[8px] text-zinc-500">EXECUTION</span></div><div className="mt-1 font-mono text-[10px] text-red-300">REAL ORDERS DISABLED</div></div>
        <div className="bg-[#080b11] px-3 py-2.5"><div className="flex items-center gap-2"><Zap className="h-3.5 w-3.5 text-amber-300" /><span className="font-mono text-[8px] text-zinc-500">TOP BLOCKERS</span></div><div className="mt-1 truncate font-mono text-[9px] text-zinc-300">{blockers.length ? blockers.map(([reason, count]) => `${reason}×${count}`).join(' · ') : 'AWAITING SCAN'}</div></div>
        <div className="bg-[#080b11] px-3 py-2.5"><div className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-cyan-300" /><span className="font-mono text-[8px] text-zinc-500">MARKET SOURCE</span></div><div className="mt-1 font-mono text-[9px] text-zinc-300">REAL BINANCE CANDLES · PAPER DECISIONS</div></div>
      </div>
    </section>
  );
}
