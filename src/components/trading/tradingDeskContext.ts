import { createContext } from 'react';
import type { CaptureReport } from '@services/captureClient';
import type { FounderSnapshot } from '@services/founderClient';
import type { SystemTruth } from '@hooks/useTruthLayer';
import type { MarketSnapshot, ResourceState, TradingSymbol, TradingTimeframe } from './tradingTypes';

export interface TradingDeskContextValue {
  symbol: TradingSymbol;
  setSymbol: (symbol: TradingSymbol) => void;
  timeframe: TradingTimeframe;
  setTimeframe: (timeframe: TradingTimeframe) => void;
  market: ResourceState<MarketSnapshot>;
  truth: ResourceState<SystemTruth>;
  founder: ResourceState<FounderSnapshot>;
  capture: ResourceState<CaptureReport>;
  refresh: () => void;
}

export const TradingDeskContext = createContext<TradingDeskContextValue | null>(null);
