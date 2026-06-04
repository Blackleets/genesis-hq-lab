// AgentLivePanel — real-time agent trading activity from the backend runner.
// Shows capital, open positions, closed trades, lessons, and org status.
// Degrades gracefully when server is offline.

import { useAgentData } from '@agents/hooks/useAgentData';
import { useLanguage } from '@core/i18n/languageStore';
import type { AgentTrade } from '@services/agentClient';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number) { return `${(n * 100).toFixed(1)}%`; }
function usd(n: number) {
  const sign = n >= 0 ? '+' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}
function ago(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1)  return 'ahora';
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

// ─── Offline banner ───────────────────────────────────────────────────────────

function OfflineBanner({ lang }: { lang: string }) {
  return (
    <div className="gx-card px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-zinc-600" />
        <span className="font-mono text-[11px] text-zinc-600 uppercase tracking-wider">
          {lang === 'es' ? 'Agent runner desconectado' : 'Agent runner offline'}
        </span>
      </div>
      <div className="font-mono text-[10px] text-zinc-700 mt-1.5 leading-relaxed">
        {lang === 'es'
          ? 'Ejecuta: npm run server && npm run agent'
          : 'Run: npm run server && npm run agent'}
      </div>
    </div>
  );
}

// ─── Capital bar ──────────────────────────────────────────────────────────────

function CapitalBar({ dashboard }: { dashboard: NonNullable<ReturnType<typeof useAgentData>['dashboard']> }) {
  const t = dashboard.treasury;
  const p = dashboard.performance;
  const inTradesPct = t.total > 0 ? t.inTrades / t.total : 0;

  return (
    <div className="gx-card px-4 py-3 space-y-2.5">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="gx-overline">
          Tesorería virtual
        </span>
        <div className="flex items-center gap-2">
          {t.unrealizedPnl !== 0 && (
            <span className={`font-mono text-[10px] ${t.unrealizedPnl >= 0 ? 'text-emerald-400/70' : 'text-red-400/70'}`}>
              {usd(t.unrealizedPnl)} abierto
            </span>
          )}
          <span className={`font-mono text-[10px] font-semibold ${p.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {usd(p.totalPnl)} cerrado
          </span>
        </div>
      </div>

      {/* Capital numbers */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Capital', val: `$${t.total.toLocaleString()}`, col: 'text-zinc-100' },
          { label: 'Disponible', val: `$${t.available.toLocaleString()}`, col: 'text-emerald-400' },
          { label: 'En trades', val: `$${t.inTrades.toLocaleString()}`, col: 'text-amber-400' },
          { label: 'PnL abierto', val: usd(t.unrealizedPnl ?? 0), col: (t.unrealizedPnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-red-400' },
        ].map(({ label, val, col }) => (
          <div key={label}>
            <div className="font-mono text-[8px] text-zinc-600 uppercase tracking-wider">{label}</div>
            <div className={`font-mono text-[13px] font-semibold ${col}`}>{val}</div>
          </div>
        ))}
      </div>

      {/* Capital allocation bar */}
      <div className="h-1.5 bg-carbon-300 rounded-full overflow-hidden flex">
        <div className="h-full bg-amber-400/70" style={{ width: pct(inTradesPct) }} />
        <div className="h-full bg-emerald-400/40 flex-1" />
      </div>

      {/* Performance row */}
      <div className="flex items-center gap-4 font-mono text-[10px] text-zinc-500">
        <span>
          <span className={p.winRate >= 0.5 ? 'text-emerald-400' : 'text-red-400'}>
            {pct(p.winRate)}
          </span>
          {' '}win rate
        </span>
        <span>·</span>
        <span>{p.totalTrades} trades</span>
        {dashboard.risk.brierScore?.score != null && (
          <>
            <span>·</span>
            <span>Brier <span className="text-zinc-300">{dashboard.risk.brierScore.score.toFixed(2)}</span></span>
          </>
        )}
        {t.drawdownPct > 0 && (
          <>
            <span>·</span>
            <span className="text-red-400">DD {pct(t.drawdownPct)}</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Trade row ────────────────────────────────────────────────────────────────

function TradeRow({ trade }: { trade: AgentTrade }) {
  const open    = trade.status === 'open';
  const won     = (trade.pnl ?? 0) > 0;
  const evidence = (() => { try { return JSON.parse(trade.evidence) as string[]; } catch { return []; } })();

  return (
    <div className="border-b border-trim last:border-0 px-4 py-2.5">
      <div className="flex items-start gap-2">
        {/* Status dot */}
        <span
          className="mt-0.5 inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: open ? '#ffd24a' : won ? '#00ff9c' : '#ff4757' }}
        />
        <div className="flex-1 min-w-0">
          {/* Question */}
          <div className="font-mono text-[10px] text-zinc-200 leading-tight truncate">
            {trade.market_question}
          </div>
          {/* Meta */}
          <div className="flex items-center gap-2 mt-0.5 font-mono text-[9px] text-zinc-600">
            <span className="uppercase">{trade.outcome}</span>
            <span>@{pct(trade.entry_price)}</span>
            <span>conf {pct(trade.confidence)}</span>
            <span>·</span>
            <span>{trade.market_source}</span>
            <span>·</span>
            <span>{ago(trade.opened_at)}</span>
          </div>
          {/* Evidence tags */}
          {evidence.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {evidence.slice(0, 2).map((e, i) => (
                <span key={i} className="font-mono text-[8px] text-zinc-700 bg-carbon-300 px-1.5 py-0.5 truncate max-w-[140px]">
                  {e}
                </span>
              ))}
            </div>
          )}
        </div>
        {/* PnL */}
        <div className="shrink-0 text-right">
          {open ? (
            <div className="font-mono text-[9px] text-amber-400">OPEN</div>
          ) : (
            <div className={`font-mono text-[11px] font-semibold ${won ? 'text-emerald-400' : 'text-red-400'}`}>
              {usd(trade.pnl ?? 0)}
            </div>
          )}
          <div className="font-mono text-[8px] text-zinc-700">${trade.capital_used.toFixed(0)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Org status pill row ──────────────────────────────────────────────────────

function OrgStatusRow({ status }: { status: NonNullable<ReturnType<typeof useAgentData>['status']> }) {
  const s = status.state;
  const modeColor = s.mode === 'rest' || s.mode === 'emergency'
    ? '#ff4757' : s.mode === 'normal' ? '#00ff9c' : '#ffd24a';

  return (
    <div className="gx-card px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: modeColor }} />
        <span className="font-mono text-[9px] uppercase tracking-wider" style={{ color: modeColor }}>
          {s.mode}
        </span>
      </div>
      <span className="font-mono text-[9px] text-zinc-600">
        Risk: <span className="text-zinc-400">{s.riskTolerance}</span>
      </span>
      {s.focus && (
        <span className="font-mono text-[9px] text-zinc-600">
          Focus: <span className="text-purple-400">{s.focus.topic}</span>
        </span>
      )}
      {s.goal && (
        <span className="font-mono text-[9px] text-zinc-600">
          Goal: <span className="text-amber-400">{s.goal.description}</span>
        </span>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface Props {
  compact?: boolean;   // true = only capital + open trades (for sidebar of other modules)
}

export default function AgentLivePanel({ compact = false }: Props) {
  const lang = useLanguage();
  const { dashboard, trades, lessons, status, online, lastSync } = useAgentData();

  if (!online) return <OfflineBanner lang={lang} />;

  const openTrades   = trades.filter((t) => t.status === 'open');
  const closedTrades = trades.filter((t) => t.status === 'closed').slice(-10);
  const recentLessons = lessons.slice(-3);

  return (
    <div className="space-y-2">
      {/* Sync indicator */}
      {lastSync && (
        <div className="flex items-center gap-1.5 px-0.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-mono text-[9px] text-zinc-600">
            {lang === 'es' ? 'Agente activo' : 'Agent live'} · {lang === 'es' ? 'sync' : 'synced'} {lastSync}
          </span>
        </div>
      )}

      {/* Org status */}
      {status && <OrgStatusRow status={status} />}

      {/* Capital */}
      {dashboard && <CapitalBar dashboard={dashboard} />}

      {/* Open positions */}
      {openTrades.length > 0 && (
        <div className="border border-amber-500/20 bg-carbon-200">
          <div className="px-4 py-2 border-b border-trim flex items-center justify-between">
            <span className="font-mono text-[9px] uppercase tracking-widest text-amber-400">
              {lang === 'es' ? 'Posiciones abiertas' : 'Open positions'}
            </span>
            <span className="font-mono text-[9px] text-amber-400">{openTrades.length}</span>
          </div>
          {openTrades.map((t) => <TradeRow key={t.id} trade={t} />)}
        </div>
      )}

      {!compact && (
        <>
          {/* Closed trades */}
          {closedTrades.length > 0 && (
            <div className="gx-card">
              <div className="px-4 py-2 border-b border-trim flex items-center justify-between">
                <span className="gx-overline">
                  {lang === 'es' ? 'Historial' : 'History'}
                </span>
                <span className="font-mono text-[9px] text-zinc-600">{closedTrades.length}</span>
              </div>
              {closedTrades.map((t) => <TradeRow key={t.id} trade={t} />)}
            </div>
          )}

          {/* Lessons */}
          {recentLessons.length > 0 && (
            <div className="gx-card">
              <div className="px-4 py-2 border-b border-trim">
                <span className="gx-overline">
                  {lang === 'es' ? 'Últimas lecciones' : 'Recent lessons'}
                </span>
              </div>
              {recentLessons.map((l) => (
                <div key={l.id} className="gx-card-head last:border-0">
                  <div className="font-mono text-[10px] text-zinc-300 leading-snug">{l.lesson_text}</div>
                  {l.new_rule && (
                    <div className="font-mono text-[9px] text-emerald-600 mt-0.5">→ {l.new_rule}</div>
                  )}
                  <div className="font-mono text-[8px] text-zinc-700 mt-0.5 uppercase">{l.category} · {l.severity}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
