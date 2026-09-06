import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchCaptureReport, type CaptureReport } from '@services/captureClient';
import { fetchFounderSnapshot, type FounderSnapshot } from '@services/founderClient';
import { fetchApi } from '@services/apiBase';
import { fetchSystemTruth, type SystemTruth } from '@hooks/useTruthLayer';
import {
  TRADING_SYMBOLS,
  type MarketSnapshot,
  type MarketTicker,
  type ResourceState,
  type TradingSymbol,
  type TradingTimeframe,
} from './tradingTypes';
import { TradingDeskContext, type TradingDeskContextValue } from './tradingDeskContext';

const POLL_MS = 15_000;
const MARKET_STALE_MS = 60_000;

const emptyResource = <T,>(): ResourceState<T> => ({ state: 'loading', data: null, updatedAt: null, error: null });

function message(error: unknown) {
  return error instanceof Error ? error.message : 'unknown_error';
}

function timestampState(timestamp: string | null | undefined, staleAfterMs = MARKET_STALE_MS): MarketTicker['state'] {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(parsed)) return 'unavailable';
  return Date.now() - parsed > staleAfterMs ? 'stale' : 'ready';
}

function isTradingSymbol(value: unknown): value is TradingSymbol {
  return TRADING_SYMBOLS.includes(value as TradingSymbol);
}

function normalizeTicker(value: unknown): MarketTicker | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<MarketTicker>;
  if (!isTradingSymbol(row.symbol)) return null;
  const lastPrice = typeof row.lastPrice === 'number' && Number.isFinite(row.lastPrice) ? row.lastPrice : null;
  const changePct = typeof row.changePct === 'number' && Number.isFinite(row.changePct) ? row.changePct : null;
  const quoteVolume = typeof row.quoteVolume === 'number' && Number.isFinite(row.quoteVolume) ? row.quoteVolume : null;
  const updatedAt = typeof row.updatedAt === 'string' && Number.isFinite(Date.parse(row.updatedAt)) ? row.updatedAt : null;
  const state = lastPrice == null ? 'unavailable' : timestampState(updatedAt);
  return { symbol: row.symbol, lastPrice, changePct, quoteVolume, updatedAt, state, source: 'binance_spot_public' };
}

function normalizeMarket(value: unknown, symbol: TradingSymbol, timeframe: TradingTimeframe): MarketSnapshot {
  if (!value || typeof value !== 'object') throw new Error('invalid_market_payload');
  const payload = value as Partial<MarketSnapshot>;
  if (payload.ok !== true || payload.pair !== symbol || payload.tf !== timeframe || payload.market !== 'binance_spot_public'
    || !Array.isArray(payload.candles) || payload.candles.length < 20) throw new Error('invalid_market_payload');
  const candles = payload.candles.filter((candle) => candle
    && Number.isFinite(candle.time) && Number.isFinite(candle.open) && Number.isFinite(candle.high)
    && Number.isFinite(candle.low) && Number.isFinite(candle.close)
    && (candle.volume == null || Number.isFinite(candle.volume)));
  if (candles.length < 20) throw new Error('invalid_market_candles');
  const incoming = Array.isArray(payload.watchlist) ? payload.watchlist.map(normalizeTicker).filter((row): row is MarketTicker => row !== null) : [];
  const bySymbol = new Map(incoming.map((row) => [row.symbol, row]));
  const watchlist = TRADING_SYMBOLS.map((pair): MarketTicker => {
    const ticker = bySymbol.get(pair);
    if (ticker) return ticker;
    const hasSelectedPrice = pair === symbol && typeof payload.lastPrice === 'number' && Number.isFinite(payload.lastPrice);
    return {
      symbol: pair,
      lastPrice: hasSelectedPrice ? payload.lastPrice as number : null,
      changePct: null,
      quoteVolume: null,
      updatedAt: pair === symbol && typeof payload.updatedAt === 'string' ? payload.updatedAt : null,
      state: hasSelectedPrice ? timestampState(payload.updatedAt) : 'unavailable',
      source: 'binance_spot_public',
    };
  });
  if (typeof payload.updatedAt !== 'string' || !Number.isFinite(Date.parse(payload.updatedAt))) throw new Error('invalid_market_timestamp');
  return {
    ok: true,
    pair: symbol,
    tf: timeframe,
    market: 'binance_spot_public',
    candles,
    watchlist,
    lastPrice: typeof payload.lastPrice === 'number' && Number.isFinite(payload.lastPrice) ? payload.lastPrice : null,
    changePct: typeof payload.changePct === 'number' && Number.isFinite(payload.changePct) ? payload.changePct : null,
    updatedAt: payload.updatedAt,
  };
}

export function TradingDeskProvider({ children }: { children: ReactNode }) {
  const [symbol, setSymbolState] = useState<TradingSymbol>('BTCUSDT');
  const [timeframe, setTimeframeState] = useState<TradingTimeframe>('5m');
  const [market, setMarket] = useState<ResourceState<MarketSnapshot>>(emptyResource);
  const [truth, setTruth] = useState<ResourceState<SystemTruth>>(emptyResource);
  const [founder, setFounder] = useState<ResourceState<FounderSnapshot>>(emptyResource);
  const [capture, setCapture] = useState<ResourceState<CaptureReport>>(emptyResource);
  const [refreshToken, setRefreshToken] = useState(0);
  const setSymbol = useCallback((next: TradingSymbol) => { setMarket(emptyResource()); setSymbolState(next); }, []);
  const setTimeframe = useCallback((next: TradingTimeframe) => { setMarket(emptyResource()); setTimeframeState(next); }, []);
  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (pending) return;
      pending = true;
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetchApi(`/api/genesis/candles?pair=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(timeframe)}&limit=320`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`market_http_${response.status}`);
        const next = normalizeMarket(await response.json(), symbol, timeframe);
        if (!disposed) setMarket({ state: timestampState(next.updatedAt), data: next, updatedAt: next.updatedAt, error: null });
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === 'AbortError')) {
          setMarket({ state: 'error', data: null, updatedAt: null, error: message(error) });
        }
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => { disposed = true; controller?.abort(); window.clearInterval(timer); };
  }, [symbol, timeframe, refreshToken]);

  useEffect(() => {
    let disposed = false;
    let pending = false;
    let controller: AbortController | null = null;
    const load = async () => {
      if (pending) return;
      pending = true;
      controller?.abort();
      controller = new AbortController();
      const [healthResult, founderResult, captureResult] = await Promise.allSettled([
        fetchSystemTruth(controller.signal),
        fetchFounderSnapshot(controller.signal, true),
        fetchCaptureReport(40),
      ]);
      if (!disposed) {
        if (healthResult.status === 'fulfilled') {
          setTruth({ state: 'ready', data: healthResult.value, updatedAt: healthResult.value.timestamp, error: null });
        } else setTruth({ state: 'error', data: null, updatedAt: null, error: message(healthResult.reason) });

        if (founderResult.status === 'fulfilled') {
          setFounder({ state: timestampState(founderResult.value.updatedAt), data: founderResult.value, updatedAt: founderResult.value.updatedAt, error: null });
        } else setFounder({ state: 'error', data: null, updatedAt: null, error: message(founderResult.reason) });

        if (captureResult.status === 'fulfilled' && captureResult.value.ok === true && captureResult.value.paper === true) {
          setCapture({ state: timestampState(captureResult.value.updatedAt, 120_000), data: captureResult.value, updatedAt: captureResult.value.updatedAt, error: null });
        } else {
          const reason = captureResult.status === 'rejected' ? captureResult.reason : new Error('invalid_capture_payload');
          setCapture({ state: 'error', data: null, updatedAt: null, error: message(reason) });
        }
      }
      pending = false;
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => { disposed = true; controller?.abort(); window.clearInterval(timer); };
  }, [refreshToken]);

  const value = useMemo<TradingDeskContextValue>(() => ({
    symbol, setSymbol, timeframe, setTimeframe, market, truth, founder, capture, refresh,
  }), [symbol, setSymbol, timeframe, setTimeframe, market, truth, founder, capture, refresh]);

  return <TradingDeskContext.Provider value={value}>{children}</TradingDeskContext.Provider>;
}
