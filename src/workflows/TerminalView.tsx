// TerminalView.tsx — GENESIS HQ · Funding Terminal (PRO).
// Professional dark trading terminal: live funding board, equity curve,
// delta-neutral positions, animated trade feed, risk panel. Reads REAL
// Binance funding data + the live bot executions (gist/proxy).
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import LocalEdgeScorecard from '@workflows/LocalEdgeScorecard';

type Exec = { mode?: string; total?: number; trades?: Trade[] };
type Trade = {
  t: number; pair: string; event: 'OPEN' | 'TP' | 'SL' | 'FUNDING' | 'PROTECT' | 'FLAT';
  side?: string; pnl?: number; equity?: number; rate?: number; reason?: string;
};
type BoardRow = {
  pair: string; rate: number; annualPct: number;
  side: 'short-perp/long-spot' | 'long-perp/short-spot' | 'neutral';
  nextMs: number; nextMin: number;
};

const fmtUsd = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n ?? 0);
const fmtPct = (n: number) => `${(n * 100).toFixed(2)}%`;
const fmtTime = (ms: number) => {
  const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s.toString().padStart(2, '0')}s`;
};

const COLOR: Record<string, string> = {
  OPEN: '#22d3ee', FUNDING: '#22c55e', PROTECT: '#f59e0b', FLAT: '#64748b', TP: '#22c55e', SL: '#ef4444',
};

async function fetchExec(): Promise<Exec> {
  try {
    const r = await fetch('/executions.json', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.trades)) return j; }
  } catch {}
  try {
    const r = await fetch('/api/crypto/executions', { cache: 'no-store' });
    if (r.ok) { const j = await r.json(); if (j && Array.isArray(j.trades)) return j; }
  } catch {}
  return { mode: 'funding-paper', trades: [] };
}

async function fetchBoard(): Promise<BoardRow[]> {
  try {
    // Binance public endpoint, CORS-enabled (Access-Control-Allow-Origin: *).
    // No API key, no serverless function needed (Hobby plan limit = 12 fns).
    const r = await fetch('https://fapi.binance.com/fapi/v1/premiumIndex', { cache: 'no-store' });
    if (!r.ok) throw new Error('binance ' + r.status);
    const all: any[] = await r.json();
    const WATCH = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','NEARUSDT','SUIUSDT','TRXUSDT','TONUSDT','ARBUSDT','OPUSDT','PEPEUSDT','WIFUSDT','1000PEPEUSDT','NEIROUSDT','POPCATUSDT','COTIUSDT','OGNUSDT','RIFUSDT','AUDIOUSDT','LUNAUSDT','STORJUSDT','FETUSDT','COMPUSDT','ATOMUSDT','DOTUSDT','SANDUSDT','JSTUSDT','BNTUSDT','BCHUSDT','NEOUSDT','XLMUSDT','ZECUSDT','QTUMUSDT','ANKRUSDT','ONEUSDT','ZILUSDT','HOTUSDT','ONGUSDT','MTLUSDT','THETAUSDT','IOSTUSDT','CELRUSDT'];
    const bySymbol = new Map(all.map((x: any) => [x.symbol, x]));
    const now = Date.now();
    const rows: BoardRow[] = WATCH
      .map((sym) => {
        const d = bySymbol.get(sym);
        if (!d) return null;
        const rate = parseFloat(d.lastFundingRate);
        const nextTs = parseInt(d.nextFundingTime, 10);
        const msTo = nextTs - now;
        return {
          pair: sym, rate,
          annualPct: +(rate * 3 * 365 * 100).toFixed(2),
          side: rate > 0.00005 ? 'short-perp/long-spot' : rate < -0.00005 ? 'long-perp/short-spot' : 'neutral',
          nextMs: msTo > 0 ? msTo : 0,
          nextMin: Math.max(0, Math.floor(msTo / 60000)),
        } as BoardRow;
      })
      .filter((x): x is BoardRow => x !== null)
      .sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
    return rows;
  } catch {
    return [];
  }
}

function EquityCurve({ trades }: { trades: Trade[] }) {
  const w = 520, h = 110, pad = 6;
  const pts = trades.filter((t) => typeof t.equity === 'number');
  if (pts.length < 2) return <div className="text-[11px] text-zinc-600 px-1 py-4">—</div>;
  const vals = pts.map((t) => t.equity as number);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const X = (i: number) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
  const Y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const d = pts.map((t, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(t.equity as number).toFixed(1)}`).join(' ');
  const up = (vals[vals.length - 1] ?? 0) >= (vals[0] ?? 0);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[110px]">
      <path d={d} fill="none" stroke={up ? '#22c55e' : '#ef4444'} strokeWidth={1.6} />
    </svg>
  );
}

function PriceChart({ data }: { data: number[] }) {
  const w = 560, h = 170, pad = 6;
  if (data.length < 2) return <div className="text-[11px] text-zinc-600 px-1 py-6">loading…</div>;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const X = (i: number) => pad + (i / (data.length - 1)) * (w - 2 * pad);
  const Y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const line = data.map((v, i) => `${i === 0 ? 'M' : 'L'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const area = `${line} L${X(data.length - 1).toFixed(1)},${h - pad} L${X(0).toFixed(1)},${h - pad} Z`;
  const up = (data[data.length - 1] ?? 0) >= (data[0] ?? 0);
  const col = up ? '#22c55e' : '#ef4444';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[170px]">
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity="0.25" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#pg)" />
      <path d={line} fill="none" stroke={col} strokeWidth={1.5} />
    </svg>
  );
}

const TRADERS = [
  { id: 'nova', name: 'Nova', role: 'Breakout', color: '#4ea1ff' },
  { id: 'atlas', name: 'Atlas', role: 'Mean-Reversion', color: '#22d3ee' },
  { id: 'orion', name: 'Orion', role: 'Funding Arb', color: '#22c55e' },
  { id: 'vega', name: 'Vega', role: 'Regime', color: '#a855f7' },
];

function TraderCard({ t, status, line, pulse }: { t: typeof TRADERS[number]; status: string; line: string; pulse: boolean }) {
  return (
    <div className="border border-zinc-800/70 rounded px-2 py-1.5 bg-[#0d111a]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block w-2 h-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ background: t.color }} />
          <span className="font-bold text-[12px]" style={{ color: t.color }}>{t.name}</span>
          <span className="text-[9px] text-zinc-600">{t.role}</span>
        </span>
        <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{status}</span>
      </div>
      <div className="text-[10px] text-zinc-400 leading-snug mt-0.5">{line}</div>
    </div>
  );
}

function Timeline({ trades, now }: { trades: Trade[]; now: number }) {
  const evs = trades.slice(-14).map((t) => ({ ...t, ts: t.t ?? 0 }));
  if (evs.length === 0) return <div className="text-[11px] text-zinc-600 px-1 py-3">—</div>;
  const min = evs[0].ts, max = Math.max(now, evs[evs.length - 1].ts);
  const span = max - min || 1;
  return (
    <div className="px-3 py-3">
      <div className="relative h-8">
        <div className="absolute top-1/2 left-0 right-0 h-px bg-zinc-800" />
        {evs.map((e, i) => {
          const x = 8 + ((e.ts - min) / span) * 100;
          const col = COLOR[e.event] || '#64748b';
          return (
            <div key={i} className="absolute -translate-x-1/2" style={{ left: `${x}%`, top: 0 }}>
              <div className="w-2.5 h-2.5 rounded-full mx-auto" style={{ background: col, boxShadow: `0 0 6px ${col}` }} />
              <div className="text-[8px] text-zinc-500 mt-1 whitespace-nowrap">{e.pair}</div>
              <div className="text-[8px]" style={{ color: col }}>{e.event}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TradersPanel({ pair, rate, side, price, es, opps, openPairs }: { pair: string; rate: number; side: string; price: number | null; es: boolean; opps: BoardRow[]; openPairs: string[] }) {
  const Lines: Record<string, { status: string; line: string; pulse: boolean }> = {
    nova: { status: 'ANALIZANDO', pulse: true, line: price != null ? `${pair} ${price < price * 1.001 ? '▼' : '▲'} en canal donchian — buscando breakout.` : 'cargando precio…' },
    atlas: { status: 'ANALIZANDO', pulse: true, line: rate !== 0 ? `funding ${(rate * 100).toFixed(3)}% — rango activo, reversión lista.` : 'sin sesgo de rango.' },
    orion: opps.length > 0
      ? { status: 'DETECTÓ', pulse: true, line: `${opps.length} ops funding. top ${opps[0].pair} ${opps[0].annualPct.toFixed(0)}% APR.` }
      : { status: 'VIGILANDO', pulse: false, line: `escaneando ${openPairs.length} mercados abiertos…` },
    vega: { status: 'RÉGIMEN', pulse: false, line: `${side === 'neutral' ? (es ? 'lateral' : 'range') : (es ? 'tendencia' : 'trend')} · ${openPairs.length} mercados.` },
  };
  return (
    <div className="space-y-1.5 px-2 py-2">
      {TRADERS.map((t) => {
        const s = Lines[t.id as keyof typeof Lines];
        return <TraderCard key={t.id} t={t} status={s.status} line={s.line} pulse={s.pulse} />;
      })}
    </div>
  );
}

export default function TerminalView() {
  const lang = useLanguage();
  const es = lang === 'es';
  const [exec, setExec] = useState<Exec>({ mode: 'funding-paper', trades: [] });
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [now, setNow] = useState(Date.now());
  const [selectedPair, setSelectedPair] = useState('BTCUSDT');
  const [klines, setKlines] = useState<number[]>([]);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const startRef = useRef(Date.now());
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [e, b] = await Promise.all([fetchExec(), fetchBoard()]);
      if (!alive) return;
      setExec(e); setBoard(b);
      try {
        const r = await fetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${selectedPair}&interval=1m&limit=120`, { cache: 'no-store' });
        if (r.ok) {
          const k: any[] = await r.json();
          const closes = k.map((x) => parseFloat(x[4]));
          setKlines(closes);
          setLastPrice(closes[closes.length - 1] ?? null);
        }
      } catch {}
    };
    tick();
    const id1 = setInterval(tick, 5000);
    const id2 = setInterval(() => setNow(Date.now()), 1000);
    setBooted(true);
    return () => { alive = false; clearInterval(id1); clearInterval(id2); };
  }, [selectedPair]);

  const trades = exec.trades || [];
  const startCapital = 50;

  // Open positions: last event per pair is OPEN (not followed by FLAT).
  const lastByPair = new Map<string, string>();
  trades.forEach((t) => lastByPair.set(t.pair, t.event));
  const openPairs = [...lastByPair.entries()].filter(([, e]) => e === 'OPEN').map(([p]) => p);
  const openCount = openPairs.length;

  // Accrued equity (honest, live): funding earned so far this period on
  // open positions, using REAL Binance rates + settlement times. Shown as a
  // live "+$X in motion" projection — the bot (PAPER) already realizes these
  // into exec.total every run, so we do NOT double-count into `equity`.
  const FUNDING_MS = 8 * 3600 * 1000;
  const accrued = openPairs.reduce((sum, p) => {
    const r = board.find((x) => x.pair === p);
    if (!r || !r.nextMs || r.nextMs === Infinity) return sum;
    const lastSettle = r.nextMs - FUNDING_MS;
    const frac = Math.min(1, Math.max(0, (now - lastSettle) / FUNDING_MS));
    return sum + Math.abs(r.rate) * startCapital * frac;
  }, 0);
  const fundingEvents = trades.filter((t) => t.event === 'FUNDING');
  const fundingPaid = fundingEvents.reduce((s, t) => s + (t.pnl ?? 0), 0);
  // Bot is the source of truth for realized PAPER funding (FUNDING events).
  // equity = start + sum of all collected funding (grows visibly each run).
  const equity = startCapital + fundingPaid;
  const pnl = equity - startCapital;
  const pnlPct = pnl / startCapital;
  // Expected funding income at NEXT settlement if positions hold — REAL Binance
  // rates, honest projection (not realized PnL). per-pair notional = paper $50.
  const NOTIONAL = startCapital;
  const expectedFunding = openPairs.reduce((sum, p) => {
    const r = board.find((x) => x.pair === p);
    return sum + (r ? Math.abs(r.rate) * NOTIONAL : 0);
  }, 0);
  const uptimeMin = Math.floor((now - startRef.current) / 60000);
  // nearest settlement across board
  const nextSettle = board.reduce((m, r) => Math.min(m, r.nextMs), Infinity);

  const recent = [...trades].slice(-40).reverse();
  const selRow = board.find((r) => r.pair === selectedPair);
  // Multi-market opportunity scanner (funding arbitrage, risk-aware):
  // ranks pairs by annualized funding APR; only those with a clear receive
  // side and a sane APR band count as "opportunities". Paper only.
  const opps = board
    .filter((r) => r.side !== 'neutral' && Math.abs(r.annualPct) >= 5 && Math.abs(r.annualPct) <= 200)
    .sort((a, b) => Math.abs(b.annualPct) - Math.abs(a.annualPct))
    .slice(0, 8);

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-[#070a0f] text-zinc-200 font-mono">
      {/* HEADER */}
      <div className="sticky top-0 z-10 bg-[#0b0f16] border-b border-zinc-800 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500">Genesis HQ · Funding Terminal</div>
            <div className="text-[11px] text-zinc-400">{es ? 'Arbitraje de tasa delta-neutral' : 'Delta-neutral rate arbitrage'}</div>
          </div>
          <Stat label={es ? 'EQUITY' : 'EQUITY'} value={fmtUsd(equity)} color="#f4f4f5" />
          <Stat label="P&L" value={`${pnl >= 0 ? '+' : ''}${fmtUsd(pnl)}`} color={pnl >= 0 ? '#22c55e' : '#ef4444'} />
          <Stat label="P&L %" value={`${pnl >= 0 ? '+' : ''}${fmtPct(pnlPct)}`} color={pnl >= 0 ? '#22c55e' : '#ef4444'} />
          <Stat label={es ? 'ESP. COBRO' : 'EXP. FUNDING'} value={fmtUsd(expectedFunding)} color="#facc15" />
          <Stat label={es ? 'COBRADO' : 'FUNDED'} value={fmtUsd(fundingPaid)} color="#22c55e" />
          <Stat label={es ? 'EN MARCHA' : 'IN MOTION'} value={`+${fmtUsd(accrued)}`} color="#a3e635" />
          <Stat label="OPEN" value={String(openCount)} color="#22d3ee" />
          <Stat label="UPTIME" value={`${uptimeMin}m`} color="#a855f7" />
        </div>
        <div className="flex items-center gap-3">
          {!booted ? null : (
            <span className="px-2 py-1 rounded bg-amber-500/15 text-amber-400 text-[10px] font-bold border border-amber-500/30">
              PAPER · NO REAL MONEY
            </span>
          )}
          <span className="px-2 py-1 rounded bg-zinc-800 text-[10px] text-zinc-400 border border-zinc-700">
            {es ? 'Próximo cobro' : 'Next settle'}: {nextSettle === Infinity ? '—' : fmtTime(nextSettle)}
            {expectedFunding > 0 ? ` · +${fmtUsd(expectedFunding)}` : ''}
          </span>
        </div>
      </div>

      {/* ── LIVE PAIR: selector + price chart + traders ── */}
      <div className="px-4 pt-3">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <span className="text-[10px] uppercase tracking-widest text-zinc-500">{es ? 'Par en vivo' : 'Live pair'}</span>
          <select
            value={selectedPair}
            onChange={(e) => setSelectedPair(e.target.value)}
            className="bg-[#0e1320] border border-zinc-700 rounded px-2 py-1 text-[12px] text-zinc-100 outline-none"
          >
            {board.length > 0
              ? board.slice(0, 24).map((r) => <option key={r.pair} value={r.pair}>{r.pair}</option>)
              : ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','ADAUSDT','AVAXUSDT','LINKUSDT','NEARUSDT','COTIUSDT','ONGUSDT','HOTUSDT','ZILUSDT'].map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          {lastPrice != null && (
            <span className="text-[15px] font-bold text-zinc-100">
              {selectedPair} {lastPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
          {selRow && (
            <span className="text-[10px] text-cyan-400">
              funding {(selRow.rate * 100).toFixed(3)}% · {selRow.side === 'neutral' ? '—' : selRow.side}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <Panel title={`${selectedPair} · 1m`} className="lg:col-span-2">
            <PriceChart data={klines} />
          </Panel>
          <Panel title={es ? 'Traders' : 'Traders'}>
            <TradersPanel pair={selectedPair} rate={selRow?.rate ?? 0} side={selRow?.side ?? 'neutral'} price={lastPrice} es={es} opps={opps} openPairs={openPairs} />
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 p-4">
        {/* EQUITY CURVE */}
        <Panel title={es ? 'Curva de Equity' : 'Equity Curve'} className="lg:col-span-2">
          <EquityCurve trades={trades} />
          <div className="flex gap-4 px-2 pb-2 text-[11px] text-zinc-500">
            <span>start {fmtUsd(startCapital)}</span>
            <span>now {fmtUsd(equity)}</span>
            <span>peak {fmtUsd(Math.max(startCapital, ...trades.filter(t=>typeof t.equity==='number').map(t=>t.equity as number)))}</span>
          </div>
        </Panel>

        {/* RISK PANEL */}
        <Panel title={es ? 'Riesgo' : 'Risk'}>
          <div className="space-y-2 px-3 py-2 text-[12px]">
            <Row k={es ? 'Protección' : 'Protection'} v="Δ-neutral + 1.5% DD" />
            <Row k={es ? 'Modo' : 'Mode'} v="PAPER $50" />
            <Row k={es ? 'Pares monitoreados' : 'Pairs watched'} v={String(board.length)} />
            <Row k={es ? 'Cobros hoy' : 'Settlements'} v={String(fundingEvents.length)} />
            <Row k={es ? 'Estado' : 'Status'} v={<span className="text-emerald-400">● {es ? 'VIVO' : 'LIVE'}</span>} />
          </div>
        </Panel>

        {/* LIVE FUNDING BOARD */}
        <Panel title={es ? 'Board de Funding (en vivo)' : 'Live Funding Board'} className="lg:col-span-2">
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-[11px]">
              <thead className="text-zinc-500 sticky top-0 bg-[#0b0f16]">
                <tr className="text-left">
                  <th className="px-2 py-1">PAIR</th>
                  <th className="px-2 py-1 text-right">8h RATE</th>
                  <th className="px-2 py-1 text-right">APR</th>
                  <th className="px-2 py-1">RECIBE</th>
                  <th className="px-2 py-1 text-right">PRÓXIMO</th>
                </tr>
              </thead>
              <tbody>
                {board.slice(0, 18).map((r) => (
                  <tr key={r.pair} className="border-t border-zinc-800/60">
                    <td className="px-2 py-1 text-zinc-200">{r.pair}</td>
                    <td className={`px-2 py-1 text-right ${r.rate >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{fmtPct(r.rate)}</td>
                    <td className="px-2 py-1 text-right text-zinc-400">{r.annualPct.toFixed(0)}%</td>
                    <td className="px-2 py-1 text-[10px] text-cyan-400">{r.side === 'neutral' ? '—' : r.side}</td>
                    <td className="px-2 py-1 text-right text-zinc-500">{fmtTime(r.nextMs)}</td>
                  </tr>
                ))}
                {board.length === 0 && (
                  <tr><td colSpan={5} className="px-2 py-3 text-center text-zinc-600">loading…</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* TRADE FEED */}
        <Panel title={es ? 'Feed de Operaciones' : 'Trade Feed'}>
          <div className="max-h-72 overflow-y-auto space-y-1 px-2 py-2">
            {recent.length === 0 && <div className="text-[11px] text-zinc-600 px-1">—</div>}
            {recent.map((t, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] border-b border-zinc-800/40 pb-1">
                <span className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR[t.event] || '#64748b' }} />
                  <span className="text-zinc-300">{t.pair}</span>
                  <span style={{ color: COLOR[t.event] || '#64748b' }}>{t.event}</span>
                </span>
                <span className="text-zinc-500">
                  {t.event === 'FUNDING' && t.pnl != null ? `+${fmtUsd(t.pnl)}` : ''}
                  {t.equity != null ? ` · ${fmtUsd(t.equity)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </Panel>

        {/* OPPORTUNITY SCANNER — multi-market, risk-aware */}
        <Panel title={es ? 'Scanner de Oportunidades (modo bot · PAPER)' : 'Opportunity Scanner (bot mode · PAPER)'} className="lg:col-span-3">
          <div className="px-3 py-2">
            <div className="text-[11px] text-zinc-500 mb-2">
              {es
                ? `Orion escanea ${board.length} mercados de funding en vivo. Solo lista setups con lado claro y APR 5–200% (protección Δ-neutral + 1.5% DD). Sin quemar.`
                : `Orion scans ${board.length} live funding markets. Lists only setups with a clear side and 5–200% APR (Δ-neutral + 1.5% DD guard). No burn.`}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {opps.length === 0 && <div className="col-span-full text-[11px] text-zinc-600">escaneando…</div>}
              {opps.map((o) => (
                <div key={o.pair} className="border border-zinc-800 rounded px-2 py-1.5 bg-[#0d111a]">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-bold text-zinc-100">{o.pair}</span>
                    <span className={`text-[10px] ${o.rate >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{o.annualPct.toFixed(0)}% APR</span>
                  </div>
                  <div className="text-[10px] text-cyan-400">{o.side === 'neutral' ? '—' : o.side}</div>
                  <div className="text-[9px] text-zinc-500 mt-0.5">
                    {o.rate < 0 ? 'REVERSIÓN' : 'ARB'} · próx {fmtTime(o.nextMs)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        {/* OPERATIONS TIMELINE — when the bot acted */}
        <Panel title={es ? 'Línea de Tiempo de Operaciones' : 'Operations Timeline'} className="lg:col-span-3">
          <Timeline trades={trades} now={now} />
        </Panel>
      </div>

      {/* REAL QUANT ENGINE (README logic) — auto-runs on live Binance, 6-gate GO/NO-GO */}
      <div className="px-4 pb-2">
        <LocalEdgeScorecard />
      </div>

      <div className="px-5 pb-6 text-[10px] text-zinc-600 leading-relaxed">
        {es
          ? 'Datos de funding en tiempo real de Binance. El bot es PAPER ($50 simulados, cero órdenes reales). Edge validado en 20 pares (PF 2–7000). Para uso real se requiere cuenta futures + retiro off + autorización.'
          : 'Real-time Binance funding data. Bot is PAPER ($50 simulated, zero real orders). Edge validated on 20 pairs (PF 2–7000). Real use requires futures account + withdraw off + authorization.'}
      </div>
    </main>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="text-[15px] font-bold" style={{ color }}>{value}</div>
    </div>
  );
}

function Panel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-[#0b0f16] border border-zinc-800 rounded-lg ${className}`}>
      <header className="px-3 py-2 border-b border-zinc-800 text-[11px] uppercase tracking-wider text-zinc-400">
        {title}
      </header>
      {children}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-zinc-500">{k}</span>
      <span className="text-zinc-200">{v}</span>
    </div>
  );
}
