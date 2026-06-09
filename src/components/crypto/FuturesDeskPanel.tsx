import type { FuturesDeskSnapshot, FuturesDeskSummaryRow, FuturesDeskPosition } from '@services/cryptoClient';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const PANEL_BG = '#101006';
const PANEL_BORDER = '#31250f';

const usd = (n: number | null | undefined) => (n == null ? '-' : `${n >= 0 ? '+' : ''}$${n.toFixed(2)}`);
const num = (n: number | null | undefined) => (n == null ? '-' : n.toFixed(2));
const pct = (n: number | null | undefined) => (n == null ? '-' : `${(n * 100).toFixed(1)}%`);

function ago(iso?: string | null) {
  if (!iso) return '-';
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return '-';
  const minutes = Math.floor(deltaMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

function tone(value: number) {
  return value >= 0 ? '#22c55e' : '#ef4444';
}

function summaryLabel(row: FuturesDeskSummaryRow) {
  return row.tradeType === 'crypto_futures_breakout_short_micro'
    ? 'short micro'
    : row.tradeType === 'crypto_futures_breakout_short'
      ? 'short'
      : row.tradeType === 'crypto_futures_breakout_short_alt'
        ? 'short alt'
        : row.tradeType === 'crypto_futures_breakout_long'
          ? 'long'
          : row.tradeType;
}

function positionBadge(position: FuturesDeskPosition) {
  return position.side === 'LONG'
    ? { fg: '#052e16', bg: '#22c55e', text: 'LONG' }
    : { fg: '#450a0a', bg: '#ef4444', text: 'SHORT' };
}

function fmtEvent(iso?: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}z`;
}

function snapshotAgeLabel(iso?: string | null) {
  if (!iso) return '-';
  const deltaMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(deltaMs)) return '-';
  const seconds = Math.max(0, Math.floor(deltaMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h`;
}

export function FuturesDeskPanel({
  futuresDesk,
  es,
  onRunCycle,
  onResetBaseline,
  runBusy = false,
  baselineBusy = false,
  runStatus = null,
}: {
  futuresDesk: FuturesDeskSnapshot | null;
  es: boolean;
  onRunCycle?: () => void;
  onResetBaseline?: () => void;
  runBusy?: boolean;
  baselineBusy?: boolean;
  runStatus?: string | null;
}) {
  if (!futuresDesk) {
    return (
      <div style={{ background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: 10 }}>
        <div className="font-mono text-[9px] uppercase tracking-wider text-amber-400">
          {es ? 'Desk de futuros' : 'Futures desk'}
        </div>
        <div className="mt-2 font-mono text-[10px] text-zinc-600">
          {es ? 'Sin respuesta del backend.' : 'Backend did not return futures desk data.'}
        </div>
      </div>
    );
  }

  const { treasury, config, openPositions, closedSummary } = futuresDesk;
  const allPairs = Array.from(new Set(config.profiles.flatMap((profile) => profile.pairs)));
  const realizedEquity = futuresDesk.equityCurve;
  const realizedPnl = closedSummary.reduce((sum, row) => sum + (row.totalPnl ?? 0), 0);
  const netPnl = realizedPnl + (treasury.unrealizedPnl ?? 0);
  const lifecycle = futuresDesk.recentLifecycle;
  const profileMeta = new Map(config.profiles.map((profile) => [profile.id, profile]));
  const governorJournal = futuresDesk.governorJournal ?? [];
  const rankedProfiles = [...(config.governor?.profiles ?? [])].sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  const baselineAt = futuresDesk.baseline?.baselineAt ?? null;
  const today = futuresDesk.today;
  const cycleHistory = futuresDesk.cycleHistory ?? [];
  const profileScoreboard = futuresDesk.profileScoreboard ?? [];

  return (
    <div style={{ background: PANEL_BG, border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, padding: 10 }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-amber-400">
            {es ? 'Desk de futuros' : 'Futures desk'}
          </div>
          <div className="mt-1 font-mono text-[10px] text-zinc-500">
            {allPairs.join('/')} · multi-tf breakout · x{config.leverage} · TP {(config.tpPct * 100).toFixed(1)}% / SL {(config.slPct * 100).toFixed(1)}%
          </div>
        </div>
        <span
          className="rounded border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.18em]"
          style={{
            color: treasury.isPaused ? '#f59e0b' : '#22c55e',
            borderColor: treasury.isPaused ? '#78350f' : '#14532d',
            background: treasury.isPaused ? '#1c1917' : '#052e16',
          }}
        >
          {treasury.isPaused ? (es ? 'pausado' : 'paused') : 'live'}
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 font-mono text-[9px] text-zinc-500">
        <span>{es ? `snapshot ${snapshotAgeLabel(futuresDesk.generatedAt)} atras` : `snapshot ${snapshotAgeLabel(futuresDesk.generatedAt)} ago`}</span>
        <span>{fmtEvent(futuresDesk.generatedAt)}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRunCycle}
            disabled={!onRunCycle || runBusy}
            className="rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
            style={{
              color: runBusy ? '#a1a1aa' : '#fbbf24',
              borderColor: runBusy ? '#3f3f46' : '#78350f',
              background: runBusy ? '#111827' : '#1c1917',
              cursor: !onRunCycle || runBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {runBusy ? (es ? 'corriendo...' : 'running...') : 'run cycle now'}
          </button>
          <button
            type="button"
            onClick={onResetBaseline}
            disabled={!onResetBaseline || baselineBusy}
            className="rounded border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em]"
            style={{
              color: baselineBusy ? '#a1a1aa' : '#22c55e',
              borderColor: baselineBusy ? '#3f3f46' : '#14532d',
              background: baselineBusy ? '#111827' : '#052e16',
              cursor: !onResetBaseline || baselineBusy ? 'not-allowed' : 'pointer',
            }}
          >
            {baselineBusy ? (es ? 'reseteando...' : 'resetting...') : (es ? 'reset pnl base' : 'reset pnl base')}
          </button>
        </div>
        <span className="font-mono text-[9px] text-zinc-500">
          {runStatus ?? (es ? 'Disparo manual sobre el motor real.' : 'Manual trigger on the real engine.')}
        </span>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'PnL de futuros' : 'Futures PnL'}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded bg-[#151206] px-2 py-1.5">
            <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">{es ? 'realizado' : 'realized'}</div>
            <div className="font-mono text-[11px] font-bold" style={{ color: tone(realizedPnl) }}>{usd(realizedPnl)}</div>
          </div>
          <div className="rounded bg-[#151206] px-2 py-1.5">
            <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">{es ? 'no realizado' : 'unrealized'}</div>
            <div className="font-mono text-[11px] font-bold" style={{ color: tone(treasury.unrealizedPnl) }}>{usd(treasury.unrealizedPnl)}</div>
          </div>
          <div className="rounded bg-[#151206] px-2 py-1.5">
            <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">{es ? 'neto base' : 'net since base'}</div>
            <div className="font-mono text-[11px] font-bold" style={{ color: tone(netPnl) }}>{usd(netPnl)}</div>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded bg-[#151206] px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">net worth</div>
          <div className="font-mono text-[11px] font-bold text-zinc-100">{usd(treasury.netWorth)}</div>
        </div>
        <div className="rounded bg-[#151206] px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">{es ? 'disponible' : 'available'}</div>
          <div className="font-mono text-[11px] font-bold text-zinc-100">{usd(treasury.available)}</div>
        </div>
        <div className="rounded bg-[#151206] px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">uPnL</div>
          <div className="font-mono text-[11px] font-bold" style={{ color: tone(treasury.unrealizedPnl) }}>
            {usd(treasury.unrealizedPnl)}
          </div>
        </div>
        <div className="rounded bg-[#151206] px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">drawdown</div>
          <div className="font-mono text-[11px] font-bold text-zinc-100">{pct(treasury.drawdownPct)}</div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded bg-[#151206] px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">{es ? 'pnl hoy' : 'today pnl'}</div>
          <div className="font-mono text-[11px] font-bold" style={{ color: tone(today.totalPnl) }}>{usd(today.totalPnl)}</div>
        </div>
        <div className="rounded bg-[#151206] px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">{es ? 'cierres hoy' : 'today closes'}</div>
          <div className="font-mono text-[11px] font-bold text-zinc-100">{today.closedTrades}</div>
        </div>
        <div className="rounded bg-[#151206] px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">wr today</div>
          <div className="font-mono text-[11px] font-bold text-zinc-100">{pct(today.winRate)}</div>
        </div>
        <div className="rounded bg-[#151206] px-2 py-1.5">
          <div className="font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">{es ? 'abiertas hoy' : 'opened today'}</div>
          <div className="font-mono text-[11px] font-bold text-zinc-100">{today.openCount}</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {config.profiles.map((profile) => (
          <span
            key={profile.id}
            className="rounded border px-2 py-1 font-mono text-[8px] uppercase tracking-[0.16em]"
            style={{
              color: profile.enabled ? '#22c55e' : '#6b7280',
              borderColor: profile.enabled ? '#14532d' : '#3f3f46',
              background: profile.enabled ? '#052e16' : '#111827',
            }}
          >
            {profile.id} [{profile.tier}/{profile.interval}]: {profile.enabled ? 'on' : 'off'}
          </span>
        ))}
      </div>

      <div className="mt-2 font-mono text-[9px] text-zinc-500">
        {baselineAt
          ? (es ? `PnL base desde ${fmtEvent(baselineAt)}` : `PnL baseline from ${fmtEvent(baselineAt)}`)
          : (es ? 'PnL acumulado historico completo.' : 'PnL is using full historical futures data.')}
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Ranking de perfiles' : 'Profile ranking'}
        </div>
        <div className="space-y-1">
          {rankedProfiles.map((profile) => (
            <div key={profile.id} className="rounded bg-[#151206] px-2 py-1.5">
              <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-200">{profile.id}</span>
                  <span className="text-zinc-600">{profileMeta.get(profile.id)?.interval ?? '-'}</span>
                  <span style={{ color: profile.mode === 'paused' ? '#f59e0b' : profile.mode === 'degraded' ? '#f97316' : profile.mode === 'active' ? '#22c55e' : '#9ca3af' }}>
                    {profile.mode}
                  </span>
                  {profile.supervisor?.mode === 'cooldown' ? (
                    <span style={{ color: '#f59e0b' }}>cooldown</span>
                  ) : null}
                </div>
                <span className="text-zinc-500">score {profile.rankScore?.toFixed?.(2) ?? profile.rankScore}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] text-zinc-500">
                <span>{profile.trades} trd · WR {pct(profile.winRate)} · PF {profile.profitFactor == null ? '-' : profile.profitFactor === Infinity ? 'inf' : profile.profitFactor.toFixed(2)}</span>
                <span>{usd(profile.totalPnl)} · DD {usd(profile.maxDrawdown)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] text-zinc-600">
                <span>{profile.reason}</span>
                <span>cap x{profile.capitalMultiplier} · lev x{profile.leverageMultiplier}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] text-zinc-600">
                <span>today {usd(profile.supervisor?.dailyPnl ?? 0)} · streak {profile.supervisor?.consecutiveLosses ?? 0}</span>
                <span>{profile.supervisor?.cooldownUntil ? `until ${fmtEvent(profile.supervisor.cooldownUntil)}` : (profile.supervisor?.reason ?? 'live')}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Governor journal' : 'Governor journal'}
        </div>
        <div className="space-y-1">
          {governorJournal.length === 0 ? (
            <div className="rounded bg-[#151206] px-2 py-2 font-mono text-[10px] text-zinc-600">
              {es ? 'Sin cambios de governor aun.' : 'No governor state changes yet.'}
            </div>
          ) : governorJournal.slice().reverse().slice(0, 8).map((entry) => (
            <div key={`${entry.profileId}-${entry.at}-${entry.mode}`} className="rounded bg-[#151206] px-2 py-1.5">
              <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-200">{entry.profileId}</span>
                  <span
                    style={{
                      color: entry.mode === 'paused' ? '#f59e0b' : entry.mode === 'degraded' ? '#f97316' : entry.mode === 'active' ? '#22c55e' : '#9ca3af',
                    }}
                  >
                    {entry.mode}
                  </span>
                </div>
                <span className="text-zinc-500">{fmtEvent(entry.at)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px]">
                <span className="text-zinc-600">{entry.reason}</span>
                <span className="text-zinc-500">
                  {entry.trades} trd · WR {pct(entry.winRate)} · {usd(entry.totalPnl)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Scoreboard perfiles' : 'Profile scoreboard'}
        </div>
        <div className="space-y-1">
          {profileScoreboard.length === 0 ? (
            <div className="rounded bg-[#151206] px-2 py-2 font-mono text-[10px] text-zinc-600">
              {es ? 'Sin cierres aun para scoreboard.' : 'No closed futures trades yet for scoreboard.'}
            </div>
          ) : profileScoreboard.map((profile) => (
            <div key={profile.tradeType} className="rounded bg-[#151206] px-2 py-1.5">
              <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                <span className="text-zinc-200">{summaryLabel({ tradeType: profile.tradeType, closedTrades: 0, wins: 0, winRate: null, totalPnl: 0, avgPnl: 0 })}</span>
                <span style={{ color: tone(profile.totalPnl) }}>{usd(profile.totalPnl)}</span>
              </div>
              <div className="mt-1 font-mono text-[9px] text-zinc-500">
                {profile.closedTrades} trd · WR {pct(profile.winRate)} · pairs {profile.pairs.length}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Equity futuros' : 'Futures equity'}
        </div>
        <div className="rounded bg-[#151206] px-2 py-2">
          {realizedEquity.length === 0 ? (
            <div className="font-mono text-[10px] text-zinc-600">
              {es ? 'Aun no hay cierres para dibujar curva.' : 'No closed futures trades yet for curve.'}
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-between gap-3 font-mono text-[10px]">
                <span className="text-zinc-500">{es ? 'PnL realizado acumulado' : 'Cumulative realized PnL'}</span>
                <span style={{ color: tone(realizedEquity[realizedEquity.length - 1]?.equity ?? 0) }}>
                  {usd(realizedEquity[realizedEquity.length - 1]?.equity ?? 0)}
                </span>
              </div>
              <div style={{ width: '100%', height: 120 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={realizedEquity} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="futuresEquityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.35} />
                        <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="ts"
                      tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'monospace' }}
                      tickFormatter={(value) => fmtEvent(value).slice(0, 5)}
                      axisLine={false}
                      tickLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      tick={{ fill: '#71717a', fontSize: 9, fontFamily: 'monospace' }}
                      tickFormatter={(value) => `${value >= 0 ? '+' : ''}${Number(value).toFixed(0)}`}
                      axisLine={false}
                      tickLine={false}
                      width={42}
                    />
                    <Tooltip
                      contentStyle={{ background: '#09090b', border: '1px solid #27272a', fontFamily: 'monospace', fontSize: 10 }}
                      labelFormatter={(value) => fmtEvent(String(value))}
                      formatter={(value, _name, payload) => {
                        const numeric = Number(value ?? 0);
                        return [`${numeric >= 0 ? '+' : ''}$${numeric.toFixed(2)}`, payload?.payload?.pair ?? 'equity'];
                      }}
                    />
                    <Area type="monotone" dataKey="equity" stroke="#f59e0b" strokeWidth={2} fill="url(#futuresEquityFill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? `Posiciones abiertas (${openPositions.length})` : `Open positions (${openPositions.length})`}
        </div>
        <div className="space-y-1">
          {openPositions.length === 0 ? (
            <div className="rounded bg-[#151206] px-2 py-2 font-mono text-[10px] text-zinc-600">
              {es ? 'Sin posiciones de futuros abiertas.' : 'No open futures positions.'}
            </div>
          ) : openPositions.map((position) => {
            const badge = positionBadge(position);
            return (
              <div key={position.id} className="rounded bg-[#151206] px-2 py-1.5">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-100">{position.pair}</span>
                    <span className="rounded px-1.5 py-0.5 text-[9px]" style={{ color: badge.fg, background: badge.bg }}>
                      {badge.text}
                    </span>
                    <span className="text-zinc-600">{ago(position.openedAt)}</span>
                  </div>
                  <span style={{ color: tone(position.grossMarkPnlApproxUsd ?? 0) }}>
                    {usd(position.grossMarkPnlApproxUsd)}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px] text-zinc-500">
                  <span>entry {num(position.entryPrice)} / mark {num(position.markPrice)}</span>
                  <span>cap {usd(position.capitalUsed)} · notional {usd(position.notionalUsd)} · x{position.leverage ?? '-'}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Resumen cerrado' : 'Closed summary'}
        </div>
        <div className="space-y-1">
          {closedSummary.length === 0 ? (
            <div className="rounded bg-[#151206] px-2 py-2 font-mono text-[10px] text-zinc-600">
              {es ? 'Aun no hay cierres en futuros.' : 'No closed futures trades yet.'}
            </div>
          ) : closedSummary.map((row) => (
            <div key={row.tradeType} className="flex items-center justify-between gap-3 rounded bg-[#151206] px-2 py-1.5 font-mono text-[10px]">
              <span className="w-20 text-zinc-300">{summaryLabel(row)}</span>
              <span className="text-zinc-500">{row.closedTrades} trd</span>
              <span className="text-zinc-500">WR {pct(row.winRate)}</span>
              <span style={{ color: tone(row.totalPnl) }}>{usd(row.totalPnl)}</span>
              <span className="text-zinc-500">avg {usd(row.avgPnl)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Alertas lifecycle' : 'Lifecycle alerts'}
        </div>
        <div className="space-y-1">
          {lifecycle.length === 0 ? (
            <div className="rounded bg-[#151206] px-2 py-2 font-mono text-[10px] text-zinc-600">
              {es ? 'Sin aperturas o cierres recientes.' : 'No recent opens or closes.'}
            </div>
          ) : lifecycle.map((item) => (
            <div key={`${item.event}-${item.id}-${item.eventAt}`} className="rounded bg-[#151206] px-2 py-1.5">
              <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-200">{item.pair}</span>
                  <span style={{ color: item.event === 'opened' ? '#22c55e' : tone(item.pnl ?? 0) }}>
                    {item.event === 'opened' ? 'OPEN' : 'CLOSE'}
                  </span>
                  <span className="text-zinc-500">{item.side}</span>
                </div>
                <span className="text-zinc-500">{fmtEvent(item.eventAt)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-3 font-mono text-[9px]">
                <span className="text-zinc-600">{item.reason ?? '-'}</span>
                <span style={{ color: item.event === 'closed' ? tone(item.pnl ?? 0) : '#9ca3af' }}>
                  {item.event === 'closed' ? usd(item.pnl) : item.tradeType}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Historial de ciclos' : 'Cycle history'}
        </div>
        <div className="space-y-1">
          {cycleHistory.length === 0 ? (
            <div className="rounded bg-[#151206] px-2 py-2 font-mono text-[10px] text-zinc-600">
              {es ? 'Sin historial de ciclos aun.' : 'No cycle history yet.'}
            </div>
          ) : cycleHistory.slice(0, 6).map((item) => (
            <div key={`${item.startedAt}-${item.completedAt}`} className="rounded bg-[#151206] px-2 py-1.5">
              <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                <span className="text-zinc-200">{fmtEvent(item.completedAt ?? item.startedAt)}</span>
                <span className="text-zinc-500">{item.executed} exec / {item.qualified} qual / {item.scanned} scan</span>
              </div>
              <div className="mt-1 font-mono text-[9px] text-zinc-600">
                {item.profiles.map((profile) => `${profile.profile}:${profile.executed}/${profile.qualified}`).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1 font-mono text-[8px] uppercase tracking-[0.14em] text-zinc-600">
          {es ? 'Ultimo ciclo' : 'Last cycle'}
        </div>
        {!futuresDesk.cycle ? (
          <div className="rounded bg-[#151206] px-2 py-2 font-mono text-[10px] text-zinc-600">
            {es ? 'Aun no hay diagnostico de ciclo.' : 'No cycle diagnostics yet.'}
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded bg-[#151206] px-2 py-1.5 font-mono text-[10px] text-zinc-400">
              scan {futuresDesk.cycle.scanned} · qualified {futuresDesk.cycle.qualified} · executed {futuresDesk.cycle.executed} · skipped {futuresDesk.cycle.skipped}
            </div>
            {futuresDesk.cycle.profiles.map((profile) => (
              <div key={profile.profile} className="rounded bg-[#151206] px-2 py-2">
                <div className="flex items-center justify-between gap-3 font-mono text-[10px]">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-200">{profile.profile}</span>
                    <span className="text-zinc-600">[{profileMeta.get(profile.profile)?.tier ?? '-'}/{profileMeta.get(profile.profile)?.interval ?? '-'}]</span>
                  </div>
                  <span style={{ color: profile.blocked ? '#f59e0b' : '#a1a1aa' }}>
                    {profile.blocked ? (profile.blockReason ?? 'blocked') : `${profile.executed} exec / ${profile.qualified} qual`}
                  </span>
                </div>
                <div className="mt-2 space-y-1">
                  {profile.pairResults.map((row) => (
                    <div key={`${profile.profile}-${row.pair}`} className="flex items-center justify-between gap-3 font-mono text-[9px]">
                      <span className="w-16 text-zinc-300">{row.pair}</span>
                      <span
                        style={{
                          color: row.status === 'executed' ? '#22c55e' : row.status === 'blocked' ? '#f59e0b' : '#9ca3af',
                        }}
                      >
                        {row.status}
                      </span>
                      <span className="text-zinc-500">{row.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
