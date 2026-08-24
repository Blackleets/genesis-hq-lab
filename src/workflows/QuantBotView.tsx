// QuantBotView.tsx — Genesis Quant Lab live view: paper bots + treasury.
// Reads /api/genesis/live — REAL files written by liveRunner.mjs (hourly cron)
// and treasury.mjs. No fabricated data: if the backend is offline or the state
// files don't exist yet, shows an explicit empty state (no-theater rule).

import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@core/i18n/languageStore';
import { useWalletAuth } from '@core/auth/WalletAuthProvider';
import { shortAddress } from '@core/auth/walletTypes';
import QuantChart, { type ChartCandle, type ChartTrade } from '@workflows/QuantChart';

interface BotPosition {
  side: string;
  entry: number;
  sl: number;
  tp: number;
  openedAt: string;
}

interface BotTrade {
  side: string;
  entry: number;
  exit: number;
  reason: string;
  pnlPct: number;
  pnlUsd: number;
  closedAt: string;
}

interface BotState {
  pair: string;
  tf: string;
  equity: number;
  position: null | BotPosition;
  trades: BotTrade[];
  equityCurve?: number[];
  log?: string[];
  updatedAt: string;
  /** sha256 prefix of the owner wallet — only sent to operator sessions. */
  ownerHash?: string;
}

interface TreasuryState {
  paperBalanceUSDT: number;
  allocatedToTrading: number;
  totalDeposited: number;
  totalWithdrawn: number;
}

interface LiveResponse {
  ok: boolean;
  bots: BotState[];
  bot: BotState | null;
  treasury: TreasuryState | null;
  updatedAt: string;
}

type CronHealth = 'active' | 'delayed' | 'down' | 'unknown';

function cronHealth(updatedAt: string | undefined): CronHealth {
  if (!updatedAt) return 'unknown';
  const t = new Date(updatedAt).getTime();
  if (!Number.isFinite(t)) return 'unknown';
  const diffMs = Date.now() - t;
  if (diffMs < 2 * 3_600_000) return 'active'; // < 2h
  if (diffMs < 24 * 3_600_000) return 'delayed'; // 2h–24h
  return 'down'; // > 24h
}

function CronIndicator({ updatedAt }: { updatedAt: string | undefined }) {
  const lang = useLanguage();
  const es = lang === 'es';
  const h = cronHealth(updatedAt);
  const color =
    h === 'active'
      ? 'bg-emerald-400'
      : h === 'delayed'
        ? 'bg-amber-400'
        : h === 'down'
          ? 'bg-red-400'
          : 'bg-zinc-500';
  const label =
    es
      ? h === 'active'
        ? 'Cron activo'
        : h === 'delayed'
          ? 'Cron retrasado'
          : h === 'down'
            ? 'Cron caído'
            : 'Cron sin datos'
      : h === 'active'
        ? 'Cron active'
        : h === 'delayed'
          ? 'Cron delayed'
          : h === 'down'
            ? 'Cron down'
            : 'Cron no data';
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      <span className="text-[11px] text-zinc-400">{label}</span>
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="gx-card px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`font-mono text-[15px] font-semibold ${tone === 'pos' ? 'text-emerald-400' : tone === 'neg' ? 'text-teal-300' : 'text-zinc-100'}`}>
        {value}
      </div>
    </div>
  );
}

// Hand-rolled SVG polyline over the real equityCurve points, normalized to
// min/max. No chart library — Strategy Lab cyan (#22d3ee) per DESIGN_DIRECTION.
function EquityCurveChart({ curve }: { curve: number[] }) {
  const W = 600;
  const H = 160;
  const min = Math.min(...curve);
  const max = Math.max(...curve);
  const span = max - min;
  const pts = curve.map((v, i) => {
    const x = curve.length === 1 ? W / 2 : (i / (curve.length - 1)) * W;
    // Flat curve → draw a centered baseline instead of dividing by zero.
    const y = span === 0 ? H / 2 : H - ((v - min) / span) * H;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-40 block bg-[#10131a]"
      role="img"
    >
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke="#22d3ee"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export default function QuantBotView() {
  const lang = useLanguage();
  const es = lang === 'es';
  const { session, logout } = useWalletAuth();
  const token = session?.token ?? null;
  const isOperator = session?.role === 'operator';
  const [data, setData] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [botIdx, setBotIdx] = useState(0);
  const [candles, setCandles] = useState<ChartCandle[]>([]);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await fetch('/api/genesis/live', {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (r.status === 401) {
          // Session expired/revoked → clean auto-logout back to the gate.
          if (alive) { setError(null); setData(null); logout(); }
          return;
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j: LiveResponse = await r.json();
        if (alive) { setData(j); setError(null); }
      } catch {
        if (alive) setError(es ? 'Backend offline — npm run start' : 'Backend offline — npm run start');
      }
    }
    load();
    const id = setInterval(load, 30_000); // poll every 30s
    return () => { alive = false; clearInterval(id); };
  }, [es, token, logout]);

  // Candles for the selected bot's pair (real Binance klines).
  useEffect(() => {
    const pair = data?.bots?.[Math.min(botIdx, Math.max((data?.bots?.length ?? 1) - 1, 0))]?.pair;
    if (!pair) return;
    let alive = true;
    fetch(`/api/genesis/candles?pair=${encodeURIComponent(pair)}&tf=1h&limit=300`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
      .then((r) => {
        if (r.status === 401 && alive) { logout(); }
        return r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`));
      })
      .then((j: { candles: ChartCandle[] }) => { if (alive) setCandles(j.candles ?? []); })
      .catch(() => { if (alive) setCandles([]); });
    return () => { alive = false; };
  }, [botIdx, data?.bots, token, logout]);

  const bots = data?.bots ?? [];

  // Operator view: group the fleet by ownerHash (never a raw address in UI).
  const groups = useMemo(() => {
    const map = new Map<string, { ownerHash: string; items: Array<{ bot: BotState; idx: number }> }>();
    bots.forEach((b, idx) => {
      const key = b.ownerHash ?? '——————';
      let g = map.get(key);
      if (!g) { g = { ownerHash: key, items: [] }; map.set(key, g); }
      g.items.push({ bot: b, idx });
    });
    return [...map.values()];
  }, [bots]);

  // Prefer the requested tab; clamp if the backend returns fewer bots.
  const bot = bots.length ? bots[Math.min(botIdx, bots.length - 1)] : null;

  const wins = bot?.trades?.filter((t) => t.pnlUsd > 0).length ?? 0;
  const nTrades = bot?.trades?.length ?? 0;
  const wr = nTrades ? ((wins / nTrades) * 100).toFixed(1) : null;
  const gp = bot?.trades?.filter((t) => t.pnlUsd > 0).reduce((s, t) => s + t.pnlUsd, 0) ?? 0;
  const gl = Math.abs(bot?.trades?.filter((t) => t.pnlUsd <= 0).reduce((s, t) => s + t.pnlUsd, 0) ?? 0);
  const pf = gl > 0 ? (gp / gl).toFixed(2) : null;
  const ret = bot?.equity != null && bot.equity !== 1000
    ? (((bot.equity - 1000) / 1000) * 100).toFixed(2)
    : '0.00';

  const curve = bot?.equityCurve ?? [];

  return (
    <main className="flex-1 min-w-0 min-h-0 overflow-y-auto px-6 py-6 bg-carbon-300">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Session bar — discreet wallet identity + logout (zinc-500). */}
        {session && (
          <section className="flex items-center justify-end gap-3 text-[11px] text-zinc-500">
            <span className="font-mono">{shortAddress(session.address)}</span>
            <span className="uppercase tracking-wide">{session.role}</span>
            <button
              onClick={logout}
              className="transition-colors hover:text-zinc-300 hover:underline underline-offset-2"
            >
              Salir
            </button>
          </section>
        )}

        <header>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <h1 className="text-xl font-bold text-zinc-100">
              {es ? '🧬 Genesis Quant Lab — Bots (Paper)' : '🧬 Genesis Quant Lab — Bots (Paper)'}
            </h1>
            {/* Cron health: real freshness of the backend's last write */}
            <CronIndicator updatedAt={data?.bots?.[0]?.updatedAt} />
          </div>
          <p className="text-[12px] text-zinc-500 mt-1">
            {es
              ? 'Estrategia meanReversion validada con 6 gates sobre datos reales de Binance. Paper · cero dólares reales.'
              : 'meanReversion strategy validated with 6 gates on real Binance data. Paper · zero real dollars.'}
          </p>
        </header>

        {/* Kill switch status */}
        <section className="gx-card px-4 py-3 flex items-center gap-3">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
          <span className="text-[12px] text-zinc-300">
            {es ? 'Kill switch armado: pausa automática si retorno ≤ −5% o PF < 0.7 con ≥10 trades.' : 'Kill switch armed: auto-pause if return ≤ −5% or PF < 0.7 with ≥10 trades.'}
          </span>
        </section>

        {/* Bot tabs (only when the backend reports more than one bot).
            Operator sessions get the fleet grouped by ownerHash, labeled
            "user #xxxxxx" — never a raw address in the UI. */}
        {bots.length > 1 && !isOperator && (
          <section className="flex items-center gap-2 flex-wrap">
            {bots.map((b, i) => (
              <button
                key={`${b.pair}-${b.tf}-${i}`}
                onClick={() => setBotIdx(i)}
                className={`px-3 py-1 rounded text-[12px] font-mono border transition-colors ${
                  i === Math.min(botIdx, bots.length - 1)
                    ? 'border-cyan-400/60 text-zinc-100 bg-[#15171d]'
                    : 'border-carbon-100 text-zinc-400 hover:text-zinc-200 hover:bg-[#10131a]'
                }`}
              >
                {b.pair || `#${i + 1}`} · {b.tf}
              </button>
            ))}
          </section>
        )}
        {bots.length > 1 && isOperator && (
          <section className="space-y-2">
            {groups.map((g) => (
              <div key={g.ownerHash}>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 font-mono mb-1">
                  user #{g.ownerHash.slice(0, 6)}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {g.items.map(({ bot: b, idx }) => (
                    <button
                      key={`${b.pair}-${b.tf}-${idx}`}
                      onClick={() => setBotIdx(idx)}
                      className={`px-3 py-1 rounded text-[12px] font-mono border transition-colors ${
                        idx === Math.min(botIdx, bots.length - 1)
                          ? 'border-cyan-400/60 text-zinc-100 bg-[#15171d]'
                          : 'border-carbon-100 text-zinc-400 hover:text-zinc-200 hover:bg-[#10131a]'
                      }`}
                    >
                      {b.pair || `#${idx + 1}`} · {b.tf}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Metrics (selected bot; honest dashes while loading / offline) */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Metric label={es ? 'Equity papel' : 'Paper equity'} value={bot ? `$${bot.equity.toFixed(2)}` : '—'} />
          <Metric label={es ? 'Retorno' : 'Return'} value={`${ret}%`} tone={parseFloat(ret) > 0 ? 'pos' : parseFloat(ret) < 0 ? 'neg' : undefined} />
          <Metric label="Trades" value={String(nTrades)} />
          <Metric label={es ? 'Win rate' : 'Win rate'} value={wr ? `${wr}%` : '—'} />
        </section>

        {/* Price chart — real candles + bot trade markers (TradingView LWC) */}
        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
            {es ? `Precio ${bot?.pair ?? ''} · 1h` : `${bot?.pair ?? ''} Price · 1h`}
          </header>
          {candles.length > 0 ? (
            <div className="px-2 pb-2">
              <QuantChart candles={candles} trades={(bot?.trades ?? []) as unknown as ChartTrade[]} />
            </div>
          ) : (
            <div className="px-4 py-4 text-[12px] text-zinc-500">
              {es ? 'Sin datos de velas — backend offline o par sin historial.' : 'No candle data — backend offline or pair without history.'}
            </div>
          )}
        </section>

        {/* Equity Curve — real points only; honest empty state otherwise */}
        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
            {es ? 'Curva de equity' : 'Equity Curve'}
          </header>
          {curve.length >= 2 ? (
            <EquityCurveChart curve={curve} />
          ) : (
            <div className="px-4 py-4 text-[12px] text-zinc-500">
              {es ? 'Sin cierres aún' : 'No closed trades yet'}
            </div>
          )}
        </section>

        {/* Open position */}
        {bot?.position && (
          <section className="gx-card px-4 py-3">
            <header className="text-[11px] uppercase tracking-wide text-zinc-500 mb-2">
              {es ? 'Posición abierta' : 'Open position'}
            </header>
            <div className="font-mono text-[12px] text-zinc-200">
              {bot.position.side.toUpperCase()} @ {bot.position.entry} · SL {bot.position.sl.toFixed(6)} · TP {bot.position.tp.toFixed(6)}
            </div>
          </section>
        )}

        {/* Trade history */}
        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
            {es ? `Historial (${nTrades} trades · WR ${wr ?? '—'}% · PF ${pf ?? '—'})` : `History (${nTrades} trades · WR ${wr ?? '—'}% · PF ${pf ?? '—'})`}
          </header>
          {nTrades === 0 ? (
            <div className="px-4 py-4 text-[12px] text-zinc-500">
              {es ? 'Sin trades aún — el bot espera su setup (RSI ≤ 31 + Bollinger inferior).' : 'No trades yet — bot waiting for its setup (RSI ≤ 31 + lower Bollinger).'}
            </div>
            ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="text-zinc-500 border-b border-carbon-100">
                  <tr>
                    <th className="text-left px-3 py-1">{es ? 'Fecha' : 'Date'}</th>
                    <th className="text-left px-3 py-1">{es ? 'Lado' : 'Side'}</th>
                    <th className="text-right px-3 py-1">Entry</th>
                    <th className="text-right px-3 py-1">Exit</th>
                    <th className="text-left px-3 py-1">{es ? 'Cierre' : 'Close'}</th>
                    <th className="text-right px-3 py-1">P&L $</th>
                  </tr>
                </thead>
                <tbody>
                  {[...bot!.trades].reverse().map((t, i) => (
                    <tr key={i} className="border-b border-carbon-100/50">
                      <td className="px-3 py-1 text-zinc-400">{new Date(t.closedAt).toLocaleString()}</td>
                      <td className={`px-3 py-1 ${t.side === 'long' ? 'text-emerald-400' : 'text-teal-300'}`}>{t.side}</td>
                      <td className="px-3 py-1 text-right text-zinc-300">{t.entry}</td>
                      <td className="px-3 py-1 text-right text-zinc-300">{t.exit}</td>
                      <td className="px-3 py-1 text-zinc-400">{t.reason}</td>
                      <td className={`px-3 py-1 text-right ${t.pnlUsd > 0 ? 'text-emerald-400' : 'text-teal-300'}`}>
                        {t.pnlUsd > 0 ? '+' : ''}{t.pnlUsd.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Treasury */}
        <section className="gx-card">
          <header className="gx-card-head gx-card-title">
            {es ? '🏦 Tesorería (paper)' : '🏦 Treasury (paper)'}
          </header>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3">
            <Metric label={es ? 'Balance desk' : 'Desk balance'} value={data?.treasury ? `$${data.treasury.paperBalanceUSDT.toFixed(2)}` : '—'} />
            <Metric label={es ? 'Asignado a trading' : 'Trading allocation'} value={data?.treasury ? `$${data.treasury.allocatedToTrading.toFixed(2)}` : '—'} />
            <Metric label={es ? 'Depósitos totales' : 'Total deposits'} value={data?.treasury ? `$${data.treasury.totalDeposited.toFixed(2)}` : '—'} />
            <Metric label={es ? 'Retiros totales' : 'Total withdrawals'} value={data?.treasury ? `$${data.treasury.totalWithdrawn.toFixed(2)}` : '—'} />
          </div>
          <p className="px-4 pb-3 text-[11px] text-zinc-500">
            {es
              ? 'Retiros reales requieren: whitelist creada por ti + token de aprobación + REAL_TRADING=true.'
              : 'Real withdrawals require: human-created whitelist + approval token + REAL_TRADING=true.'}
          </p>
        </section>

        {error && (
          <div className="gx-card px-4 py-3 text-[12px] text-amber-400">{error}</div>
        )}
      </div>
    </main>
  );
}
