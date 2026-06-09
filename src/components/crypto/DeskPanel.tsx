import { useState } from 'react';
import type {
  BreakoutShadowDiagnostics,
  CryptoOverview,
  ExecutionDiagnostics,
  FuturesDeskSnapshot,
  ShadowCandidateDiagnostics,
  TradeStory,
} from '@services/cryptoClient';
import { ActivePositionsTerminal } from './ActivePositionsTerminal';
import { BreakoutShadowPanel } from './BreakoutShadowPanel';
import { EngineTelemetry } from './EngineTelemetry';
import { FuturesDeskPanel } from './FuturesDeskPanel';
import { ShadowCandidatePanel } from './ShadowCandidatePanel';
import { TradeTimeline } from './TradeTimeline';

const ACCENT = '#f7931a';

const usd = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n ?? 0);
const pct = (n: number) => `${((n ?? 0) * 100).toFixed(1)}%`;
const ago = (iso?: string | null) => {
  if (!iso) return '-';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(minutes)) return '-';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
};

type Tab = 'POSITIONS' | 'STATS' | 'TRADES';

const TAB_COLOR: Record<Tab, string> = {
  POSITIONS: '#3b82f6',
  STATS: ACCENT,
  TRADES: '#a855f7',
};

interface Props {
  data: CryptoOverview | null;
  es: boolean;
  className?: string;
  tradeStories?: TradeStory[];
  selectedTradeId?: string | null;
  onSelectTrade?: (id: string | null) => void;
  diagnostics?: ExecutionDiagnostics | null;
  shadowCandidate?: ShadowCandidateDiagnostics | null;
  breakoutShadow?: BreakoutShadowDiagnostics | null;
  futuresDesk?: FuturesDeskSnapshot | null;
  onRunFuturesCycle?: () => void;
  onResetFuturesBaseline?: () => void;
  futuresCycleBusy?: boolean;
  futuresBaselineBusy?: boolean;
  futuresCycleStatus?: string | null;
}

function LegacyStats({
  data,
  es,
  diagnostics,
  shadowCandidate,
  breakoutShadow,
}: {
  data: CryptoOverview | null;
  es: boolean;
  diagnostics?: ExecutionDiagnostics | null;
  shadowCandidate?: ShadowCandidateDiagnostics | null;
  breakoutShadow?: BreakoutShadowDiagnostics | null;
}) {
  const params = data?.params;
  const pnl = data?.pnl;
  const adopted = data?.paramsMeta?.meta?.source === 'optimizer';

  return (
    <>
      <EngineTelemetry diagnostics={diagnostics} />
      <BreakoutShadowPanel shadow={breakoutShadow ?? null} es={es} />
      <ShadowCandidatePanel shadow={shadowCandidate ?? null} es={es} />

      <div>
        <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5">
          {es ? 'PnL por moneda' : 'PnL by asset'}
        </div>
        {!pnl || pnl.byAsset.length === 0 ? (
          <div className="font-mono text-[10px] text-zinc-700">{es ? 'Sin trades cerrados.' : 'No closed trades.'}</div>
        ) : (
          <div className="space-y-1">
            {pnl.byAsset.map((asset) => (
              <div key={asset.pair} className="flex items-center justify-between gap-3">
                <div>
                  <span className="font-mono text-[11px] text-zinc-200 font-bold">{asset.pair.replace('USDT', '')}</span>
                  <span className="font-mono text-[9px] text-zinc-600 ml-1">{asset.trades}t</span>
                </div>
                <span className="font-mono text-[10px] font-bold" style={{ color: asset.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                  {usd(asset.pnl)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {params ? (
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-zinc-600 mb-1.5 flex items-center gap-2">
            {es ? 'Parámetros' : 'Parameters'}
            <span
              className="font-mono text-[8px] px-1 border"
              style={{ color: adopted ? '#22c55e' : '#6b7280', borderColor: adopted ? '#22c55e44' : '#374151' }}
            >
              {adopted ? 'optimized' : 'defaults'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {[
              ['Target', pct(params.targetPct)],
              ['Stop', pct(params.stopPct)],
              ['Timeout', `${params.timeoutHours}h`],
              ['Momentum', `${params.momentumPct}%`],
              ['EMA margin', pct(params.emaMarginPct)],
              ['RSI long', `${params.rsiLongMin}-${params.rsiLongMax}`],
            ].map(([k, v]) => (
              <div key={k} className="bg-zinc-900 rounded px-2 py-1">
                <div className="font-mono text-[8px] text-zinc-600">{k}</div>
                <div className="font-mono text-[10px] font-bold text-zinc-200">{v}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {data?.optimizerHeartbeat ? (
        <div>
          <div className="font-mono text-[9px] uppercase tracking-wider mb-1.5" style={{ color: ACCENT }}>
            {es ? 'Optimizador' : 'Optimizer'}
          </div>
          <div className="space-y-1">
            <div className="font-mono text-[9px] text-zinc-600">
              {es ? 'Última corrida' : 'Last pass'} <span className="text-zinc-400">{ago(data.optimizerHeartbeat.completedAt)}</span>
            </div>
            <div className="font-mono text-[9px] text-zinc-600">
              {data.optimizerHeartbeat.days}d {es ? 'de datos' : 'of data'}
            </div>
            <div className="font-mono text-[9px]" style={{ color: data.optimizerHeartbeat.adopted ? '#22c55e' : '#6b7280' }}>
              {data.optimizerHeartbeat.adopted ? 'params adoptados' : 'params actuales'}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

export function DeskPanel({
  data,
  es,
  className = '',
  tradeStories = [],
  selectedTradeId = null,
  onSelectTrade,
  diagnostics,
  shadowCandidate,
  breakoutShadow,
  futuresDesk,
  onRunFuturesCycle,
  onResetFuturesBaseline,
  futuresCycleBusy = false,
  futuresBaselineBusy = false,
  futuresCycleStatus = null,
}: Props) {
  const [tab, setTab] = useState<Tab>('STATS');
  const futuresOnlyView = (futuresDesk?.config.profiles.length ?? 0) > 0;

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#060810',
        border: '1px solid #1e2a3a',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', flexShrink: 0, borderBottom: '1px solid #1e2a3a' }}>
        {(['POSITIONS', 'STATS', 'TRADES'] as Tab[]).map((tabKey) => (
          <button
            key={tabKey}
            onClick={() => setTab(tabKey)}
            style={{
              flex: 1,
              padding: '7px 4px',
              fontSize: 9,
              letterSpacing: 1,
              fontWeight: 700,
              textTransform: 'uppercase',
              fontFamily: 'monospace',
              border: 'none',
              cursor: 'pointer',
              background: 'transparent',
              color: tab === tabKey ? TAB_COLOR[tabKey] : '#374151',
              borderBottom: tab === tabKey ? `2px solid ${TAB_COLOR[tabKey]}` : '2px solid transparent',
              transition: 'color 0.15s, border-color 0.15s',
            }}
          >
            {tabKey}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {tab === 'POSITIONS' ? (
          <ActivePositionsTerminal positions={data?.positions ?? []} noBorder />
        ) : tab === 'TRADES' ? (
          <TradeTimeline trades={tradeStories} selectedTradeId={selectedTradeId} onSelect={onSelectTrade} es={es} />
        ) : (
          <div className="gx-scroll" style={{ height: '100%', overflowY: 'auto', padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <FuturesDeskPanel
              futuresDesk={futuresDesk ?? null}
              es={es}
              onRunCycle={onRunFuturesCycle}
              onResetBaseline={onResetFuturesBaseline}
              runBusy={futuresCycleBusy}
              baselineBusy={futuresBaselineBusy}
              runStatus={futuresCycleStatus}
            />

            {!futuresOnlyView ? (
              <LegacyStats
                data={data}
                es={es}
                diagnostics={diagnostics}
                shadowCandidate={shadowCandidate}
                breakoutShadow={breakoutShadow}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
