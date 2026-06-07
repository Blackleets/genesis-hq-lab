// DeskPanel.tsx — consolidated bottom-center panel for Crypto Lab.
// Tabs: POSITIONS (active positions terminal) | STATS (pnl, params, trades, optimizer).
// Replaces the old full-width data strip so the chart can be the hero.

import { useState } from 'react';
import type { CryptoOverview, TradeStory } from '@services/cryptoClient';
import { ActivePositionsTerminal } from './ActivePositionsTerminal';
import { TradeTimeline } from './TradeTimeline';
import { EngineTelemetry } from './EngineTelemetry';

const ACCENT = '#f7931a';

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n ?? 0);
const pct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;
const ago = (iso?: string | null) => {
  if (!iso) return '—';
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(m)) return '—';
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

type Tab = 'POSITIONS' | 'STATS' | 'TRADES';

const TAB_COLOR: Record<Tab, string> = {
  POSITIONS: '#3b82f6',
  STATS:     ACCENT,
  TRADES:    '#a855f7',
};

interface Props {
  data: CryptoOverview | null;
  es: boolean;
  className?: string;
  tradeStories?: TradeStory[];
  selectedTradeId?: string | null;
  onSelectTrade?: (id: string | null) => void;
}

export function DeskPanel({
  data, es, className = '',
  tradeStories = [], selectedTradeId = null, onSelectTrade,
}: Props) {
  const [tab, setTab] = useState<Tab>('POSITIONS');

  const p = data?.params;
  const pnl = data?.pnl;
  const adopted = data?.paramsMeta?.meta?.source === 'optimizer';

  return (
    <div className={className} style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#060810', border: '1px solid #1e2a3a',
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #1e2a3a' }}>
        {(['POSITIONS', 'STATS', 'TRADES'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '7px 4px',
              fontSize: 9, letterSpacing: 1, fontWeight: 700,
              textTransform: 'uppercase', fontFamily: 'monospace',
              border: 'none', cursor: 'pointer', background: 'transparent',
              color:        tab === t ? TAB_COLOR[t] : '#374151',
              borderBottom: tab === t ? `2px solid ${TAB_COLOR[t]}` : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'POSITIONS' ? (
          <ActivePositionsTerminal positions={data?.positions ?? []} noBorder />
        ) : tab === 'TRADES' ? (
          <TradeTimeline
            trades={tradeStories}
            selectedTradeId={selectedTradeId}
            onSelect={onSelectTrade}
            es={es}
          />
        ) : (
          <div className="gx-scroll" style={{ height: '100%', overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* Execution telemetry — loop status + why-no-trade */}
            <EngineTelemetry />

            {/* PnL by asset */}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5">
                {es ? 'PnL por moneda' : 'PnL by asset'}
              </div>
              {!pnl || pnl.byAsset.length === 0 ? (
                <div className="font-mono text-[10px] text-zinc-700">{es ? 'Sin trades cerrados.' : 'No closed trades.'}</div>
              ) : (
                <div className="space-y-1">
                  {pnl.byAsset.map((a) => (
                    <div key={a.pair} className="flex items-center justify-between gap-3">
                      <div>
                        <span className="font-mono text-[11px] text-zinc-200 font-bold">{a.pair.replace('USDT', '')}</span>
                        <span className="font-mono text-[9px] text-zinc-600 ml-1">{a.trades}t</span>
                      </div>
                      <span className="font-mono text-[10px] font-bold" style={{ color: a.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                        {usd(a.pnl)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Strategy params */}
            {p && (
              <div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5 flex items-center gap-2">
                  {es ? 'Parámetros' : 'Parameters'}
                  <span className="font-mono text-[8px] px-1 border"
                    style={{ color: adopted ? '#22c55e' : '#6b7280', borderColor: adopted ? '#22c55e44' : '#374151' }}>
                    {adopted ? 'optimized' : 'defaults'}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {[
                    ['Target', pct(p.targetPct)],
                    ['Stop', pct(p.stopPct)],
                    ['Timeout', `${p.timeoutHours}h`],
                    ['Momentum', `${p.momentumPct}%`],
                    ['EMA margin', pct(p.emaMarginPct)],
                    ['RSI long', `${p.rsiLongMin}–${p.rsiLongMax}`],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-zinc-900 rounded px-2 py-1">
                      <div className="font-mono text-[8px] text-zinc-600">{k}</div>
                      <div className="font-mono text-[10px] font-bold text-zinc-200">{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent trades */}
            <div>
              <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5">
                {es ? 'Trades recientes' : 'Recent trades'}
              </div>
              {!data || data.recent.length === 0 ? (
                <div className="font-mono text-[10px] text-zinc-700">{es ? 'Sin historial.' : 'No history yet.'}</div>
              ) : (
                <div className="space-y-1">
                  {data.recent.slice(0, 5).map((t) => (
                    <div key={t.id} className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-mono text-[10px] font-bold" style={{ color: t.side === 'LONG' ? '#22c55e' : '#ef4444' }}>
                          {t.side}
                        </span>
                        <span className="font-mono text-[10px] text-zinc-500"> {t.pair.replace('USDT', '')}</span>
                        <span className="font-mono text-[9px] text-zinc-700 ml-1">{t.exit_reason ?? '—'}</span>
                      </div>
                      <span className="font-mono text-[10px] font-bold" style={{ color: (t.pnl ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                        {usd(t.pnl ?? 0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Optimizer heartbeat */}
            {data?.optimizerHeartbeat && (
              <div>
                <div className="font-mono text-[9px] uppercase tracking-wider mb-1.5" style={{ color: ACCENT }}>
                  {es ? 'Optimizador' : 'Optimizer'}
                </div>
                <div className="space-y-1">
                  <div className="font-mono text-[9px] text-zinc-600">
                    {es ? 'Última corrida' : 'Last pass'}{' '}
                    <span className="text-zinc-400">{ago(data.optimizerHeartbeat.completedAt)}</span>
                  </div>
                  <div className="font-mono text-[9px] text-zinc-600">
                    {data.optimizerHeartbeat.days}d {es ? 'de datos' : 'of data'}
                  </div>
                  <div className="font-mono text-[9px]" style={{ color: data.optimizerHeartbeat.adopted ? '#22c55e' : '#6b7280' }}>
                    {data.optimizerHeartbeat.adopted ? '✓ params adoptados' : 'params actuales'}
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
