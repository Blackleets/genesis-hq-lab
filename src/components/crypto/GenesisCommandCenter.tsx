import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchCaptureReport, type CaptureReport, type CaptureRow } from '@services/captureClient';

type Tone = 'good' | 'bad' | 'warn' | 'muted' | 'info';

interface StatCard {
  label: string;
  value: string;
  hint: string;
  tone: Tone;
}

interface Opportunity {
  desk: string;
  market: string;
  signal: string;
  state: string;
  edge: string;
  blocker: string;
  tone: Tone;
}

interface AgentSeat {
  name: string;
  role: string;
  mission: string;
  state: string;
  connector: string;
  tone: Tone;
}

const AGENTS: AgentSeat[] = [
  {
    name: 'HERMES',
    role: 'Connector Ops',
    mission: 'Activa APIs, enruta datos y reporta fallos sin tocar capital.',
    state: 'armed / read-only',
    connector: 'GitHub · Vercel · OKX public',
    tone: 'info',
  },
  {
    name: 'ATLAS',
    role: 'Quant Research',
    mission: 'Busca oportunidades y crea hipótesis con walk-forward obligatorio.',
    state: 'research',
    connector: 'Crypto · macro · sessions',
    tone: 'warn',
  },
  {
    name: 'SENTINEL',
    role: 'Risk Governor',
    mission: 'Bloquea sobreajuste, drawdown, falta de muestra y live no autorizado.',
    state: 'blocking live',
    connector: 'Truth Ledger v2',
    tone: 'bad',
  },
  {
    name: 'ORACLE',
    role: 'Market Intelligence',
    mission: 'Clasifica regímenes: Asia, Londres, NY, rollover, funding y volatilidad.',
    state: 'needs feeds',
    connector: 'Forex/indices pending',
    tone: 'muted',
  },
  {
    name: 'FORGE',
    role: 'Strategy Factory',
    mission: 'Genera challengers; solo sobreviven si vencen al champion fuera de muestra.',
    state: 'paper lab',
    connector: 'Backtest · evolution',
    tone: 'warn',
  },
  {
    name: 'AUDITOR',
    role: 'Truth & PnL',
    mission: 'Recompensa únicamente P&L económico: precio + funding − fees + MTM.',
    state: 'online',
    connector: 'Ledger · scorecard',
    tone: 'good',
  },
];

const CONNECTORS = [
  { name: 'OKX Public Tape', state: 'online', detail: 'books · trades · funding', tone: 'good' as Tone },
  { name: 'Binance / CCXT', state: 'paper lab', detail: 'market data · no live auto', tone: 'warn' as Tone },
  { name: 'Forex Sessions', state: 'design ready', detail: 'London · NY · Asia calendar', tone: 'muted' as Tone },
  { name: 'Polymarket / Kalshi', state: 'read-only path', detail: 'prediction markets scout', tone: 'info' as Tone },
  { name: 'Broker Execution', state: 'locked', detail: 'requires human GO + keys', tone: 'bad' as Tone },
];

function toneClass(tone: Tone) {
  switch (tone) {
    case 'good': return 'border-emerald-400/35 text-emerald-300 bg-emerald-400/5';
    case 'bad': return 'border-red-400/35 text-red-300 bg-red-400/5';
    case 'warn': return 'border-amber-400/35 text-amber-300 bg-amber-400/5';
    case 'info': return 'border-cyan-400/30 text-cyan-300 bg-cyan-400/5';
    default: return 'border-zinc-700 text-zinc-400 bg-zinc-900/40';
  }
}

function moneyClass(value: number) {
  if (value > 0) return 'text-emerald-300';
  if (value < 0) return 'text-red-300';
  return 'text-zinc-300';
}

function fmtUsd(value: number, sign = true) {
  const safe = Number.isFinite(value) ? value : 0;
  const prefix = sign && safe >= 0 ? '+' : '';
  return `${prefix}$${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(value: number, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function safeBps(value: number | undefined) {
  return Number.isFinite(value) ? `${fmtNum(value as number, 2)} bps` : '—';
}

function sessionLabel(now = new Date()) {
  const utc = now.getUTCHours();
  if (utc >= 23 || utc < 7) return 'Asia / liquidity build';
  if (utc >= 7 && utc < 13) return 'London / FX impulse';
  if (utc >= 13 && utc < 21) return 'New York / risk transfer';
  return 'Rollover / reduce size';
}

function rowTone(row: CaptureRow): Tone {
  if (row.fillCount > 0 && row.netPnl > 0) return 'good';
  if (row.fillCount > 0 && row.netPnl < 0) return 'bad';
  if (row.quote) return 'warn';
  if (row.reason === 'VPIN_HALT' || row.captureReason === 'MARKOUT_HALT') return 'bad';
  return 'muted';
}

function MiniBars({ report }: { report: CaptureReport | null }) {
  const values = useMemo(() => {
    const f = report?.funding;
    return [
      { label: 'price', value: f?.realizedPricePnlUsdt ?? 0 },
      { label: 'funding', value: f?.realizedFundingUsdt ?? 0 },
      { label: 'fees', value: -(f?.feesUsdt ?? 0) },
      { label: 'mtm', value: f?.mtmUsdt ?? 0 },
    ];
  }, [report]);
  const max = Math.max(1, ...values.map((v) => Math.abs(v.value)));

  return (
    <div className="h-32 flex items-end gap-3 px-4 py-3 border border-zinc-800 bg-black/20">
      {values.map((v) => {
        const h = Math.max(4, Math.abs(v.value) / max * 92);
        const positive = v.value >= 0;
        return (
          <div key={v.label} className="flex-1 h-full flex flex-col items-center justify-end gap-2">
            <div className="font-mono text-[9px] text-zinc-500">{fmtUsd(v.value)}</div>
            <div
              className={`w-full max-w-14 border ${positive ? 'border-emerald-400/50 bg-emerald-400/15' : 'border-red-400/50 bg-red-400/15'}`}
              style={{ height: `${h}px` }}
            />
            <div className="font-mono text-[9px] uppercase text-zinc-500">{v.label}</div>
          </div>
        );
      })}
    </div>
  );
}

function MarketDepthSketch({ rows }: { rows: CaptureRow[] }) {
  const visible = rows.slice(0, 9);
  return (
    <div className="border border-zinc-800 bg-[#05070b] p-3 min-h-[214px]">
      <div className="flex items-center justify-between mb-3">
        <div className="gx-overline">Opportunity book</div>
        <div className="font-mono text-[9px] text-zinc-600">quotes are paper · no live orders</div>
      </div>
      <div className="space-y-1.5">
        {visible.length === 0 && (
          <div className="font-mono text-[11px] text-zinc-600 py-12 text-center">waiting for tape…</div>
        )}
        {visible.map((row) => (
          <div key={row.symbol} className="grid grid-cols-[1fr_72px_72px_80px] gap-2 items-center text-[11px] font-mono">
            <div className="truncate text-zinc-300">{row.symbol.replace('-USDT-SWAP', '')}</div>
            <div className={row.quote ? 'text-amber-300' : 'text-zinc-600'}>{row.quote ? 'QUOTE' : row.reason}</div>
            <div className="text-zinc-500 text-right">{safeBps(row.harvestBps)}</div>
            <div className={`text-right ${moneyClass(row.netPnl)}`}>{fmtUsd(row.netPnl)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PixelOffice({ agents }: { agents: AgentSeat[] }) {
  return (
    <div className="border border-zinc-800 bg-[#060912] p-4 overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div className="gx-overline">Pixel office / live desks</div>
        <div className="font-mono text-[9px] text-zinc-600">visual state, backed by real gates</div>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {agents.map((agent, idx) => (
          <div key={agent.name} className="col-span-2 border border-zinc-800 bg-black/30 p-2 min-h-20 relative">
            <div className={`absolute top-2 right-2 h-2 w-2 ${agent.tone === 'good' ? 'bg-emerald-400' : agent.tone === 'bad' ? 'bg-red-400' : agent.tone === 'warn' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
            <div className="font-mono text-[10px] text-zinc-200">{agent.name}</div>
            <div className="font-mono text-[8px] text-zinc-600 mt-1">desk {idx + 1}</div>
            <div className="mt-3 flex gap-1">
              {Array.from({ length: 5 }).map((_, i) => (
                <span key={i} className={`h-2 w-2 ${i <= idx % 5 ? 'bg-zinc-500' : 'bg-zinc-800'}`} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GenesisCommandCenter({ es = true }: { es?: boolean }) {
  const [report, setReport] = useState<CaptureReport | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetchCaptureReport(40);
      setReport(r);
      if (!r.ok && r.error) setErr(r.error);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'feed unavailable');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const funding = report?.funding;
  const capital = report?.capital ?? 10_000;
  const fundingCollected = funding?.realizedFundingUsdt ?? 0;
  const priceRealized = funding?.realizedPricePnlUsdt ?? 0;
  const fees = funding?.feesUsdt ?? 0;
  const realizedNet = funding?.realizedNetPnlUsdt ?? (fundingCollected + priceRealized - fees);
  const economicPnl = funding?.economicPnlUsdt ?? realizedNet + (funding?.mtmUsdt ?? 0);
  const equity = funding?.equityUsdt ?? capital + economicPnl;
  const equityPct = capital > 0 ? ((equity - capital) / capital) * 100 : 0;
  const rows = report?.rows ?? [];
  const activeRows = rows.filter((row) => row.reason !== 'TAPE_PENDING');
  const topRows = [...activeRows].sort((a, b) => (b.harvestBps || -999) - (a.harvestBps || -999)).slice(0, 9);

  const stats: StatCard[] = [
    { label: 'Equity paper', value: fmtUsd(equity, false), hint: `${fmtNum(equityPct, 3)}% vs start`, tone: equity >= capital ? 'good' : 'bad' },
    { label: 'Realized net', value: fmtUsd(realizedNet), hint: 'price + funding − fees', tone: realizedNet > 0 ? 'good' : realizedNet < 0 ? 'bad' : 'muted' },
    { label: 'Funding', value: fmtUsd(fundingCollected), hint: `${funding?.settledCount ?? 0} settles`, tone: fundingCollected > 0 ? 'good' : 'muted' },
    { label: 'Scanned', value: `${report?.scanned ?? 0}`, hint: `${report?.quoted ?? 0} quotes · ${report?.filled ?? 0} fills`, tone: (report?.quoted ?? 0) > 0 ? 'warn' : 'muted' },
  ];

  const opportunities: Opportunity[] = [
    {
      desk: 'Funding Carry',
      market: 'OKX USDT-SWAP',
      signal: funding?.scorecard?.verdict ?? 'NO_TAPE',
      state: report?.paper ? 'PAPER' : 'UNKNOWN',
      edge: fmtUsd(realizedNet),
      blocker: realizedNet > 0 ? 'sample / live locked' : 'economic P&L negative',
      tone: realizedNet > 0 ? 'warn' : 'bad',
    },
    {
      desk: 'Market Making',
      market: 'OKX microstructure',
      signal: `${report?.quoted ?? 0} quotes`,
      state: 'STAND DOWN',
      edge: `${report?.filled ?? 0} fills`,
      blocker: 'VPIN / spread / adverse selection',
      tone: 'muted',
    },
    {
      desk: 'Crypto Momentum',
      market: 'BTC · ETH · majors',
      signal: 'research queue',
      state: 'ASTRA-ready',
      edge: 'not promoted',
      blocker: 'needs OOS + 6 gates',
      tone: 'warn',
    },
    {
      desk: 'Forex Sessions',
      market: sessionLabel(),
      signal: 'calendar design',
      state: 'connector pending',
      edge: 'no P&L yet',
      blocker: 'needs broker/feed + costs',
      tone: 'muted',
    },
    {
      desk: 'Prediction Markets',
      market: 'Kalshi / Polymarket',
      signal: 'read-only scout',
      state: 'gated',
      edge: 'no live edge',
      blocker: 'liquidity + settlement risk',
      tone: 'info',
    },
  ];

  return (
    <div className="flex-1 min-h-0 bg-[#03050a] text-zinc-100 overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-zinc-800/90 bg-[#05070c]/95 backdrop-blur px-4 md:px-6 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-300">Genesis Command Center</div>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight mt-0.5">
              {es ? 'Trading company OS — paper, brutalmente honesto' : 'Trading company OS — paper, brutally honest'}
            </h1>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[9px] uppercase tracking-wider">
            <span className={toneClass(report?.paper ? 'warn' : 'bad') + ' border px-2 py-1'}>{report?.paper ? 'PAPER' : 'UNKNOWN'}</span>
            <span className={toneClass(report?.liveOff !== false ? 'bad' : 'good') + ' border px-2 py-1'}>{report?.liveOff !== false ? 'LIVE OFF' : 'LIVE'}</span>
            <span className={toneClass(report?.go ? 'good' : 'bad') + ' border px-2 py-1'}>{report?.go ? 'GO' : 'NO GO'}</span>
            <button onClick={() => void load()} disabled={busy} className="gx-btn text-[9px] disabled:opacity-40">{busy ? 'sync…' : 'refresh'}</button>
          </div>
        </div>
      </div>

      <section className="px-4 md:px-6 py-5 grid grid-cols-1 2xl:grid-cols-[1.1fr_0.9fr] gap-4">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
            {stats.map((card) => (
              <article key={card.label} className="border border-zinc-800 bg-[#080b12] px-4 py-3">
                <div className="gx-label">{card.label}</div>
                <div className={`gx-value text-[24px] mt-1 ${card.tone === 'good' ? 'text-emerald-300' : card.tone === 'bad' ? 'text-red-300' : 'text-zinc-100'}`}>{card.value}</div>
                <div className="font-mono text-[9px] text-zinc-600 mt-1">{card.hint}</div>
              </article>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[1fr_0.9fr] gap-3">
            <div className="border border-zinc-800 bg-[#080b12] p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="gx-overline">Professional P&L bridge</div>
                  <div className="text-sm text-zinc-400 mt-1">Truth Ledger v2: no recompensa métricas incompletas.</div>
                </div>
                <div className={`font-mono text-[12px] ${moneyClass(economicPnl)}`}>{fmtUsd(economicPnl)}</div>
              </div>
              <MiniBars report={report} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 font-mono text-[10px]">
                <div className="border border-zinc-800 px-3 py-2"><span className="text-zinc-600">price</span><br /><span className={moneyClass(priceRealized)}>{fmtUsd(priceRealized)}</span></div>
                <div className="border border-zinc-800 px-3 py-2"><span className="text-zinc-600">funding</span><br /><span className={moneyClass(fundingCollected)}>{fmtUsd(fundingCollected)}</span></div>
                <div className="border border-zinc-800 px-3 py-2"><span className="text-zinc-600">fees</span><br /><span className="text-red-300">{fmtUsd(-Math.abs(fees))}</span></div>
                <div className="border border-zinc-800 px-3 py-2"><span className="text-zinc-600">ledger</span><br /><span className="text-zinc-300">v{funding?.ledgerVersion ?? 2}</span></div>
              </div>
            </div>
            <MarketDepthSketch rows={topRows} />
          </div>

          <div className="border border-zinc-800 bg-[#080b12] p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="gx-overline">Global opportunity matrix</div>
                <div className="text-sm text-zinc-400 mt-1">Crypto, funding, market making, prediction markets y forex sessions — todo con estado honesto.</div>
              </div>
              <div className="font-mono text-[9px] text-zinc-600">{report?.updatedAt ? new Date(report.updatedAt).toLocaleTimeString('es-ES') : 'not synced'}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-[11px] min-w-[780px]">
                <thead className="text-zinc-600 border-b border-zinc-800">
                  <tr>
                    <th className="py-2 pr-3">Desk</th>
                    <th className="py-2 pr-3">Market</th>
                    <th className="py-2 pr-3">Signal</th>
                    <th className="py-2 pr-3">State</th>
                    <th className="py-2 pr-3 text-right">Edge/P&L</th>
                    <th className="py-2 pr-3">Blocker</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunities.map((op) => (
                    <tr key={op.desk} className="border-b border-zinc-900/80">
                      <td className="py-2.5 pr-3 text-zinc-200">{op.desk}</td>
                      <td className="py-2.5 pr-3 text-zinc-500">{op.market}</td>
                      <td className="py-2.5 pr-3 text-zinc-400">{op.signal}</td>
                      <td className="py-2.5 pr-3"><span className={`border px-2 py-0.5 ${toneClass(op.tone)}`}>{op.state}</span></td>
                      <td className="py-2.5 pr-3 text-right text-zinc-300">{op.edge}</td>
                      <td className="py-2.5 pr-3 text-zinc-500">{op.blocker}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="border border-zinc-800 bg-[#080b12] p-4">
            <div className="gx-overline mb-3">Agent operating floor</div>
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-1 gap-2">
              {AGENTS.map((agent) => (
                <article key={agent.name} className="border border-zinc-800 bg-black/20 px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${agent.tone === 'good' ? 'bg-emerald-400' : agent.tone === 'bad' ? 'bg-red-400' : agent.tone === 'warn' ? 'bg-amber-400' : agent.tone === 'info' ? 'bg-cyan-400' : 'bg-zinc-600'}`} />
                    <div className="font-mono text-[12px] text-zinc-100">{agent.name}</div>
                    <div className="ml-auto font-mono text-[9px] uppercase text-zinc-600">{agent.state}</div>
                  </div>
                  <div className="text-[12px] text-zinc-400 mt-1">{agent.role}</div>
                  <p className="text-[12px] text-zinc-500 mt-2 leading-snug">{agent.mission}</p>
                  <div className="font-mono text-[9px] text-zinc-600 mt-2">{agent.connector}</div>
                </article>
              ))}
            </div>
          </div>

          <PixelOffice agents={AGENTS} />

          <div className="border border-zinc-800 bg-[#080b12] p-4">
            <div className="gx-overline mb-3">Connector rack / Hermes</div>
            <div className="space-y-2">
              {CONNECTORS.map((c) => (
                <div key={c.name} className="flex items-center gap-3 border border-zinc-900 bg-black/20 px-3 py-2">
                  <div className={`h-2 w-2 ${c.tone === 'good' ? 'bg-emerald-400' : c.tone === 'bad' ? 'bg-red-400' : c.tone === 'warn' ? 'bg-amber-400' : c.tone === 'info' ? 'bg-cyan-400' : 'bg-zinc-600'}`} />
                  <div className="min-w-0">
                    <div className="font-mono text-[11px] text-zinc-200 truncate">{c.name}</div>
                    <div className="font-mono text-[9px] text-zinc-600 truncate">{c.detail}</div>
                  </div>
                  <div className={`ml-auto border px-2 py-0.5 font-mono text-[9px] uppercase ${toneClass(c.tone)}`}>{c.state}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <button className="border border-amber-400/35 bg-amber-400/5 text-amber-300 font-mono text-[10px] py-2" type="button">ARM PAPER</button>
              <button className="border border-cyan-400/30 bg-cyan-400/5 text-cyan-300 font-mono text-[10px] py-2" type="button">ASTRA READY</button>
              <button className="border border-red-400/35 bg-red-400/5 text-red-300 font-mono text-[10px] py-2 cursor-not-allowed" type="button" disabled>LIVE LOCKED</button>
            </div>
          </div>

          {err && (
            <div className="border border-red-400/30 bg-red-400/5 px-4 py-3 font-mono text-[11px] text-red-300">
              feed error: {err}
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
