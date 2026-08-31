import { apiUrl, fetchApi } from '@services/apiBase';

export interface CaptureRow {
  symbol: string;
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
  rows: CaptureRow[];
  ledger: CaptureLedger;
  note?: string;
  error?: string;
  updatedAt: string;
}

export async function fetchCaptureReport(limit = 6): Promise<CaptureReport> {
  const res = await fetchApi(apiUrl(`/api/genesis/capture?limit=${limit}`));
  if (!res.ok) throw new Error(`genesis/capture ${res.status}`);
  return res.json() as Promise<CaptureReport>;
}
