export interface MarketOutcome {
  label: string;
  price: number | null;
}

export interface MarketSnapshotEntry {
  id: string;
  slug: string;
  question: string;
  description: string;
  endDate: string | null;
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  liquidity: number | null;
  volume: number | null;
  volume24hr: number | null;
  lastTradePrice: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  spread: number | null;
  outcomes: MarketOutcome[];
}

export interface MarketEventSnapshot {
  id: string;
  slug: string;
  title: string;
  description: string;
  endDate: string | null;
  image: string | null;
  active: boolean;
  closed: boolean;
  liquidity: number | null;
  volume: number | null;
  volume24hr: number | null;
  openInterest: number | null;
  tags: string[];
  url: string | null;
  markets: MarketSnapshotEntry[];
}

export interface PolymarketSnapshotResponse {
  ok: boolean;
  provider: 'polymarket';
  mode: 'read-only';
  source: string;
  fetchedAt: string;
  events: MarketEventSnapshot[];
}

export interface MarketsClientError extends Error {
  code?: string;
}

function getApiBase() {
  const envBase = import.meta.env.VITE_MARKETS_API_BASE;
  if (envBase && envBase.trim().length > 0) {
    return envBase.replace(/\/$/, '');
  }

  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:8787/api`;
  }

  return 'http://127.0.0.1:8787/api';
}

export async function loadPolymarketSnapshot(limit = 8): Promise<PolymarketSnapshotResponse> {
  const base = getApiBase();
  const response = await fetch(`${base}/polymarket/events?limit=${limit}`, {
    headers: { accept: 'application/json' },
  });

  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    let code: string | undefined;

    try {
      const errorPayload = await response.json() as { message?: string; error?: string };
      message = errorPayload.message || message;
      code = errorPayload.error;
    } catch {
      // keep the generic message
    }

    const error = new Error(message) as MarketsClientError;
    error.code = code;
    throw error;
  }

  return response.json() as Promise<PolymarketSnapshotResponse>;
}
