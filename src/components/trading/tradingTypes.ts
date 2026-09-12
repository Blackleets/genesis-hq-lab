import type { ChartCandle } from '@workflows/QuantChart';

export const TRADING_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'] as const;
export const TRADING_TIMEFRAMES = ['5m', '15m', '1h', '4h'] as const;

export type TradingSymbol = (typeof TRADING_SYMBOLS)[number];
export type TradingTimeframe = (typeof TRADING_TIMEFRAMES)[number];
export type DataState = 'loading' | 'ready' | 'stale' | 'unavailable' | 'error';

export interface MarketTicker {
  symbol: TradingSymbol;
  lastPrice: number | null;
  changePct: number | null;
  quoteVolume: number | null;
  updatedAt: string | null;
  state: Exclude<DataState, 'loading' | 'error'>;
  source: 'binance_spot_public';
}

export interface MarketSnapshot {
  ok: true;
  pair: TradingSymbol;
  tf: TradingTimeframe;
  market: 'binance_spot_public';
  candles: ChartCandle[];
  watchlist: MarketTicker[];
  lastPrice: number | null;
  changePct: number | null;
  updatedAt: string;
}

export interface ResourceState<T> {
  state: DataState;
  data: T | null;
  updatedAt: string | null;
  error: string | null;
}

export const SOURCE_OF_TRUTH = Object.freeze({
  watchlist: 'MARKET DATA',
  chart: 'MARKET DATA',
  position: 'PAPER EXECUTION DATA',
  executions: 'PAPER EXECUTION DATA',
  decisions: 'SYSTEM / DECISION DATA',
  strategies: 'PAPER LEDGER WINDOW',
  risk: 'RISK + ECONOMIC TRUTH',
  engine: 'SYSTEM HEALTH',
  agents: 'REAL AGENT / SYSTEM STATE',
  control: 'FOUNDER / EXECUTION SAFETY STATE',
} as const);
