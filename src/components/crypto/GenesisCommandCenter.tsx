import { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetchCaptureReport, type CaptureReport } from '@services/captureClient';
import { FounderControlRoom } from './FounderControlRoom';

const card = 'border border-zinc-800 bg-[#10131a] p-4';
const money = (value: number | undefined | null) => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—';
const color = (value: number | undefined) => value == null ? 'text-zinc-300' : value < 0 ? 'text-red-300' : value > 0 ? 'text-emerald-300' : 'text-zinc-300';

export function GenesisCommandCenter({ es = true }: { es?: boolean }) {
  const [report, setReport] = useState<CaptureReport | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      const result = await fetchCaptureReport(40);
      if (!result.ok || result.paper !== true) throw new Error('Capture unavailable');
      setReport(result); setError(false);
    } catch { setReport(null); setError(true); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  // Historical paper snapshot, NEVER account-wide live equity. Unknowns stay null.
  const f = report?.funding;
  const bridge = f ? [
    { name: 'Price', usd: f.realizedPricePnlUsdt },
    { name: 'Funding', usd: f.realizedFundingUsdt },
    { name: 'Fees', usd: -f.feesUsdt },
    { name: 'Open MTM', usd: f.mtmUsdt },
  ] : [];
  const metrics = [
    { label: 'Equity · paper', value: money(f?.equityUsdt), hint: 'Funding desk only', number: f?.economicPnlUsdt },
    { label: 'Realized net P&L', value: money(f?.realizedNetPnlUsdt), hint: 'Price + funding − fees', number: f?.realizedNetPnlUsdt },
    { label: 'Unrealized P&L', value: money(f?.mtmUsdt), hint: 'Open mark-to-market', number: f?.mtmUsdt },
    { label: 'Fees', value: money(f?.feesUsdt), hint: 'Truth Ledger costs', number: undefined },
    { label: 'Drawdown', value: '—', hint: 'Needs reconciled equity history', number: undefined },
    { label: 'Win rate', value: '—', hint: 'Needs per-close net outcomes', number: undefined },
    { label: 'Exposure / open risk', value: '— / —', hint: 'Needs account and margin reconciliation', number: undefined },
    { label: 'Active sessions', value: '—', hint: 'No verified runner session feed', number: undefined },
  ];
  const research = [
    { desk: 'Crypto futures scalping', market: 'BTC / ETH · liquid futures', type: 'Research', signal: 'No validated signal', state: 'RESEARCH_ONLY', edge: 'Costs + slippage + OOS required', blocker: 'No approved strategy or live gate evidence' },
    { desk: 'Funding / basis', market: 'OKX USDT-SWAP', type: 'Carry research', signal: f?.scorecard?.verdict ?? 'No ledger snapshot', state: f ? 'PAPER_EVIDENCE' : 'NO_EVIDENCE', edge: f ? `${money(f.realizedNetPnlUsdt)} realized net · paper` : 'No economic evidence', blocker: 'Sample, hedge/leg risk and live controls required' },
    { desk: 'Forex London / New York', market: 'OANDA · FX sessions', type: 'Session research', signal: 'No verified calendar/feed', state: 'CONNECTOR_PENDING', edge: 'No measured edge', blocker: 'Broker, DST/holiday calendar, spreads and rollover costs' },
    { desk: 'LP / farming', market: 'DeFi pools', type: 'Scanner only', signal: 'No verified APY', state: 'SCANNER_ONLY', edge: 'No approved strategy', blocker: 'IL, fees, lockup, contract risk and exit liquidity' },
    { desk: 'Prediction markets', market: 'Kalshi / Polymarket', type: 'Read-only research', signal: 'No validated signal', state: 'READ_ONLY', edge: 'No measured edge', blocker: 'Liquidity, settlement, market rules and cost model' },
  ];
  return <div className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-[#0a0c12] text-[#e6edf3]">
    <header className="border-b border-zinc-800 px-4 md:px-6 py-5">
      <div className="flex flex-wrap justify-between items-start gap-3">
        <div><div className="text-xs font-mono uppercase tracking-[0.2em] text-cyan-300">Genesis HQ / Command Center</div>
          <h1 className="text-2xl font-semibold tracking-tight mt-2">{es ? 'Control de capital. Evidencia primero.' : 'Capital control. Evidence first.'}</h1>
          <p className="text-xs text-zinc-400 mt-2">Crypto futures · Funding / basis · Forex sessions</p></div>
        <span className="border border-amber-500/40 text-amber-300 px-3 py-2 font-mono text-[10px]">READ-ONLY CONTROL ROOM</span>
      </div>
    </header>
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(360px,1fr)] gap-4 p-4 md:p-6">
      <div className="space-y-4 min-w-0">
        <section aria-labelledby="metrics-heading">
          <div className="flex flex-wrap justify-between gap-2 mb-3"><div><h2 id="metrics-heading" className="font-semibold">Capital & economic truth</h2><p className="text-xs text-zinc-400 mt-1">Historical paper evidence · no live account balance connected</p></div><button type="button" onClick={() => void load()} disabled={busy} className="border border-zinc-700 px-3 py-2 text-xs disabled:opacity-40">{busy ? 'Loading ledger…' : 'Refresh ledger'}</button></div>
          {error && <p role="alert" className="text-xs text-red-300 border border-red-500/30 p-3 mb-3">Ledger feed unavailable. Values are not estimated.</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4 gap-2">{metrics.map(m => <article key={m.label} className={card}><div className="text-xs text-zinc-400">{m.label}</div><div className={`text-xl font-mono mt-2 ${color(m.number)}`}>{m.value}</div><p className="text-[10px] text-zinc-400 mt-2">{m.hint}</p></article>)}</div>
        </section>
        <section className={card} aria-labelledby="pnl-heading">
          <div className="flex flex-wrap justify-between gap-2"><h2 id="pnl-heading" className="font-semibold">P&L attribution · Truth Ledger v2</h2><span className={`font-mono text-sm ${color(f?.economicPnlUsdt)}`}>{money(f?.economicPnlUsdt)}</span></div>
          <p className="text-xs text-zinc-400 mt-1">Price + funding − fees + open MTM · USDT, without USD conversion</p>
          {bridge.length > 0 ? <div className="h-56 mt-4" aria-label="Paper P&L components in USDT"><ResponsiveContainer width="100%" height="100%"><BarChart data={bridge} margin={{ left: 0, right: 12, top: 10, bottom: 0 }}><CartesianGrid stroke="#27272a" vertical={false} /><XAxis dataKey="name" tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#a1a1aa', fontSize: 10 }} width={65} tickFormatter={v => String(v)} /><Tooltip contentStyle={{ background: '#10131a', border: '1px solid #3f3f46', color: '#e6edf3' }} /><ReferenceLine y={0} stroke="#a1a1aa" /><Bar dataKey="usd" name="USDT" fill="#22d3ee" maxBarSize={60} isAnimationActive={false} /></BarChart></ResponsiveContainer></div> : <p className="text-sm text-zinc-400 text-center py-16">No reconciled funding snapshot available</p>}
          <p className="text-[10px] text-zinc-400 mt-3">Ledger snapshot: {f?.ts ? new Date(f.ts).toLocaleString() : 'unknown'} · Snapshot values do not prove connector health or current live readiness.</p>
        </section>
        <section className={card} aria-labelledby="opportunity-heading">
          <h2 id="opportunity-heading" className="font-semibold">Opportunity book / research mandates</h2>
          <p className="text-xs text-zinc-400 mt-1 mb-3">Separate research lines. No row is approved for live. APY and gross spread are not net edge.</p>
          <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-xs text-left"><thead className="text-zinc-400 border-b border-zinc-700"><tr>{['Market / desk', 'Type', 'Signal', 'Status', 'Edge / evidence', 'Blocker'].map(h => <th key={h} className="p-2 font-medium">{h}</th>)}</tr></thead><tbody>{research.map(r => <tr key={r.desk} className="border-b border-zinc-800 align-top"><td className="p-2"><span className="block text-cyan-200">{r.desk}</span><span className="text-zinc-400">{r.market}</span></td><td className="p-2">{r.type}</td><td className="p-2">{r.signal}</td><td className="p-2 text-amber-200 font-mono text-[10px]">{r.state}</td><td className="p-2">{r.edge}</td><td className="p-2 text-zinc-400">{r.blocker}</td></tr>)}</tbody></table></div>
        </section>
        <section className={card} aria-labelledby="tape-heading"><h2 id="tape-heading" className="font-semibold">Capture research tape · OKX</h2><p className="text-xs text-zinc-400 mt-1">Real market inputs; quotes and fills are paper. Research scores are not realized profit.</p>
          {!report?.rows?.length ? <p className="text-xs text-zinc-400 py-6">No tape available</p> : <div className="overflow-x-auto mt-3"><table className="w-full min-w-[540px] text-xs text-left"><thead className="text-zinc-400"><tr><th className="py-2">Market</th><th>Signal</th><th>Score · bps</th><th>Blocker</th></tr></thead><tbody>{report.rows.slice(0, 8).map(r => <tr key={r.symbol} className="border-t border-zinc-800"><td className="py-2 font-mono">{r.symbol}</td><td>{r.quote ? 'Paper quote' : 'No quote'}</td><td>{Number.isFinite(r.harvestBps) ? r.harvestBps.toFixed(2) : '—'}</td><td className="text-zinc-400">{r.reason} · live locked</td></tr>)}</tbody></table></div>}
        </section>
      </div>
      <aside className="min-w-0"><FounderControlRoom /></aside>
    </div>
  </div>;
}
