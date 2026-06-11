// decisionMemory.mjs — persistent memory for the Genesis Decision Council.
//
// Inspired by TradingAgents' append-only decision log with deferred
// reflection (memory.py / reflection.py), reimplemented natively on the
// Genesis SQLite layer:
//
//   1. Every council evaluation (approved OR rejected) is persisted.
//   2. Approved decisions are single-use tickets: the execution engine
//      consumes them atomically (consumeApprovedDecision) so a decision_id
//      can never authorize two trades, a stale ticket, or a different
//      symbol/side than the council reviewed.
//   3. When the trade closes, the outcome (net PnL, fees, exit reason,
//      whether the bull or bear case was right, a deterministic lesson)
//      is written back to the decision row — closing the loop the same
//      way TradingAgents' Phase B reflection does, but computed from real
//      trade data instead of an LLM call.
//   4. Performance queries (by strategy / symbol / regime / setup) feed
//      the Council's risk gates and the dashboard.
//
// Every number stored here comes from real trades; nothing is fabricated.

import db from '../db/database.mjs';
import { nanoid } from '../utils.mjs';

// How long an approved decision stays valid before execution must re-ask.
const DECISION_TTL_MS = parseInt(process.env.COUNCIL_DECISION_TTL_MS ?? '120000', 10);

// Setup-quality floors used by getBlockedSetups (and the Council's risk gate).
const MIN_SETUP_SAMPLES = parseInt(process.env.COUNCIL_MIN_SETUP_SAMPLES ?? '12', 10);
const MIN_PROFIT_FACTOR = parseFloat(process.env.COUNCIL_MIN_PF ?? '0.9');
const MIN_WIN_RATE = parseFloat(process.env.COUNCIL_MIN_WIN_RATE ?? '0.35');

db.exec(`
  CREATE TABLE IF NOT EXISTS council_decisions (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    symbol TEXT NOT NULL,
    asset_pair TEXT,
    strategy TEXT NOT NULL,
    trade_type TEXT,
    agent_id TEXT,
    side TEXT NOT NULL,
    entry REAL,
    stop_loss REAL,
    take_profit REAL,
    risk_reward REAL,
    position_size REAL,
    risk_usd REAL,
    fees_estimated REAL,
    spread_estimated REAL,
    slippage_estimated REAL,
    expected_value REAL,
    profit_factor REAL,
    win_rate REAL,
    confidence REAL,
    market_regime TEXT,
    technical_report TEXT,
    sentiment_report TEXT,
    bull_case TEXT,
    bear_case TEXT,
    trader_summary TEXT,
    risk_manager_verdict TEXT,
    portfolio_manager_verdict TEXT,
    final_decision TEXT NOT NULL,
    rejection_reason TEXT,
    lessons TEXT,
    consumed_at TEXT,
    trade_id TEXT,
    outcome_pnl REAL,
    outcome_fees REAL,
    outcome_exit_reason TEXT,
    bull_was_right INTEGER,
    bear_was_right INTEGER,
    lesson_learned TEXT,
    outcome_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_council_ts ON council_decisions(ts DESC);
  CREATE INDEX IF NOT EXISTS idx_council_final ON council_decisions(final_decision, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_council_trade ON council_decisions(trade_id);
  CREATE INDEX IF NOT EXISTS idx_council_strategy ON council_decisions(strategy, ts DESC);
`);

export function newDecisionId() {
  return `council-${nanoid()}`;
}

/** Persist a full council decision (approved or rejected). Returns the id. */
export function saveDecision(decision) {
  db.prepare(`
    INSERT INTO council_decisions (
      id, ts, symbol, asset_pair, strategy, trade_type, agent_id, side,
      entry, stop_loss, take_profit, risk_reward, position_size, risk_usd,
      fees_estimated, spread_estimated, slippage_estimated, expected_value,
      profit_factor, win_rate, confidence, market_regime,
      technical_report, sentiment_report, bull_case, bear_case, trader_summary,
      risk_manager_verdict, portfolio_manager_verdict, final_decision,
      rejection_reason, lessons
    ) VALUES (
      @id, @ts, @symbol, @asset_pair, @strategy, @trade_type, @agent_id, @side,
      @entry, @stop_loss, @take_profit, @risk_reward, @position_size, @risk_usd,
      @fees_estimated, @spread_estimated, @slippage_estimated, @expected_value,
      @profit_factor, @win_rate, @confidence, @market_regime,
      @technical_report, @sentiment_report, @bull_case, @bear_case, @trader_summary,
      @risk_manager_verdict, @portfolio_manager_verdict, @final_decision,
      @rejection_reason, @lessons
    )
  `).run({
    id: decision.decision_id,
    ts: decision.timestamp,
    symbol: decision.symbol,
    asset_pair: decision.asset_pair ?? null,
    strategy: decision.strategy,
    trade_type: decision.trade_type ?? null,
    agent_id: decision.agent_id ?? null,
    side: decision.side,
    entry: decision.entry ?? null,
    stop_loss: decision.stop_loss ?? null,
    take_profit: decision.take_profit ?? null,
    risk_reward: decision.risk_reward ?? null,
    position_size: decision.position_size ?? null,
    risk_usd: decision.risk_usd ?? null,
    fees_estimated: decision.fees_estimated ?? null,
    spread_estimated: decision.spread_estimated ?? null,
    slippage_estimated: decision.slippage_estimated ?? null,
    expected_value: decision.expected_value ?? null,
    profit_factor: decision.profit_factor ?? null,
    win_rate: decision.win_rate ?? null,
    confidence: decision.confidence ?? null,
    market_regime: decision.market_regime ?? null,
    technical_report: decision.technical_report ?? null,
    sentiment_report: decision.sentiment_report ?? null,
    bull_case: decision.bull_case ?? null,
    bear_case: decision.bear_case ?? null,
    trader_summary: decision.trader_summary ?? null,
    risk_manager_verdict: decision.risk_manager_verdict,
    portfolio_manager_verdict: decision.portfolio_manager_verdict,
    final_decision: decision.final_decision,
    rejection_reason: decision.rejection_reason ?? null,
    lessons: JSON.stringify(decision.lessons_from_similar_trades ?? []),
  });
  return decision.decision_id;
}

/**
 * Atomically consume an approved decision so it authorizes exactly one trade.
 * Validates: exists, approved, not yet consumed, fresh (TTL), and that the
 * pair/side/tradeType match what the council actually reviewed.
 * @returns {{ ok: boolean, reason?: string }}
 */
export function consumeApprovedDecision(decisionId, { pair, side, tradeType }) {
  if (!decisionId) return { ok: false, reason: 'missing_decision_id' };
  const row = db.prepare('SELECT * FROM council_decisions WHERE id = ?').get(decisionId);
  if (!row) return { ok: false, reason: 'unknown_decision_id' };
  if (row.final_decision !== 'approved') return { ok: false, reason: 'decision_not_approved' };
  if (row.consumed_at) return { ok: false, reason: 'decision_already_consumed' };
  const ageMs = Date.now() - new Date(row.ts).getTime();
  if (!(ageMs >= 0) || ageMs > DECISION_TTL_MS) return { ok: false, reason: 'decision_expired' };
  if (pair && row.asset_pair && row.asset_pair !== pair) return { ok: false, reason: 'pair_mismatch' };
  const wantSide = normalizeSide(side);
  if (wantSide && row.side !== wantSide) return { ok: false, reason: 'side_mismatch' };
  if (tradeType && row.trade_type && row.trade_type !== tradeType) return { ok: false, reason: 'trade_type_mismatch' };

  // Atomic claim: UPDATE only wins if nobody consumed it in between.
  const res = db.prepare(`
    UPDATE council_decisions SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL
  `).run(new Date().toISOString(), decisionId);
  if (res.changes !== 1) return { ok: false, reason: 'decision_already_consumed' };
  return { ok: true };
}

export function normalizeSide(side) {
  if (!side) return null;
  const s = String(side).toLowerCase();
  if (s === 'long' || s === 'yes' || s === 'buy') return 'long';
  if (s === 'short' || s === 'no' || s === 'sell') return 'short';
  if (s === 'no_trade') return 'no_trade';
  return s;
}

/** Link the executed trade back to its authorizing decision. */
export function attachTradeToDecision(decisionId, tradeId) {
  if (!decisionId || !tradeId) return;
  db.prepare('UPDATE council_decisions SET trade_id = ? WHERE id = ?').run(tradeId, decisionId);
}

// ── Outcome write-back (TradingAgents Phase B, computed not generated) ────────

/**
 * Record the real outcome of a closed trade on its council decision.
 * Lesson text is deterministic — built from real fields, never invented.
 * Safe to call for trades without a decision (no-op).
 */
export function recordDecisionOutcome(closedTrade) {
  const tradeId = closedTrade?.id ?? closedTrade?.tradeId;
  if (!tradeId) return null;
  const row = db.prepare('SELECT * FROM council_decisions WHERE trade_id = ?').get(tradeId);
  if (!row || row.outcome_at) return null;

  const pnl = closedTrade.pnl ?? null;
  const won = pnl != null && pnl > 0;
  const exitReason = closedTrade.exitReason ?? closedTrade.exit_reason ?? null;
  const fees = closedTrade.fees ?? closedTrade.fees_paid ?? null;

  // The bull case argued FOR this trade, the bear case AGAINST it.
  const bullWasRight = pnl == null ? null : (won ? 1 : 0);
  const bearWasRight = pnl == null ? null : (won ? 0 : 1);

  const lesson = pnl == null ? null : buildLesson(row, { pnl, won, exitReason });

  db.prepare(`
    UPDATE council_decisions
    SET outcome_pnl = ?, outcome_fees = ?, outcome_exit_reason = ?,
        bull_was_right = ?, bear_was_right = ?, lesson_learned = ?, outcome_at = ?
    WHERE id = ?
  `).run(pnl, fees, exitReason, bullWasRight, bearWasRight, lesson, new Date().toISOString(), row.id);

  return { decisionId: row.id, lesson };
}

function buildLesson(decisionRow, { pnl, won, exitReason }) {
  const setup = `${decisionRow.strategy} ${decisionRow.side} ${decisionRow.symbol}`
    + (decisionRow.market_regime ? ` in ${decisionRow.market_regime}` : '');
  const result = `${won ? 'won' : 'lost'} $${Math.abs(pnl).toFixed(2)}`
    + (exitReason ? ` via ${exitReason}` : '');
  const counterCase = won ? decisionRow.bull_case : decisionRow.bear_case;
  const firstPoint = counterCase ? counterCase.split('\n')[0].slice(0, 160) : null;
  const attribution = won
    ? (firstPoint ? ` — bull case held: ${firstPoint}` : '')
    : (firstPoint ? ` — bear case warned: ${firstPoint}` : '');
  return `${setup}: ${result}${attribution}`;
}

// ── Read paths for the Council and the dashboard ──────────────────────────────

export function getDecisionById(decisionId) {
  const row = db.prepare('SELECT * FROM council_decisions WHERE id = ?').get(decisionId);
  return row ? rowToDecision(row) : null;
}

export function getLatestDecision() {
  const row = db.prepare('SELECT * FROM council_decisions ORDER BY ts DESC LIMIT 1').get();
  return row ? rowToDecision(row) : null;
}

export function getRecentDecisions(limit = 20) {
  return db.prepare('SELECT * FROM council_decisions ORDER BY ts DESC LIMIT ?')
    .all(Math.min(Math.max(1, limit), 200))
    .map(rowToDecision);
}

/**
 * Lessons from similar resolved decisions (same strategy+side first, then
 * same symbol) — the Council injects these into new evaluations exactly like
 * TradingAgents' get_past_context (same-ticker + cross-ticker lessons).
 */
export function getLessonsForSimilarTrades({ symbol, strategy, side }, limit = 5) {
  const wantSide = normalizeSide(side);
  const rows = db.prepare(`
    SELECT lesson_learned FROM council_decisions
    WHERE lesson_learned IS NOT NULL
      AND (
        (strategy = @strategy AND side = @side)
        OR symbol = @symbol
      )
    ORDER BY outcome_at DESC
    LIMIT @limit
  `).all({ strategy, side: wantSide, symbol, limit });
  return rows.map((r) => r.lesson_learned);
}

/** Aggregate council performance grouped by strategy/symbol/regime/setup. */
export function getCouncilPerformance(groupBy = 'strategy') {
  const column = {
    strategy: 'strategy',
    symbol: 'symbol',
    market_regime: 'market_regime',
    setup: "strategy || ' ' || side || ' / ' || COALESCE(market_regime, 'UNKNOWN')",
  }[groupBy];
  if (!column) throw new Error(`unknown groupBy: ${groupBy}`);
  return db.prepare(`
    SELECT ${column} AS bucket,
           COUNT(*) AS samples,
           SUM(CASE WHEN outcome_pnl > 0 THEN 1 ELSE 0 END) AS wins,
           ROUND(SUM(outcome_pnl), 2) AS net_pnl,
           ROUND(SUM(CASE WHEN outcome_pnl > 0 THEN outcome_pnl ELSE 0 END), 2) AS gross_win,
           ROUND(SUM(CASE WHEN outcome_pnl < 0 THEN -outcome_pnl ELSE 0 END), 2) AS gross_loss,
           ROUND(AVG(expected_value), 3) AS avg_ev
    FROM council_decisions
    WHERE outcome_pnl IS NOT NULL
    GROUP BY bucket
    ORDER BY net_pnl DESC
  `).all().map((r) => ({
    bucket: r.bucket,
    samples: r.samples,
    winRate: r.samples ? Math.round((r.wins / r.samples) * 100) / 100 : null,
    profitFactor: r.gross_loss > 0
      ? Math.round((r.gross_win / r.gross_loss) * 100) / 100
      : (r.gross_win > 0 ? Infinity : 0),
    netPnl: r.net_pnl ?? 0,
    avgEv: r.avg_ev,
  }));
}

/** Setups whose resolved history breaks the quality floors (council-blocked). */
export function getBlockedSetups() {
  return getCouncilPerformance('setup').filter((s) =>
    s.samples >= MIN_SETUP_SAMPLES
    && (s.profitFactor < MIN_PROFIT_FACTOR || (s.winRate != null && s.winRate < MIN_WIN_RATE)));
}

/** Approval/rejection counts and top rejection reasons (for the dashboard). */
export function getCouncilStats() {
  const totals = db.prepare(`
    SELECT final_decision, COUNT(*) AS n FROM council_decisions GROUP BY final_decision
  `).all();
  const reasons = db.prepare(`
    SELECT rejection_reason, COUNT(*) AS n FROM council_decisions
    WHERE final_decision = 'rejected' AND rejection_reason IS NOT NULL
    GROUP BY rejection_reason ORDER BY n DESC LIMIT 10
  `).all();
  return {
    approved: totals.find((t) => t.final_decision === 'approved')?.n ?? 0,
    rejected: totals.find((t) => t.final_decision === 'rejected')?.n ?? 0,
    topRejectionReasons: reasons.map((r) => ({ reason: r.rejection_reason, count: r.n })),
  };
}

// ── Real trade-history reads (trades table — ground truth, not estimates) ────

/** Realized PnL (USD) across crypto trades closed today (UTC). */
export function getDailyRealizedPnlUsd() {
  const row = db.prepare(`
    SELECT SUM(pnl) AS pnl FROM trades
    WHERE status = 'closed' AND pnl IS NOT NULL
      AND market_category = 'crypto'
      AND closed_at >= date('now')
  `).get();
  return row?.pnl ?? 0;
}

/** Current consecutive-loss streak for a trade type (most recent backwards). */
export function getLossStreak(tradeType = null) {
  const rows = db.prepare(`
    SELECT pnl FROM trades
    WHERE status = 'closed' AND pnl IS NOT NULL
      ${tradeType ? 'AND trade_type = @tradeType' : "AND market_category = 'crypto'"}
    ORDER BY rowid DESC LIMIT 30
  `).all(tradeType ? { tradeType } : {});
  let streak = 0;
  for (const r of rows) {
    if (r.pnl < 0) streak++;
    else break;
  }
  return streak;
}

/** Most recent losing close for pair+tradeType (cooldown source). */
export function getLastLossAt(pair, tradeType) {
  const row = db.prepare(`
    SELECT closed_at FROM trades
    WHERE status = 'closed' AND pnl < 0 AND asset_pair = ? AND trade_type = ?
    ORDER BY rowid DESC LIMIT 1
  `).get(pair, tradeType);
  return row?.closed_at ?? null;
}

function rowToDecision(row) {
  return {
    decision_id: row.id,
    timestamp: row.ts,
    symbol: row.symbol,
    asset_pair: row.asset_pair,
    strategy: row.strategy,
    trade_type: row.trade_type,
    agent_id: row.agent_id,
    side: row.side,
    entry: row.entry,
    stop_loss: row.stop_loss,
    take_profit: row.take_profit,
    risk_reward: row.risk_reward,
    position_size: row.position_size,
    risk_usd: row.risk_usd,
    fees_estimated: row.fees_estimated,
    spread_estimated: row.spread_estimated,
    slippage_estimated: row.slippage_estimated,
    expected_value: row.expected_value,
    profit_factor: row.profit_factor,
    win_rate: row.win_rate,
    confidence: row.confidence,
    market_regime: row.market_regime,
    technical_report: row.technical_report,
    sentiment_report: row.sentiment_report,
    bull_case: row.bull_case,
    bear_case: row.bear_case,
    trader_summary: row.trader_summary,
    risk_manager_verdict: row.risk_manager_verdict,
    portfolio_manager_verdict: row.portfolio_manager_verdict,
    final_decision: row.final_decision,
    rejection_reason: row.rejection_reason ?? '',
    lessons_from_similar_trades: safeParseJson(row.lessons, []),
    consumed_at: row.consumed_at,
    trade_id: row.trade_id,
    outcome: row.outcome_at ? {
      pnl: row.outcome_pnl,
      fees: row.outcome_fees,
      exitReason: row.outcome_exit_reason,
      bullWasRight: row.bull_was_right === null ? null : row.bull_was_right === 1,
      bearWasRight: row.bear_was_right === null ? null : row.bear_was_right === 1,
      lesson: row.lesson_learned,
      recordedAt: row.outcome_at,
    } : null,
  };
}

function safeParseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
