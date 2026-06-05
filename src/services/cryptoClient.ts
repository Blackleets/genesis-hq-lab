// cryptoClient — read-only client for the crypto scalping engine.
import { apiUrl } from '@services/apiBase';

export interface CryptoParams {
  targetPct: number;
  stopPct: number;
  timeoutHours: number;
  emaMarginPct: number;
  momentumPct: number;
  rsiLongMin: number;
  rsiLongMax: number;
  rsiShortMin: number;
  rsiShortMax: number;
  minVolume24h: number;
}

export interface CryptoPnl {
  closed: {
    total: number; wins: number; losses: number; winRate: number;
    totalPnl: number; bestTrade: number; worstTrade: number; avgPnl: number;
    totalRisked: number; roi: number;
  };
  open: { count: number; atRisk: number };
  byAsset: { pair: string; trades: number; pnl: number; wins: number; winRate: number }[];
}

export interface CryptoPosition {
  id: string; pair: string; side: string;
  entry_price: number; target_price: number; stop_price: number;
  capital_used: number; confidence: number; opened_at: string;
}

export interface CryptoTrade {
  id: string; pair: string; side: string;
  entry_price: number; exit_price: number | null; pnl: number | null;
  exit_reason: string | null; confidence: number; opened_at: string; closed_at: string | null;
}

export interface OptimizerRun {
  at: string;
  adopted: boolean;
  reason: string;
  candidate: Partial<CryptoParams>;
  isMetrics?: { trades: number; winRate: number; netPnl: number; expectancy: number };
  oosMetrics?: { trades: number; winRate: number; netPnl: number; expectancy: number };
}

export interface OptimizerHeartbeat {
  lastRunAt: string;
  completedAt: string;
  adopted: boolean;
  days: number;
  assets: number;
  bestOosExpectancy: number | null;
}

export interface CryptoOverview {
  ok: boolean;
  params: CryptoParams;
  paramsMeta: { meta?: { source?: string }; updatedAt?: string } | null;
  pnl: CryptoPnl;
  positions: CryptoPosition[];
  recent: CryptoTrade[];
  optimizerRuns: OptimizerRun[];
  optimizerHeartbeat: OptimizerHeartbeat | null;
}

export async function loadCryptoOverview(): Promise<CryptoOverview> {
  const res = await fetch(apiUrl('/api/crypto/overview'), { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Crypto overview failed: ${res.status}`);
  return res.json() as Promise<CryptoOverview>;
}
