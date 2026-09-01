import { apiUrl, fetchApi } from '@services/apiBase';

export interface CaptureRow {
  symbol: string;
  sleeve?: string | null;
  quote: boolean;
  reason: string;
  harvestBps: number;
  spreadBps: number;
  feeBps: number;
  asBps: number;
  vpin: number;
  netPnl: number;
  fillCount: number;
  captureReason: string;
  tapeLen: number;
  fair?: number;
  mid?: number;
  imbalance?: number;
  kellyF?: number;
}

export interface CaptureLedger {
  paperBalanceUSDT: number;
  start: number;
  liveOff: boolean;
}

export interface CaptureReport {
  ok: boolean;
  liveOff: boolean;
  paper: boolean;
  go: boolean;
  venue: string;
  makerFeePct?: number;
  capital?: number;
  scanned: number;
  quoted: number;
  filled: number;
  pending?: number;
  scored?: number;
  rows: CaptureRow[];
  ledger: CaptureLedger;
  note?: string;
  error?: string;
  updatedAt: string;
  tape?: {
    ts: string | null;
    scored: number;
    quoted: number;
    reasons: Record<string, number>;
    quotedNames: string[];
    liveOff: boolean;
    go: boolean;
  } | null;
  intersection?: { liquid: number; hGe: number; band: number; both: number };
  funding?: {
    ts: string | null;
    settledCount: number;
    realizedFundingUsdt: number;
    mtmUsdt: number;
    feesUsdt: number;
    holds: { instId: string; side: string; predictedBps?: number; lastRealizedBps?: number; nextFundingTime?: number; realizedFundingUsdt?: number; mtmUsdt?: number; halt?: boolean }[];
    liveOff: boolean;
    go: boolean;
    note?: string | null;
  } | null;
  hz1?: {
    ts: string | null;
    preQuote: number;
    quoted: number;
    filled: number;
    paperPnl: number;
    quotedNames: string[];
    reasons: Record<string, number>;
    liveOff: boolean;
    go: boolean;
  } | null;
}

export async function fetchCaptureReport(limit = 40): Promise<CaptureReport> {
  const res = await fetchApi(apiUrl(`/api/genesis/capture?limit=${limit}`));
  if (!res.ok) throw new Error(`genesis/capture ${res.status}`);
  return res.json() as Promise<CaptureReport>;
}
