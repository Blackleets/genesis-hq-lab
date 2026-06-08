import db from '../db/database.mjs';

export const CRYPTO_TRADE_TYPES = ['crypto_scalp', 'scalp_v2', 'swing_v1'];
export const MODERN_CRYPTO_TRADE_TYPES = ['scalp_v2', 'swing_v1'];
export const CRYPTO_TRADE_TYPES_SQL = `('${CRYPTO_TRADE_TYPES.join("','")}')`;
export const MODERN_CRYPTO_TRADE_TYPES_SQL = `('${MODERN_CRYPTO_TRADE_TYPES.join("','")}')`;
export const PREDICTION_ONLY_SQL = `COALESCE(trade_type, 'prediction') NOT IN ${CRYPTO_TRADE_TYPES_SQL}`;

function round2(n) {
  return n == null ? null : Math.round(n * 100) / 100;
}

function rate(num, denom) {
  return denom > 0 ? num / denom : null;
}

function buildWindowClause(column, windowDays) {
  return windowDays != null ? ` AND ${column} > datetime('now', ?)` : '';
}

function buildClosedWhere(windowDays = null) {
  return `trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status='closed' AND pnl IS NOT NULL${buildWindowClause('closed_at', windowDays)}`;
}

function buildOpenWhere() {
  return `trade_type IN ${CRYPTO_TRADE_TYPES_SQL} AND status='open'`;
}

export function getClosedCryptoWhere(windowDays = null) {
  return buildClosedWhere(windowDays);
}

export function getOpenCryptoWhere() {
  return buildOpenWhere();
}

export function getPredictionOnlyWhere() {
  return PREDICTION_ONLY_SQL;
}

export function computeEdgeVerdict({ trades, expectancy, profitFactor }) {
  if ((trades ?? 0) < 1) return 'insufficient_data';
  return (expectancy ?? 0) > 0 && (profitFactor ?? 0) > 1 ? 'positive' : 'negative';
}

export function getClosedCryptoMetrics({ windowDays = null } = {}) {
  const where = buildClosedWhere(windowDays);
  const params = windowDays != null ? [`-${windowDays} days`] : [];
  const row = db.prepare(`
    SELECT
      COUNT(*) AS trades,
      SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) AS losses,
      COALESCE(SUM(pnl), 0) AS total_pnl,
      COALESCE(SUM(CASE WHEN pnl > 0 THEN pnl ELSE 0 END), 0) AS gross_profit,
      COALESCE(ABS(SUM(CASE WHEN pnl < 0 THEN pnl ELSE 0 END)), 0) AS gross_loss,
      COALESCE(MAX(pnl), 0) AS best_trade,
      COALESCE(MIN(pnl), 0) AS worst_trade,
      COALESCE(AVG(pnl), 0) AS avg_pnl,
      COALESCE(SUM(capital_used), 0) AS total_risked
    FROM trades
    WHERE ${where}
  `).get(...params);

  const trades = row?.trades ?? 0;
  const wins = row?.wins ?? 0;
  const losses = row?.losses ?? 0;
  const totalPnl = row?.total_pnl ?? 0;
  const grossProfit = row?.gross_profit ?? 0;
  const grossLoss = row?.gross_loss ?? 0;
  const expectancy = row?.avg_pnl ?? 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  return {
    trades,
    wins,
    losses,
    winRate: rate(wins, trades),
    expectancy: round2(expectancy),
    avgPnl: round2(expectancy),
    totalPnl: round2(totalPnl),
    grossProfit: round2(grossProfit),
    grossLoss: round2(grossLoss),
    profitFactor: profitFactor === Infinity ? Infinity : round2(profitFactor),
    bestTrade: round2(row?.best_trade ?? 0),
    worstTrade: round2(row?.worst_trade ?? 0),
    totalRisked: round2(row?.total_risked ?? 0),
    roi: rate(totalPnl, row?.total_risked ?? 0),
    verdict: computeEdgeVerdict({ trades, expectancy, profitFactor }),
  };
}

export function getCryptoTradeCounts() {
  const total = db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE trade_type IN ${CRYPTO_TRADE_TYPES_SQL}`).get()?.n ?? 0;
  const open = db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE ${buildOpenWhere()}`).get()?.n ?? 0;
  const closed = db.prepare(`SELECT COUNT(*) AS n FROM trades WHERE ${buildClosedWhere()}`).get()?.n ?? 0;
  return { total, open, closed };
}

export function getClosedCryptoConfidenceRows(limit = 50) {
  return db.prepare(`
    SELECT confidence, CASE WHEN pnl > 0 THEN 1 ELSE 0 END AS won
    FROM trades
    WHERE ${buildClosedWhere()} AND confidence IS NOT NULL
    ORDER BY closed_at DESC LIMIT ?
  `).all(limit);
}
