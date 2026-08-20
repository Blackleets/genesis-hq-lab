// TerminalView.tsx — GENESIS HQ · Funding Terminal (PRO).
// Professional dark trading terminal: live funding board, equity curve,
// delta-neutral positions, animated trade feed, risk panel. Reads REAL
// Binance funding data + the live bot executions (gist/proxy).
import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';

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
    return WATCH
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
      .filter(Boolean as any)
      .sort((a: any, b: any) => Math.abs(b.rate) - Math.abs(a.rate));
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

export default function TerminalView() {
  const lang = useLanguage();
  const es = lang === 'es';
  const [exec, setExec] = useState<Exec>({ mode: 'funding-paper', trades: [] });
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [now, setNow] = useState(Date.now());
  const startRef = useRef(Date.now());
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const [e, b] = await Promise.all([fetchExec(), fetchBoard()]);
      if (!alive) return;
      setExec(e); setBoard(b);
    };
    tick();
    const id1 = setInterval(tick, 5000);
    const id2 = setInterval(() => setNow(Date.now()), 1000);
    setBooted(true);
    return () => { alive = false; clearInterval(id1); clearInterval(id2); };
  }, []);

  const trades = exec.trades || [];
  const startCapital = 50;
  const equity = (exec.total ?? startCapital);
  const pnl = equity - startCapital;
  const pnlPct = pnl / startCapital;
  const fundingEvents = trades.filter((t) => t.event === 'FUNDING');
  const fundingPaid = fundingEvents.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const openCount = trades.filter((t) => t.event === 'OPEN').length;
  const uptimeMin = Math.floor((now - startRef.current) / 60000);

  // nearest settlement across board
  const nextSettle = board.reduce((m, r) => Math.min(m, r.nextMs), Infinity);

  const recent = [...trades].slice(-40).reverse();

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
          <Stat label={es ? 'COBRADO' : 'FUNDED'} value={fmtUsd(fundingPaid)} color="#22c55e" />
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
          </span>
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
