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

export interface FuturesDeskConfig {
  breakoutPeriod: number;
  regimeSmaPeriod: number;
  tpPct: number;
  slPct: number;
  minExpectedNetUsd: number;
  minRewardRisk: number;
  timeoutHours: number;
  maxMargin: number;
  leverage: number;
  governor: {
    windowDays: number;
    degradeMinSamples: number;
    pauseMinSamples: number;
    evaluatedAt: string;
    supervisor: {
      maxDailyLoss: number;
      maxConsecutiveLosses: number;
      cooldownHours: number;
    };
    profiles: Array<{
      id: string;
      tradeType: string;
      trades: number;
      wins: number;
      winRate: number | null;
      totalPnl: number;
      avgPnl: number;
      expectancy: number;
      profitFactor: number | null;
      maxDrawdown: number;
      rankScore: number;
      mode: 'learning' | 'degraded' | 'paused' | 'active';
      capitalMultiplier: number;
      leverageMultiplier: number;
      reason: string;
      supervisor: {
        dailyTrades: number;
        dailyPnl: number;
        consecutiveLosses: number;
        cooldownUntil: string | null;
        mode: 'cooldown' | 'live';
        reason: string | null;
      };
    }>;
  };
  profiles: Array<{
    id: string;
    enabled: boolean;
    agentId: string;
    tradeType: string;
    tier: string;
    interval: string;
    breakoutPeriod: number;
    maxMargin: number;
    timeoutHours: number;
    minExpectedNetUsd: number;
    minRewardRisk: number;
    pairs: string[];
  }>;
}

export interface FuturesDeskBaseline {
  baselineAt: string;
  resetBy?: string | null;
  note?: string | null;
}

export interface FuturesDeskTreasury {
  total: number;
  available: number;
  inTrades: number;
  unrealizedPnl: number;
  netWorth: number;
  drawdownPct: number | null;
  isPaused: boolean;
}

export interface FuturesDeskCapital {
  startCapital: number | null;
  reservedMargin: number | null;
  realizedPnl: number | null;
  unrealizedPnl: number | null;
  netPnl: number | null;
  equity: number | null;
  available: number | null;
  openPositions: number;
}

export interface FuturesDeskPosition {
  id: string;
  tradeType: string;
  agentId: string | null;
  pair: string;
  side: 'LONG' | 'SHORT';
  openedAt: string;
  entryPrice: number | null;
  markPrice: number | null;
  grossMarkPnlApproxUsd: number | null;
  capitalUsed: number | null;
  notionalUsd: number | null;
  leverage: number | null;
  targetPrice: number | null;
  stopPrice: number | null;
  liquidationPrice: number | null;
}

export interface FuturesDeskSummaryRow {
  tradeType: string;
  closedTrades: number;
  wins: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number;
}

export interface FuturesDeskEntry {
  id: string;
  tradeType: string;
  agentId: string | null;
  pair: string;
  side: 'LONG' | 'SHORT';
  entryPrice: number | null;
  capitalUsed: number | null;
  leverage: number | null;
  openedAt: string;
  reason: string | null;
}

export interface FuturesDeskEquityPoint {
  ts: string;
  tradeId: string;
  pair: string;
  pnl: number;
  equity: number;
}

export interface FuturesDeskLifecycleEvent {
  id: string;
  tradeType: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  event: 'opened' | 'closed';
  eventAt: string;
  pnl: number | null;
  reason: string | null;
  status: string;
}

export interface FuturesDeskCycleResult {
  scanned: number;
  qualified: number;
  executed: number;
  skipped: number;
  blocked: boolean;
  startedAt?: string;
  completedAt?: string;
  profiles: Array<{
    profile: string;
    scanned: number;
    qualified: number;
    executed: number;
    skipped: number;
    blocked: boolean;
    blockReason: string | null;
    pairResults: Array<{
      pair: string;
      status: 'blocked' | 'skipped' | 'executed';
      reason: string;
      detail: string;
      side?: 'LONG' | 'SHORT';
      price?: number;
      economics?: {
        notionalUsd: number;
        slippagePct: number;
        feePct: number;
        fundingFeeUsd: number;
        expectedHoldingHours: number;
        targetPrice: number;
        stopPrice: number;
        tpNetUsd: number;
        slNetUsd: number;
        rewardRisk: number | null;
      };
    }>;
  }>;
}

export interface FuturesDeskToday {
  openCount: number;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number;
}

export interface FuturesDeskCycleHistoryRow {
  startedAt: string;
  completedAt: string;
  scanned: number;
  qualified: number;
  executed: number;
  skipped: number;
  blocked: boolean;
  profiles: Array<{
    profile: string;
    scanned: number;
    qualified: number;
    executed: number;
    skipped: number;
    blocked: boolean;
    blockReason: string | null;
  }>;
}

export interface FuturesDeskPairScore {
  pair: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number;
  profitFactor: number | null;
  firstOpenedAt: string | null;
  lastClosedAt: string | null;
}

export interface FuturesDeskProfileScore {
  tradeType: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  expectancy: number | null;
  profitFactor: number | null;
  maxDrawdown: number | null;
  rankScore: number | null;
  mode: 'learning' | 'degraded' | 'paused' | 'active';
  capitalMultiplier: number;
  leverageMultiplier: number;
  pairs: FuturesDeskPairScore[];
}

export interface FuturesGovernorJournalEntry {
  profileId: string;
  tradeType: string;
  mode: 'learning' | 'degraded' | 'paused' | 'active';
  reason: string;
  trades: number;
  winRate: number | null;
  totalPnl: number;
  capitalMultiplier: number;
  leverageMultiplier: number;
  at: string;
}

export interface FuturesLearningCohortRow {
  key: string;
  tradeType: string;
  pair: string;
  side: 'LONG' | 'SHORT';
  exitReason: string;
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  totalPnl: number;
  avgPnl: number;
  score: number | null;
}

export interface IntelligenceSupervisorCandidateSummary {
  id: string;
  source: string;
  style: string;
  score: number | null;
  providerScore: number | null;
  metrics: Record<string, number>;
  summary: string | null;
  critique: string[];
  missingTerms: string[];
  affectedProfiles: string[];
  leaderboard: Array<{
    candidate_id?: string;
    candidateId?: string;
    style?: string;
    score?: number;
    round?: number;
  }>;
}

export interface IntelligenceSupervisorMission {
  id: string;
  generatedAt: string;
  source: string;
  scope: string;
  targetObjective: string;
  constraints: string[];
  aggregate: {
    closedTrades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    totalPnl: number | null;
    avgPnl: number | null;
  };
}

export interface IntelligenceSupervisorRun {
  id: string;
  missionId: string;
  source: string;
  scope: string;
  status: 'draft' | 'recommended' | 'archived' | 'rejected' | 'degraded' | 'failed';
  advisoryOnly: boolean;
  providerStatus: 'ok' | 'unknown' | 'unavailable' | 'failed' | string;
  mission: IntelligenceSupervisorMission | null;
  candidateSummary: IntelligenceSupervisorCandidateSummary | null;
  recommendedPrompt: string | null;
  recommendedRules: string[];
  score: number | null;
  riskNotes: string[];
  justification: string[];
  proposedChanges: Array<{
    key: string;
    label: string;
    type: 'boolean' | 'number' | string;
    profileId: string | null;
    currentValue: boolean | number | null;
    proposedValue: boolean | number | null;
    reason: string;
  }>;
  artifacts: unknown;
  createdAt: string;
}

export interface IntelligenceAppliedPolicyState {
  active: boolean;
  sourceRunId: string | null;
  appliedAt: string | null;
  appliedBy: string | null;
  expiresAt: string | null;
  overrides: Array<{
    key: string;
    label: string;
    value: boolean | number | null;
  }>;
  latestApply: {
    id: string;
    scope: string;
    runId: string;
    status: string;
    appliedBy: string;
    appliedAt: string;
    expiresAt: string | null;
    overrides: Array<{
      key: string;
      label: string;
      type: 'boolean' | 'number' | string;
      profileId: string | null;
      currentValue: boolean | number | null;
      proposedValue: boolean | number | null;
      reason: string;
    }>;
  } | null;
  impact: {
    comparisonWindowHours: number | null;
    preWindow: {
      closedTrades: number;
      wins: number;
      losses: number;
      winRate: number | null;
      totalPnl: number | null;
      avgPnl: number | null;
    };
    postWindow: {
      closedTrades: number;
      wins: number;
      losses: number;
      winRate: number | null;
      totalPnl: number | null;
      avgPnl: number | null;
    };
    delta: {
      closedTrades: number;
      totalPnl: number | null;
      avgPnl: number | null;
      winRate: number | null;
    };
  } | null;
}

export interface IntelligenceSupervisorState {
  scope: string;
  latest: IntelligenceSupervisorRun | null;
  latestAttempt: IntelligenceSupervisorRun | null;
  appliedPolicy: IntelligenceAppliedPolicyState;
}

export interface FuturesDeskSnapshot {
  ok?: boolean;
  mode: 'status' | 'run';
  generatedAt: string;
  warnings?: Array<{ section: string; error: string; at: string }>;
  config: FuturesDeskConfig;
  cycle: FuturesDeskCycleResult | null;
  governorJournal: FuturesGovernorJournalEntry[];
  baseline: FuturesDeskBaseline | null;
  treasury: FuturesDeskTreasury;
  futuresCapital: FuturesDeskCapital;
  openPositions: FuturesDeskPosition[];
  closedSummary: FuturesDeskSummaryRow[];
  equityCurve: FuturesDeskEquityPoint[];
  recentLifecycle: FuturesDeskLifecycleEvent[];
  today: FuturesDeskToday;
  cycleHistory: FuturesDeskCycleHistoryRow[];
  profileScoreboard: FuturesDeskProfileScore[];
  learningCohorts: {
    strongest: FuturesLearningCohortRow[];
    weakest: FuturesLearningCohortRow[];
  };
  supervisor: IntelligenceSupervisorState;
  recentEntries: FuturesDeskEntry[];
}

export async function loadFuturesDesk(runCycle = false, timeoutMs = runCycle ? 35_000 : 5_000): Promise<FuturesDeskSnapshot | null> {
  try {
    const query = runCycle ? '?run=1' : '';
    const res = await fetch(apiUrl(`/api/crypto/futures-desk${query}`), {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean } & FuturesDeskSnapshot;
    return data;
  } catch { return null; }
}

export async function resetFuturesDeskBaseline(note = 'Manual futures PnL baseline reset'): Promise<FuturesDeskBaseline | null> {
  try {
    const res = await fetch(apiUrl('/api/crypto/futures-baseline/reset'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ resetBy: 'operator', note }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; baseline?: FuturesDeskBaseline };
    return data.ok ? (data.baseline ?? null) : null;
  } catch {
    return null;
  }
}

export async function loadIntelligenceSupervisorLatest(timeoutMs = 8_000): Promise<IntelligenceSupervisorState | null> {
  try {
    const res = await fetch(apiUrl('/api/intelligence/supervisor/latest'), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean } & IntelligenceSupervisorState;
    if (!data.ok) return null;
    return {
      scope: data.scope,
      latest: data.latest ?? null,
      latestAttempt: data.latestAttempt ?? null,
      appliedPolicy: data.appliedPolicy ?? {
        active: false,
        sourceRunId: null,
        appliedAt: null,
        appliedBy: null,
        expiresAt: null,
        overrides: [],
        latestApply: null,
        impact: null,
      },
    };
  } catch {
    return null;
  }
}

export async function runIntelligenceSupervisor(timeoutMs = 40_000): Promise<{ ok: boolean; state: IntelligenceSupervisorState | null; error?: string | null } | null> {
  try {
    const res = await fetch(apiUrl('/api/intelligence/supervisor/run'), {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ advisoryOnly: true }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json() as {
      ok: boolean;
      state?: IntelligenceSupervisorState | null;
      error?: string | null;
    };
    return {
      ok: Boolean(data.ok),
      state: data.state ?? null,
      error: data.error ?? null,
    };
  } catch {
    return null;
  }
}

export async function applyIntelligenceSupervisorRun(
  runId: string,
  timeoutMs = 15_000,
): Promise<{ ok: boolean; state: IntelligenceSupervisorState | null; error?: string | null } | null> {
  try {
    const res = await fetch(apiUrl(`/api/intelligence/supervisor/${runId}/apply`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ appliedBy: 'operator' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json() as {
      ok: boolean;
      state?: IntelligenceSupervisorState | null;
      error?: string | null;
    };
    return {
      ok: Boolean(data.ok),
      state: data.state ?? null,
      error: data.error ?? null,
    };
  } catch {
    return null;
  }
}

export async function rollbackIntelligenceSupervisor(
  timeoutMs = 15_000,
): Promise<{ ok: boolean; state: IntelligenceSupervisorState | null; error?: string | null } | null> {
  try {
    const res = await fetch(apiUrl('/api/intelligence/supervisor/rollback'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ appliedBy: 'operator', reason: 'manual rollback' }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json() as {
      ok: boolean;
      state?: IntelligenceSupervisorState | null;
      error?: string | null;
    };
    return {
      ok: Boolean(data.ok),
      state: data.state ?? null,
      error: data.error ?? null,
    };
  } catch {
    return null;
  }
}

// ─── AI Commentary ────────────────────────────────────────────────────────────

export interface CommentaryItem {
  id:       string;
  ts:       string;
  type:     string;   // SCANNING | ANALYZING | SIGNAL_FOUND | TRADE_REJECTED | ...
  text:     string;
  detail:   string;
  severity: string;
  source:   'deterministic' | 'llm';
}

export async function loadCommentary(limit = 40): Promise<CommentaryItem[]> {
  try {
    const res = await fetch(apiUrl(`/api/crypto/commentary?limit=${limit}`), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { ok: boolean; commentary: CommentaryItem[] };
    return data.commentary ?? [];
  } catch { return []; }
}

// ─── Market Intelligence ──────────────────────────────────────────────────────

export interface MarketIntel {
  momentum: 'Bullish' | 'Neutral' | 'Bearish';
  volatility: 'Low' | 'Medium' | 'High';
  trend: 'Strong' | 'Weak' | 'Mixed' | 'Unknown';
  regime: 'Scalp' | 'Swing' | 'Risk-Off';
  recommendation: 'LONG' | 'SHORT' | 'WATCH' | 'WAIT';
  confidence: { score: number; band: string };
  risk: { band: string; score: number; safeMode: boolean };
  activity: {
    signalsLast3h: number;
    longs: number;
    shorts: number;
    recentWinRate: number | null;
  };
}

export async function loadMarketIntelligence(): Promise<MarketIntel | null> {
  try {
    const res = await fetch(apiUrl('/api/crypto/market-intelligence'), {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<MarketIntel>;
  } catch { return null; }
}

// ─── Liquidity Matrix / Depth ─────────────────────────────────────────────────

export interface DepthLevel {
  price:  number;
  size:   number;
  pct:    number;    // 0–1, relative to max size on this side (bar width)
  isWall: boolean;   // size >= 4× average for this side
  isVoid: boolean;
}

export interface DepthSignals {
  buyPressure:      boolean;
  sellPressure:     boolean;
  sellWall:         boolean;
  bidWall:          boolean;
  thinLiquidity:    boolean;
  absorptionZone:   boolean;
  momentumBuilding: boolean;
}

export interface DepthData {
  pair:         string;
  midPrice:     number;
  spread:       number;
  spreadPct:    number;
  imbalance:    number;       // [-1, 1]
  imbalancePct: number;
  totalBidSize: number;
  totalAskSize: number;
  bids:         DepthLevel[]; // sorted DESC from mid (best bid = index 0)
  asks:         DepthLevel[]; // sorted ASC  from mid (best ask = index 0)
  reading:      string;
  readingColor: string;
  readingBg:    string;
  signals:      DepthSignals;
  fetchedAt:    string;
}

export async function loadDepth(pair = 'BTCUSDT', levels = 20): Promise<DepthData | null> {
  try {
    const res = await fetch(
      apiUrl(`/api/crypto/depth?pair=${pair}&levels=${levels}`),
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const json = await res.json() as { ok: boolean } & DepthData;
    if (!json.ok) return null;
    const { ok: _ok, ...depth } = json;
    return depth as DepthData;
  } catch { return null; }
}

export interface ProValidationTf {
  label: '15m' | '1h' | '4h' | string;
  trend: 'bullish' | 'bearish' | 'neutral' | 'unknown';
  verdict: 'confirm_long' | 'confirm_short' | 'mixed' | 'insufficient';
  ema9: number | null;
  ema21: number | null;
  rsi14: number | null;
  macdHistogram: number | null;
  price: number | null;
  changePct: number | null;
  score: number;
  notes: string[];
}

export interface ProValidation {
  pair: string;
  bias: 'LONG_BIAS' | 'SHORT_BIAS' | 'MIXED';
  action: 'validate_longs_only' | 'validate_shorts_only' | 'stand_aside';
  score: number;
  timeframes: ProValidationTf[];
  note: string;
  fetchedAt: string;
}

export async function loadProValidation(pair = 'BTCUSDT'): Promise<ProValidation | null> {
  try {
    const res = await fetch(
      apiUrl(`/api/crypto/pro-validation?pair=${pair}`),
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean } & ProValidation;
    if (!data.ok) return null;
    const { ok: _ok, ...validation } = data;
    return validation as ProValidation;
  } catch { return null; }
}

// ─── Trade Stories (chart storytelling overlay) ───────────────────────────────

export interface TradeStory {
  id:           string;
  pair:         string;
  side:         'LONG' | 'SHORT';
  agent_id?:    string | null;
  trade_type?:  string | null;
  capital_used?: number | null;
  leverage?:     number | null;
  entry_price:  number;
  exit_price:   number | null;
  target_price: number | null;
  stop_price:   number | null;
  pnl:          number | null;
  confidence:   number;          // 0–1
  reason:       string;
  evidence:     string[];
  exit_reason:  string | null;
  exit_kind:    'TP' | 'SL' | 'TIMEOUT' | 'CONFIDENCE' | 'EXIT' | null;
  opened_at:    string;
  closed_at:    string | null;
  status:       string;
}

export async function loadTradeStories(limit = 40, pair?: string): Promise<TradeStory[]> {
  try {
    const q = pair ? `?limit=${limit}&pair=${pair}` : `?limit=${limit}`;
    const res = await fetch(apiUrl(`/api/crypto/trades${q}`), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = await res.json() as { ok: boolean; trades: TradeStory[] };
    return data.trades ?? [];
  } catch { return []; }
}

// ─── Trading Co-Pilot ─────────────────────────────────────────────────────────

export interface CopilotAnalysis {
  pair: string;
  side: 'LONG' | 'SHORT';
  price: number;
  confidence: number;             // 0–100
  engineEndorsed: boolean;
  risk: { score: number; band: string; safeMode: boolean };
  tp: number; sl: number; tpPct: number; slPct: number;
  regime: string; momentum: string; volatility: string;
  evPct: number; evUsd: number; winProb: number;
  positive: string[];
  negative: string[];
  simulation: { pTP: number; pSL: number; pTimeout: number };
  safety: { blocked: boolean; reasons: string[] };
}

// ─── Execution Diagnostics (training telemetry) ───────────────────────────────

export interface LoopStatus {
  running: boolean;
  ticks: number;
  lastRun: string | null;
  errors: number;
  expectedMs: number;
}

export interface ScanAsset {
  symbol: string;
  price: number;
  rsi: number;
  action: 'TRADE' | 'WAIT';
  side: 'LONG' | 'SHORT' | null;
  confidence: number;     // 0–100 (after regime bias)
  rawConfidence?: number; // 0–100 (before regime bias)
  gate: number;           // 0–100
  score: number;
  signals: string[];
  missing: string[];      // human-readable missing confluences
  regime?: string;        // STRONG_BULL | BULL | RANGE | BEAR | STRONG_BEAR | HIGH_VOLATILITY
  bias?: number;          // confidence-point modifier applied (e.g. -20)
  reason: string;         // ACCEPTED | LOW_CONFIDENCE | REGIME_MISMATCH | LOW_VOLATILITY | NO_EDGE | POSITION_OPEN | ...
}

export interface RegimePerf {
  side: string;
  regime: string;
  trades: number;
  wins: number;
  pnl: number;
  winRate: number | null;
}

export interface SetupStat {
  key: string;
  side: string;
  regime: string;
  samples: number;
  winRate: number | null;
  expectancy: number;
  profitFactor: number | null;
  pnl: number;
  avgConfidence: number | null;
  reason?: string;
}

export interface BreakdownStat {
  key: string;
  samples: number;
  wins: number;
  totalPnl: number;
  winRate: number | null;
  expectancy: number;
  profitFactor: number | null;
  pair?: string;
  side?: string;
  regime?: string;
  hour?: string;
  confidenceBand?: string;
}

export interface CandidateAction {
  type: 'gate_side_regime' | 'gate_hour_bucket' | 'raise_confidence_floor' | 'gate_pair';
  priority: number;
  target: string;
  reason: string;
}

export interface ExecutionDiagnostics {
  loops: { scalping: LoopStatus; event: LoopStatus; swing: LoopStatus };
  gates: {
    scalp: { minConfidence: number; tpPct: number; slPct: number };
    swing: { minConfidence: number };
    event: { evThreshold: number; minConfidence: number };
  };
  training: {
    total: number; open: number; closed: number; wins?: number; winRate: number | null; totalPnl: number;
    bestEngine?: string | null; trainingDay?: number; confidenceAccuracy?: number | null;
  } | null;
  mode: string;
  recentScans: { ts: string; reason: string; subsystem: string }[];
  scanSnapshot: { at: string | null; assets: ScanAsset[] };
  regimePerformance?: RegimePerf[];
  autopsy?: {
    config: { minSamples: number; pfThreshold: number; windowDays: number };
    totalSamples: number;
    windowedSamples: number;
    vetoesActive: number;
    manualFilters: {
      setups: string[];
      hours: string[];
      confidenceBands: string[];
      pairs: string[];
    };
    manualFiltersActive: number;
    edgeSummary: {
      trades: number;
      winRate: number | null;
      expectancy: number;
      profitFactor: number | null;
      totalPnl: number;
      verdict: 'positive' | 'negative' | 'insufficient_data';
    };
    recommendation: {
      action: 'pause_or_redesign_strategy' | 'change_or_pause_strategy' | 'continue_training';
      severity: 'low' | 'medium' | 'high' | 'critical';
      thresholdTrades: number;
      triggered: boolean;
      reason: string;
    };
    breakdown: {
      byPair: BreakdownStat[];
      bySide: BreakdownStat[];
      byRegime: BreakdownStat[];
      byHour: BreakdownStat[];
      byConfidenceBand: BreakdownStat[];
    };
    candidateActions: CandidateAction[];
    setups: SetupStat[];
    topLosers: SetupStat[];
    topWinners: SetupStat[];
    vetoes: SetupStat[];
    nonMatureSetups: SetupStat[];
  } | null;
  llm?: {
    provider: string;
    usedByLiveScalp: boolean;
    usedByLegacyCryptoLoop: boolean;
    configured: boolean;
    available: boolean | null;
    fallbackActive: boolean | null;
    verification: 'verified' | 'unverified';
    lastProviderError: string | null;
    checkedAt: string | null;
    lastModel?: string | null;
    note?: string | null;
  };
}

export async function loadDiagnostics(): Promise<ExecutionDiagnostics | null> {
  try {
    const res = await fetch(apiUrl('/api/crypto/diagnostics'), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean } & ExecutionDiagnostics;
    return data.ok ? data : null;
  } catch { return null; }
}

export interface ShadowBucketStat {
  pair?: string;
  hour?: string;
  signalsSeen: number;
  wouldTradeCount: number;
  blockedCount: number;
}

export interface ShadowRecentSignal {
  ts: string;
  pair: string;
  side: 'LONG' | 'SHORT' | null;
  blocked: boolean;
  confidence: number | null;
  reasons: string[];
}

export interface ShadowCandidateDiagnostics {
  candidateId: string | null;
  running: boolean;
  pairSet: string[];
  signalsSeen: number;
  wouldTradeCount: number;
  blockedCount: number;
  byPair: ShadowBucketStat[];
  byHour: ShadowBucketStat[];
  recent: ShadowRecentSignal[];
}

export async function loadShadowCandidateDiagnostics(): Promise<ShadowCandidateDiagnostics | null> {
  try {
    const res = await fetch(apiUrl('/api/crypto/shadow-candidate'), { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean } & ShadowCandidateDiagnostics;
    return data.ok ? data : null;
  } catch { return null; }
}

// ─── Regime-switch Breakout Shadow (validated 4h strategy, live observation) ───

export interface BreakoutShadowMetrics {
  trades: number;
  winRate: number;
  netPnl: number;
  expectancy: number;
  profitFactor: number | null;
  maxDrawdown: number;
}

export interface BreakoutShadowPairStat {
  pair: string;
  trades: number;
  netPnl: number;
  winRate: number;
  profitFactor: number | null;
}

export interface BreakoutShadowCurrent {
  pair: string;
  price: number | null;
  sma: number | null;
  regime: 'bull' | 'bear' | 'range' | 'unknown';
  signalNow: 'LONG' | 'SHORT' | null;
  lastBarTime: number | null;
}

export interface BreakoutShadowRecent {
  pair: string;
  side: 'LONG' | 'SHORT';
  openTime: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  exitReason: string;
}

export interface BreakoutShadowDiagnostics {
  candidateId: string;
  mode: string;
  config: {
    pairs: string[]; interval: string; days: number;
    breakoutPeriod: number; regimeSmaPeriod: number;
    targetPct: number; stopPct: number; timeoutHours: number;
  };
  window: { from: string | null; to: string | null };
  combined: BreakoutShadowMetrics;
  short: BreakoutShadowMetrics;
  long: BreakoutShadowMetrics;
  byPair: BreakoutShadowPairStat[];
  current: BreakoutShadowCurrent[];
  recent: BreakoutShadowRecent[];
  note: string;
  evaluatedAt: string;
}

export async function loadBreakoutShadow(): Promise<BreakoutShadowDiagnostics | null> {
  try {
    const res = await fetch(apiUrl('/api/crypto/breakout-shadow'), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean } & BreakoutShadowDiagnostics;
    return data.ok ? data : null;
  } catch { return null; }
}

export async function analyzeCopilot(pair: string, side: 'LONG' | 'SHORT'): Promise<CopilotAnalysis | null> {
  try {
    const res = await fetch(apiUrl('/api/crypto/copilot'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pair, side }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; analysis: CopilotAnalysis };
    return data.ok ? data.analysis : null;
  } catch { return null; }
}
