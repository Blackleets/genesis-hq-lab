// PredictionMarketsLab.tsx — Genesis HQ Prediction Markets module.
// Modules: Data Layer · Backtesting · LP Tooling · Execution (paper) · Risk Guard.
// Live trading is LOCKED by default (ENABLE_LIVE_PREDICTION_TRADING env var).

import { MarketStatusPanel } from '@components/predictionMarkets/MarketStatusPanel';
import { MarketTable } from '@components/predictionMarkets/MarketTable';
import { OpportunityPanel } from '@components/predictionMarkets/OpportunityPanel';
import { BacktestPanel } from '@components/predictionMarkets/BacktestPanel';
import { LPPanel } from '@components/predictionMarkets/LPPanel';
import { ExecutionPanel } from '@components/predictionMarkets/ExecutionPanel';
import { RiskPanel } from '@components/predictionMarkets/RiskPanel';
import { PredictionMarketLogs } from '@components/predictionMarkets/PredictionMarketLogs';

const ACCENT = '#a78bfa'; // prediction markets accent — purple

export default function PredictionMarketsLab() {
  return (
    <main className="flex-1 overflow-y-auto bg-[#060a0f] px-6 py-5 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-lg font-bold tracking-tight text-zinc-100">Prediction Markets Lab</h1>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono font-bold"
              style={{ color: ACCENT, background: `${ACCENT}18`, border: `1px solid ${ACCENT}33` }}>
              PAPER_MODE
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[9px] font-mono font-bold"
              style={{ color: '#ef4444', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.25)' }}>
              LIVE_LOCKED
            </span>
          </div>
          <p className="text-xs text-zinc-500">
            Polymarket · Kalshi · Backtesting · LP Analysis · Risk-gated execution
          </p>
        </div>
        <div className="text-[9px] font-mono text-zinc-700 text-right">
          <p>No real capital at risk</p>
          <p>Live trading requires explicit unlock</p>
        </div>
      </div>

      {/* Row 1: Status + Risk */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <MarketStatusPanel />
        </div>
        <div>
          <RiskPanel />
        </div>
      </div>

      {/* Row 2: Markets + Opportunities */}
      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-2">
          <MarketTable />
        </div>
        <div>
          <OpportunityPanel />
        </div>
      </div>

      {/* Row 3: Backtesting + LP */}
      <div className="grid grid-cols-2 gap-4">
        <BacktestPanel />
        <LPPanel />
      </div>

      {/* Row 4: Execution + Logs */}
      <div className="grid grid-cols-2 gap-4">
        <ExecutionPanel />
        <PredictionMarketLogs />
      </div>

      {/* Footer disclaimer */}
      <div className="rounded-lg border border-zinc-900 bg-zinc-950/50 px-4 py-3">
        <p className="text-[9px] text-zinc-600 font-mono leading-relaxed">
          ⚠ DISCLAIMER: This module is for research and paper trading only. Backtest results use synthetic fixture data and do not represent real performance or guarantee future results.
          Live trading requires <code className="text-zinc-500">ENABLE_LIVE_PREDICTION_TRADING=true</code> + <code className="text-zinc-500">MANUAL_CONFIRMATION_TOKEN</code> to be set explicitly in the server environment.
          All orders are subject to safety limits: max position size ${'{MAX_PREDICTION_POSITION_SIZE}'} · daily loss cap ${'{MAX_PREDICTION_DAILY_LOSS}'}.
        </p>
      </div>
    </main>
  );
}
