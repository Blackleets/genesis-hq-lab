import { useContext } from 'react';
import type { RunnerTrade } from '@hooks/useTruthLayer';
import type { ResourceState } from './tradingTypes';
import { TradingDeskContext } from './tradingDeskContext';

function useDeskContext() {
  const value = useContext(TradingDeskContext);
  if (!value) throw new Error('Trading desk hooks require TradingDeskProvider');
  return value;
}

export function useMarketData() {
  const { symbol, setSymbol, timeframe, setTimeframe, market, refresh } = useDeskContext();
  return { symbol, setSymbol, timeframe, setTimeframe, market, refresh };
}

export function useRunnerTelemetry() {
  const { truth } = useDeskContext();
  return { resource: truth, runner: truth.data?.agentRunner ?? null, execution: truth.data?.execution ?? null };
}

export function usePaperPositions(): ResourceState<RunnerTrade[]> {
  const { truth } = useDeskContext();
  const rows = truth.data && Array.isArray(truth.data.agentRunner.openPositions) ? truth.data.agentRunner.openPositions : null;
  return { ...truth, data: rows };
}

export function useExecutions(): ResourceState<RunnerTrade[]> {
  const { truth } = useDeskContext();
  const rows = truth.data && Array.isArray(truth.data.agentRunner.recentTrades) ? truth.data.agentRunner.recentTrades : null;
  return { ...truth, data: rows };
}

export function useRiskState() {
  const { truth, capture, founder } = useDeskContext();
  return { truth, capture, founder };
}

export function useFounderState() {
  const { founder } = useDeskContext();
  return founder;
}
