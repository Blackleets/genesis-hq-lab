import type { RunnerTrade } from '@hooks/useTruthLayer';
import type { DataState } from './tradingTypes';

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function formatPrice(value: unknown) {
  if (!finite(value)) return 'UNAVAILABLE';
  const digits = value < 1 ? 6 : value < 100 ? 4 : 2;
  return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatMoney(value: unknown, digits = 2) {
  if (!finite(value)) return 'UNAVAILABLE';
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatPercent(value: unknown, digits = 2) {
  if (!finite(value)) return 'UNAVAILABLE';
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;
}

export function shortSymbol(symbol: string) {
  return symbol.replace('USDT', '');
}

export function durationLabel(timestamp: string | null | undefined, now = Date.now()) {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(parsed)) return 'UNAVAILABLE';
  const minutes = Math.max(0, Math.floor((now - parsed) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function heartbeatLabel(timestamp: string | null | undefined, now = Date.now()) {
  const parsed = timestamp ? Date.parse(timestamp) : Number.NaN;
  if (!Number.isFinite(parsed)) return 'UNAVAILABLE';
  const seconds = Math.max(0, Math.round((now - parsed) / 1000));
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
}

export function profileFromTrade(trade: Pick<RunnerTrade, 'tradeType'>) {
  const type = trade.tradeType ?? '';
  if (type.includes('short_micro')) return 'short_micro';
  if (type.includes('short_alt')) return 'short_alt';
  if (type.includes('long')) return 'long_probe';
  if (type.includes('short')) return 'short_core';
  return 'UNAVAILABLE';
}

export function stateLabel(state: DataState) {
  return state === 'ready' ? 'READY' : state.toUpperCase();
}
