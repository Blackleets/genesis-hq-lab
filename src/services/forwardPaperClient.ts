const FORWARD_PAPER_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/capture-tape/quant-evidence/forward-paper-latest.json';

export interface ForwardPaperMetrics {
  trades: number | null;
  expectancyBps: number | null;
  profitFactor: number | null;
  tStat: number | null;
  maxDrawdownPct: number | null;
}

export interface ForwardPaperFamily {
  familyKey: string;
  championId: string;
  championFrozenAt: string | null;
  selectionBasis: string;
  independentEvidenceUnits: number;
  variantCount: number;
  championForward: ForwardPaperMetrics;
  championEvidenceStatus: string;
  forwardGate: string;
  nextStageEligible: boolean;
  liveEligible: false;
}

export interface ForwardPaperSnapshot {
  ok: boolean;
  version: string;
  mode: string;
  paperOnly: true;
  liveOrders: false;
  executionAuthority: false;
  capitalEligible: false;
  completedAt: string | null;
  enrolled: number;
  familyCount: number;
  openShadows: number;
  families: ForwardPaperFamily[];
}

export async function fetchForwardPaper(signal?: AbortSignal): Promise<ForwardPaperSnapshot> {
  const response = await fetch(FORWARD_PAPER_URL, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`forward paper tape ${response.status}`);
  const payload = await response.json() as ForwardPaperSnapshot;
  if (payload.paperOnly !== true || payload.liveOrders !== false || payload.executionAuthority !== false || payload.capitalEligible !== false) {
    throw new Error('forward_paper_boundary_unverified');
  }
  return payload;
}
