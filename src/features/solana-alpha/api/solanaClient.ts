// solanaClient.ts — typed API client for the Solana Alpha Lab backend.

import { getApiOrigin } from '@services/apiBase';

// Same origin as the rest of the app (VITE_API_BASE). '' in dev → Vite proxies /api.
const BASE = getApiOrigin();

async function get<T>(path: string): Promise<T> {
  const urls = [`${BASE}${path}`];
  if (!BASE && typeof window !== 'undefined') {
    urls.push(`http://127.0.0.1:8788${path}`);
  }

  let lastError: Error | null = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const contentType = r.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        throw new Error('non_json_response');
      }
      return r.json() as Promise<T>;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('request_failed');
    }
  }
  throw lastError ?? new Error('request_failed');
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SolanaStatus {
  connected: boolean;
  wsStatus: string;
  subscribedTokens: number;
  startedAt: string | null;
  paperBalance: number;
  stats: { tradesOpened: number; tradesClosed: number };
}

export interface SolanaToken {
  mint: string;
  name: string;
  symbol: string;
  creator: string | null;
  marketCapSol: number;
  bondingCurvePct: number;
  lastPriceSol: number;
  tradeCount: number;
  uniqueWallets: number;
  createdTs: number;
  updatedAt: string;
}

export interface SolanaWallet {
  address: string;
  total_trades: number;
  wins: number;
  losses: number;
  total_volume_sol: number;
  avg_profit_x: number;
  score: number;
  label: string;
  last_active: string;
}

export interface SolanaSignal {
  id: string;
  token_mint: string;
  token_symbol: string;
  signal_type: string;
  confidence: number;
  reason: string;
  wallet_count: number;
  risk_score: number;
  created_at: string;
  acted_on: number;
}

export interface PaperPosition {
  id: string;
  token_mint: string;
  token_symbol: string;
  side: string;
  entry_price_sol: number;
  current_price_sol: number;
  size_sol: number;
  tokens: number;
  remaining_tokens: number;
  peak_price_sol: number;
  tp1_hit: number;
  tp2_hit: number;
  tp3_hit: number;
  realized_sol: number;
  signal_reason: string;
  status: string;
  opened_at: string;
}

export interface PaperTrade extends PaperPosition {
  exit_price_sol: number | null;
  pnl_sol: number | null;
  pnl_pct: number | null;
  closed_at: string | null;
}

export interface PaperStats {
  balance: number;
  openValue: number;
  totalSol: number;
  totalPnlSol: number;
  totalTrades: number;
  wins: number;
  winRate: number;
  avgPnlSol: number;
  openPositions: number;
  liveMode: boolean;
}

export interface EquityPoint {
  ts: string;
  balance_sol: number;
  open_value_sol: number;
  total_sol: number;
}

// ── API calls ─────────────────────────────────────────────────────────────────

export const fetchSolanaStatus     = () => get<{ ok: boolean } & SolanaStatus>('/api/solana/status');
export const fetchSolanaTokens     = (limit = 50) => get<{ ok: boolean; tokens: SolanaToken[] }>(`/api/solana/tokens?limit=${limit}`);
export const fetchSolanaWallets    = (limit = 50) => get<{ ok: boolean; wallets: SolanaWallet[]; summary: { total: number; smart: number } }>(`/api/solana/wallets?limit=${limit}`);
export const fetchSolanaSignals    = (limit = 30) => get<{ ok: boolean; signals: SolanaSignal[] }>(`/api/solana/signals?limit=${limit}`);
export const fetchPaperStats       = () => get<{ ok: boolean } & PaperStats>('/api/solana/paper/stats');
export const fetchPaperPositions   = () => get<{ ok: boolean; positions: PaperPosition[] }>('/api/solana/paper/positions');
export const fetchPaperTrades      = (limit = 50) => get<{ ok: boolean; trades: PaperTrade[] }>(`/api/solana/paper/trades?limit=${limit}`);
export const fetchEquityCurve      = (limit = 200) => get<{ ok: boolean; curve: EquityPoint[] }>(`/api/solana/paper/equity?limit=${limit}`);
export const resetPaperBalance     = () => post<{ ok: boolean; balance: number; message: string }>('/api/solana/paper/reset');
