import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  Activity, Bot, CircleDollarSign, Crosshair, DatabaseZap, Gauge,
  Layers3, Radar, RefreshCw, ShieldAlert, TrendingDown, TrendingUp, Zap,
} from 'lucide-react';
import { fetchCaptureReport, type CaptureReport, type CaptureRow } from '@services/captureClient';
import { FounderControlRoom } from './FounderControlRoom';

const panel = 'border border-[#242b3a] bg-[#0d1119] shadow-[0_14px_45px_rgba(0,0,0,.2)]';
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const usd = (value: unknown, digits = 2) => finite(value)
  ? `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
  : 'Awaiting';
const bps = (value: unknown) => finite(value) ? `${value.toFixed(2)} bps` : '—';
const pct = (value: unknown) => finite(value) ? `${(value * 100).toFixed(0)}%` : '—';
const shortSymbol = (symbol: string) => symbol.replace('-USDT-SWAP', '').replace('USDT', '');

function tone(value: unknown) {
  if (!finite(value)) return 'text-zinc-400';
  return value > 0 ? 'text-emerald-300' : value < 0 ? 'text-red-300' : 'text-zinc-300';
}

function EmptyVisual({ label }: { label: string }) {
  return (
    <div className="relative h-full min-h-[180px] overflow-hidden border border-[#202736] bg-[#080b11]">
      <div className="absolute inset-0 opacity-35" style={{ backgroundImage: 'linear-gradient(#202736 1px, transparent 1px), linear-gradient(90deg, #202736 1px, transparent 1px)', backgroundSize: '34px 34px' }} />
      <div className="absolute inset-x-0 top-1/2 h-px bg-gradient-to-r from-transparent via-cyan-400/30 to-transparent" />
      <div className="relative flex h-full min-h-[180px] items-center justify-center px-6 text-center">
        <div><DatabaseZap className="mx-auto h-5 w-5 text-zinc-600" /><p className="mt-3 text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500">{label}</p></div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, hint, icon, valueTone = 'text-zinc-100', accent = 'cyan' }: {
  label: string; value: string; hint: string; icon: ReactNode; valueTone?: string; accent?: 'cyan' | 'amber' | 'red' | 'green';
}) {
  const accentClass = accent === 'green' ? 'text-emerald-300 border-emerald-400/20 bg-emerald-400/5'
    : accent === 'amber' ? 'text-amber-300 border-amber-400/20 bg-amber-400/5'
      : accent === 'red' ? 'text-red-300 border-red-400/20 bg-red-400/5'
        : 'text-cyan-300 border-cyan-400/20 bg-cyan-400/5';
  return (
    <article className={`${panel} relative overflow-hidden p-3.5 md:p-4`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="flex items-center justify-between gap-2">
        <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-zinc-600">{label}</div>
        <div className={`flex h-7 w-7 items-center justify-center border ${accentClass}`}>{icon}</div>
      </div>
      <div className={`mt-3 font-mono text-[19px] md:text-[22px] font-semibold tracking-tight ${valueTone}`}>{value}</div>
      <div className="mt-1 text-[9px] leading-4 text-zinc-500">{hint}</div>
    </article>
  );
}

function CaptureFunnel({ report }: { report: CaptureReport | null }) {
  const scanned = report?.scanned ?? 0;
  const scored = report?.scored ?? scanned;
  const quoted = report?.quoted ?? 0;
  const filled = report?.filled ?? 0;
  const stages = [
    ['SCANNED', scanned], ['SCORED', scored], ['QUOTED', quoted], ['FILLED', filled],
  ] as const;
  const base = Math.max(1, scanned);
  return (
    <div className="space-y-3">
      {stages.map(([label, count], index) => (
        <div key={label}>
          <div className="mb-1.5 flex items-center justify-between text-[9px] font-mono">
            <span className="text-zinc-500">{label}</span><span className="text-zinc-300">{count}</span>
          </div>
          <div className="h-2 overflow-hidden bg-[#070a0f] border border-[#202736]">
            <div className={`h-full ${index < 2 ? 'bg-cyan-400/60' : index === 2 ? 'bg-amber-400/60' : 'bg-emerald-400/70'}`} style={{ width: `${Math.max(count > 0 ? 4 : 0, Math.min(100, count / base * 100))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function ToxicityGauge({ rows }: { rows: CaptureRow[] }) {
  const values = rows.map(row => row.vpin).filter(finite);
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const degrees = average == null ? 0 : Math.min(360, Math.max(0, average * 360));
  const label = average == null ? 'NO FEED' : average >= .8 ? 'TOXIC' : average >= .6 ? 'ELEVATED' : average >= .4 ? 'WATCH' : 'CALM';
  return (
    <div className="flex items-center gap-4">
      <div className="relative h-[86px] w-[86px] shrink-0 rounded-full p-[7px]" style={{ background: average == null ? '#1d2430' : `conic-gradient(${average >= .8 ? '#ff4757' : average >= .6 ? '#ffb547' : '#22d3ee'} ${degrees}deg, #1d2430 ${degrees}deg 360deg)` }}>
        <div className="flex h-full w-full flex-col items-center justify-center rounded-full border border-[#242b3a] bg-[#080b11]">
          <span className="font-mono text-base font-bold text-zinc-100">{average == null ? '—' : average.toFixed(2)}</span>
          <span className="text-[7px] font-mono uppercase tracking-wider text-zinc-600">VPIN AVG</span>
        </div>
      </div>
      <div>
        <div className="text-[8px] font-mono uppercase tracking-[0.16em] text-zinc-600">MARKET TOXICITY</div>
        <div className={`mt-1 font-mono text-[13px] ${average != null && average >= .8 ? 'text-red-300' : average != null && average >= .6 ? 'text-amber-300' : 'text-cyan-300'}`}>{label}</div>
        <p className="mt-1 max-w-[170px] text-[9px] leading-4 text-zinc-500">Average VPIN across the current capture universe. High toxicity blocks maker quotes.</p>
      </div>
    </div>
  );
}

export function GenesisCommandCenter({ es = true }: { es?: boolean }) {
  const [report, setReport] = useState<CaptureReport | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await fetchCaptureReport(40);
      if (!result.ok || result.paper !== true) throw new Error('Capture unavailable');
      setReport(result);
      setError(false);
    } catch {
      setReport(null);
      setError(true);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load]);

  const f = report?.funding;
  const rows = report?.rows ?? [];
  const startCapital = report?.ledger?.start ?? report?.capital ?? null;
  const equityPct = f && finite(startCapital) && startCapital > 0 ? f.equityUsdt / startCapital : null;
  const paperDelta = f && finite(startCapital) ? f.equityUsdt - startCapital : null;
  const feedAge = report?.updatedAt ? Math.max(0, Math.round((Date.now() - Date.parse(report.updatedAt)) / 1000)) : null;

  const pnlBridge = useMemo(() => f ? [
    { name: 'PRICE', value: f.realizedPricePnlUsdt },
    { name: 'FUNDING', value: f.realizedFundingUsdt },
    { name: 'FEES', value: -f.feesUsdt },
    { name: 'OPEN MTM', value: f.mtmUsdt },
  ] : [], [f]);

  const pulseData = useMemo(() => rows.slice(0, 14).map((row, index) => ({
    i: index + 1,
    symbol: shortSymbol(row.symbol),
    spread: finite(row.spreadBps) ? row.spreadBps : 0,
    harvest: finite(row.harvestBps) ? row.harvestBps : 0,
    vpin: finite(row.vpin) ? row.vpin * 10 : 0,
  })), [rows]);

  const maxSpread = rows.map(row => row.spreadBps).filter(finite).reduce((max, value) => Math.max(max, value), 0);
  const quotedRate = report && report.scanned > 0 ? report.quoted / report.scanned : 0;

  const research = [
    { icon: <Crosshair className="h-4 w-4" />, desk: 'Crypto Futures', market: 'BTC / ETH · liquid perps', state: 'RESEARCH', signal: 'No validated live signal', evidence: 'OOS + costs required', hot: false },
    { icon: <CircleDollarSign className="h-4 w-4" />, desk: 'Funding / Basis', market: 'OKX USDT-SWAP', state: f ? (f.scorecard?.verdict ?? 'PAPER') : 'NO FEED', signal: f ? usd(f.realizedNetPnlUsdt) : 'Awaiting ledger', evidence: f?.scorecard?.edgeEvidence?.sampleOk ? 'Sample gate passed' : 'Sample insufficient', hot: !!f },
    { icon: <Activity className="h-4 w-4" />, desk: 'FX Sessions', market: 'London · New York', state: 'CONNECTOR', signal: 'No verified broker feed', evidence: 'DST + spread + rollover', hot: false },
    { icon: <Layers3 className="h-4 w-4" />, desk: 'LP / Farming', market: 'DeFi pools', state: 'SCANNER', signal: 'No verified net APY', evidence: 'IL + exit liquidity', hot: false },
    { icon: <Radar className="h-4 w-4" />, desk: 'Prediction', market: 'Kalshi / Polymarket', state: 'READ ONLY', signal: 'No validated edge', evidence: 'Settlement + liquidity', hot: false },
  ];

  return (
    <div className="gx-scroll flex-1 min-w-0 min-h-0 overflow-y-auto bg-[#07090e] text-[#e6edf3]">
      <div className="relative overflow-hidden border-b border-[#202736] px-4 py-5 md:px-6 md:py-6">
        <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: 'radial-gradient(circle at 8% -20%, rgba(34,211,238,.11), transparent 36%), radial-gradient(circle at 92% 20%, rgba(124,92,255,.07), transparent 30%)' }} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.24em] text-cyan-300"><Zap className="h-3.5 w-3.5" /> GENESIS QUANT COMMAND DECK</div>
            <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-[-0.03em] text-zinc-50">{es ? 'El cerebro busca edge. El fundador controla el capital.' : 'The brain hunts edge. The founder controls capital.'}</h1>
            <p className="mt-2 max-w-2xl text-[10px] md:text-[11px] leading-5 text-zinc-500">Truth Ledger v2 · real market inputs · paper economics · no live order path from this console</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="border border-amber-400/30 bg-amber-400/5 px-2.5 py-1.5 text-[9px] font-mono text-amber-300">PAPER CAPITAL</span>
            <span className="border border-red-400/30 bg-red-400/5 px-2.5 py-1.5 text-[9px] font-mono text-red-300">LIVE LOCKED</span>
            <span className={`border px-2.5 py-1.5 text-[9px] font-mono ${report ? 'border-emerald-400/25 bg-emerald-400/5 text-emerald-300' : 'border-red-400/25 bg-red-400/5 text-red-300'}`}>{report ? `CAPTURE ${feedAge ?? 0}s` : 'CAPTURE OFFLINE'}</span>
            <button type="button" onClick={() => void load()} disabled={busy} className="inline-flex items-center gap-2 border border-[#2b3445] px-2.5 py-1.5 text-[9px] font-mono text-zinc-400 hover:text-zinc-100 disabled:opacity-40"><RefreshCw className={`h-3 w-3 ${busy ? 'animate-spin' : ''}`} /> REFRESH</button>
          </div>
        </div>
      </div>

      <div className="space-y-3 p-3 md:p-5">
        {error ? (
          <div className="flex items-center gap-2 border border-red-400/20 bg-red-400/[.035] px-3 py-2 text-[10px] text-red-200/80"><ShieldAlert className="h-3.5 w-3.5" /> Capture feed failed. Genesis is not estimating P&L.</div>
        ) : null}

        <section className="grid grid-cols-2 xl:grid-cols-4 gap-2" aria-label="Economic truth metrics">
          <MetricCard label="PAPER EQUITY" value={usd(f?.equityUsdt)} hint={equityPct == null ? 'Awaiting reconciled ledger' : `${(equityPct * 100).toFixed(2)}% of starting paper capital`} icon={<CircleDollarSign className="h-3.5 w-3.5" />} valueTone={tone(paperDelta)} accent={paperDelta != null && paperDelta < 0 ? 'red' : 'green'} />
          <MetricCard label="ECONOMIC P&L" value={usd(f?.economicPnlUsdt)} hint="Price + funding − fees + open MTM" icon={finite(f?.economicPnlUsdt) && f!.economicPnlUsdt < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />} valueTone={tone(f?.economicPnlUsdt)} accent={finite(f?.economicPnlUsdt) && f!.economicPnlUsdt < 0 ? 'red' : 'green'} />
          <MetricCard label="FUNDING COLLECTED" value={usd(f?.realizedFundingUsdt)} hint={f ? `${f.settledCount} settled funding events` : 'No reconciled funding snapshot'} icon={<Activity className="h-3.5 w-3.5" />} valueTone={tone(f?.realizedFundingUsdt)} accent="cyan" />
          <MetricCard label="FEES PAID" value={usd(f?.feesUsdt)} hint={f ? `${f.closedCount} closed paper holds · ledger v${f.ledgerVersion}` : 'Truth Ledger costs unavailable'} icon={<Gauge className="h-3.5 w-3.5" />} valueTone="text-amber-300" accent="amber" />
        </section>

        <FounderControlRoom />

        <section className="grid grid-cols-1 xl:grid-cols-[1.35fr_.65fr] gap-3">
          <div className={`${panel} overflow-hidden`}>
            <div className="flex items-center justify-between gap-3 border-b border-[#242b3a] px-4 py-3">
              <div><div className="text-[9px] font-mono uppercase tracking-[0.18em] text-cyan-300">TRUTH LEDGER V2</div><h2 className="mt-1 text-sm font-semibold text-zinc-100">Economic P&L attribution</h2></div>
              <div className={`font-mono text-[12px] ${tone(f?.economicPnlUsdt)}`}>{usd(f?.economicPnlUsdt)}</div>
            </div>
            <div className="p-3 md:p-4">
              {pnlBridge.length ? (
                <div className="h-[230px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pnlBridge} margin={{ left: -14, right: 6, top: 10, bottom: 0 }}>
                      <CartesianGrid stroke="#202736" vertical={false} />
                      <XAxis dataKey="name" tick={{ fill: '#697386', fontSize: 9 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#566071', fontSize: 9 }} axisLine={false} tickLine={false} width={58} />
                      <Tooltip cursor={{ fill: 'rgba(255,255,255,.025)' }} contentStyle={{ background: '#080b11', border: '1px solid #2b3445', fontSize: 10 }} formatter={(value: number) => [usd(value), 'USDT']} />
                      <ReferenceLine y={0} stroke="#465064" />
                      <Bar dataKey="value" maxBarSize={58} radius={[2, 2, 0, 0]} isAnimationActive={false}>
                        {pnlBridge.map(item => <Cell key={item.name} fill={item.value >= 0 ? '#34d399' : '#ff4757'} fillOpacity={.72} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyVisual label="Awaiting reconciled Truth Ledger snapshot" />}
            </div>
          </div>

          <div className={`${panel} p-4`}>
            <div className="flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.18em] text-cyan-300"><Radar className="h-3.5 w-3.5" /> CAPTURE GATE</div>
            <h2 className="mt-1 text-sm font-semibold text-zinc-100">What survives the market filter?</h2>
            <div className="mt-5"><CaptureFunnel report={report} /></div>
            <div className="my-5 h-px bg-[#202736]" />
            <ToxicityGauge rows={rows} />
            <div className="mt-5 grid grid-cols-2 gap-2 text-[9px] font-mono">
              <div className="border border-[#202736] bg-[#080b11] p-2.5"><div className="text-zinc-600">QUOTE RATE</div><div className="mt-1 text-zinc-200">{report ? `${(quotedRate * 100).toFixed(1)}%` : '—'}</div></div>
              <div className="border border-[#202736] bg-[#080b11] p-2.5"><div className="text-zinc-600">MAX SPREAD</div><div className="mt-1 text-zinc-200">{maxSpread ? `${maxSpread.toFixed(2)} bps` : '—'}</div></div>
            </div>
          </div>
        </section>

        <section className={`${panel} overflow-hidden`}>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[#242b3a] px-4 py-3">
            <div><div className="text-[9px] font-mono uppercase tracking-[0.18em] text-cyan-300">MICROSTRUCTURE PULSE · OKX</div><h2 className="mt-1 text-sm font-semibold text-zinc-100">Spread, harvest and toxicity across the live scan</h2></div>
            <div className="text-[9px] font-mono text-zinc-600">REAL MARKET INPUTS · PAPER EXECUTION</div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_.75fr] gap-0">
            <div className="min-h-[230px] border-b lg:border-b-0 lg:border-r border-[#202736] p-3">
              {pulseData.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={pulseData} margin={{ left: -14, right: 8, top: 10, bottom: 0 }}>
                    <defs><linearGradient id="spreadFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22d3ee" stopOpacity={.28} /><stop offset="100%" stopColor="#22d3ee" stopOpacity={0} /></linearGradient></defs>
                    <CartesianGrid stroke="#202736" vertical={false} />
                    <XAxis dataKey="symbol" tick={{ fill: '#657083', fontSize: 8 }} axisLine={false} tickLine={false} interval={1} />
                    <YAxis tick={{ fill: '#566071', fontSize: 8 }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip contentStyle={{ background: '#080b11', border: '1px solid #2b3445', fontSize: 10 }} formatter={(value: number, name: string) => [name === 'vpin' ? value.toFixed(2) : `${value.toFixed(2)} bps`, name]} />
                    <Area type="monotone" dataKey="spread" stroke="#22d3ee" fill="url(#spreadFade)" strokeWidth={1.5} isAnimationActive={false} />
                    <Area type="monotone" dataKey="harvest" stroke="#34d399" fill="transparent" strokeWidth={1} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : <EmptyVisual label="Waiting for verified market tape" />}
            </div>
            <div className="gx-scroll max-h-[245px] overflow-y-auto p-2">
              {rows.slice(0, 10).map(row => {
                const blocked = !row.quote;
                return (
                  <div key={row.symbol} className="grid grid-cols-[1fr_auto] gap-3 border-b border-[#1d2430] px-2 py-2.5 last:border-b-0">
                    <div className="min-w-0"><div className="flex items-center gap-2"><span className="font-mono text-[10px] text-zinc-200">{shortSymbol(row.symbol)}</span><span className={`h-1.5 w-1.5 rounded-full ${blocked ? 'bg-red-400/70' : 'bg-emerald-400'}`} /></div><div className="mt-1 truncate text-[8px] font-mono text-zinc-600">{row.reason}</div></div>
                    <div className="text-right"><div className="font-mono text-[10px] text-zinc-300">{bps(row.spreadBps)}</div><div className="mt-1 text-[8px] font-mono text-zinc-600">VPIN {pct(row.vpin)}</div></div>
                  </div>
                );
              })}
              {!rows.length ? <div className="p-4 text-[10px] text-zinc-600">No verified tape rows.</div> : null}
            </div>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-end justify-between gap-3 px-1">
            <div><div className="text-[9px] font-mono uppercase tracking-[0.18em] text-cyan-300">RESEARCH DESKS</div><h2 className="mt-1 text-sm font-semibold text-zinc-100">Where the brain is allowed to look for edge</h2></div>
            <div className="hidden sm:block text-[9px] font-mono text-zinc-600">NO DESK IS LIVE-APPROVED</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-2">
            {research.map(item => (
              <article key={item.desk} className={`${panel} relative overflow-hidden p-3.5`}>
                <div className={`absolute left-0 top-0 h-full w-[2px] ${item.hot ? 'bg-cyan-400' : 'bg-zinc-700'}`} />
                <div className="flex items-center justify-between gap-3"><div className={`flex h-8 w-8 items-center justify-center border ${item.hot ? 'border-cyan-400/25 bg-cyan-400/5 text-cyan-300' : 'border-[#242b3a] text-zinc-500'}`}>{item.icon}</div><span className="text-[8px] font-mono uppercase tracking-wider text-amber-300">{item.state}</span></div>
                <h3 className="mt-3 text-[12px] font-semibold text-zinc-100">{item.desk}</h3>
                <p className="mt-1 text-[9px] text-zinc-600">{item.market}</p>
                <div className="mt-4 border-t border-[#202736] pt-3"><div className="text-[8px] font-mono uppercase tracking-wider text-zinc-600">SIGNAL / RESULT</div><div className={`mt-1 font-mono text-[10px] ${item.hot && finite(f?.realizedNetPnlUsdt) ? tone(f?.realizedNetPnlUsdt) : 'text-zinc-300'}`}>{item.signal}</div></div>
                <div className="mt-2 text-[9px] leading-4 text-zinc-500">{item.evidence}</div>
              </article>
            ))}
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#202736] px-1 pt-3 text-[8px] font-mono uppercase tracking-[0.12em] text-zinc-700">
          <span>Truth source: Ledger v{f?.ledgerVersion ?? '—'} · Venue {report?.venue?.toUpperCase() ?? '—'}</span>
          <span>{report?.note ?? 'Genesis refuses to infer profitability without evidence.'}</span>
        </footer>
      </div>
    </div>
  );
}
