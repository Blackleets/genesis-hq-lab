import { hasPostgres, query } from './postgres.js';

const DEFAULT_BALANCE = 100;

function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function limitValue(value, fallback = 50, max = 200) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

async function safeQuery(sql, params = []) {
  if (!hasPostgres()) return { ok: false, reason: 'Provider not configured', rows: [] };
  try {
    const res = await query(sql, params);
    return { ok: true, rows: res.rows };
  } catch (error) {
    const code = error?.code ?? '';
    if (code === '42P01' || /does not exist/i.test(error?.message ?? '')) {
      return { ok: false, reason: 'Provider not configured', rows: [] };
    }
    return { ok: false, reason: error?.message ?? 'solana_query_failed', rows: [] };
  }
}

export function solanaLimit(req, fallback = 50) {
  return limitValue(req.query?.limit, fallback);
}

export async function solanaStatus() {
  if (!hasPostgres()) {
    return {
      ok: true,
      connected: false,
      wsStatus: 'Provider not configured',
      subscribedTokens: 0,
      startedAt: null,
      paperBalance: DEFAULT_BALANCE,
      stats: { tradesOpened: 0, tradesClosed: 0 },
    };
  }

  const [tokens, trades, balance] = await Promise.all([
    safeQuery('SELECT COUNT(*)::int AS total, MAX(updated_at) AS last_seen FROM solana_tokens'),
    safeQuery(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'open')::int AS opened,
        COUNT(*) FILTER (WHERE status != 'open')::int AS closed
      FROM solana_paper_trades
    `),
    safeQuery("SELECT value FROM org_state WHERE key = 'solana_paper_balance' LIMIT 1"),
  ]);

  const total = n(tokens.rows[0]?.total);
  const tableReady = tokens.ok || trades.ok;
  const wsStatus = !tableReady
    ? 'Provider not configured'
    : total > 0
      ? `snapshot online | ${total} launches`
      : 'Pump.fun feed offline';

  return {
    ok: true,
    connected: total > 0,
    wsStatus,
    subscribedTokens: total,
    startedAt: tokens.rows[0]?.last_seen ?? null,
    paperBalance: n(balance.rows[0]?.value, DEFAULT_BALANCE),
    stats: {
      tradesOpened: n(trades.rows[0]?.opened),
      tradesClosed: n(trades.rows[0]?.closed),
    },
  };
}

export async function solanaTokens(limit = 50) {
  const res = await safeQuery(`
    SELECT
      mint,
      name,
      symbol,
      creator,
      created_ts AS "createdTs",
      market_cap_sol AS "marketCapSol",
      bonding_curve_pct AS "bondingCurvePct",
      last_price_sol AS "lastPriceSol",
      trade_count AS "tradeCount",
      unique_wallets AS "uniqueWallets",
      updated_at AS "updatedAt"
    FROM solana_tokens
    ORDER BY updated_at DESC
    LIMIT $1
  `, [limit]);
  return { ok: true, tokens: res.rows };
}

export async function solanaWallets(limit = 50) {
  const res = await safeQuery(`
    SELECT
      address,
      total_trades,
      wins,
      losses,
      total_volume_sol,
      avg_profit_x,
      score,
      label,
      last_active
    FROM solana_wallets
    ORDER BY score DESC, total_volume_sol DESC
    LIMIT $1
  `, [limit]);
  const total = await safeQuery('SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE score >= 65)::int AS smart FROM solana_wallets');
  return {
    ok: true,
    wallets: res.rows,
    summary: {
      total: n(total.rows[0]?.total),
      smart: n(total.rows[0]?.smart),
    },
  };
}

export async function solanaSignals(limit = 30) {
  const res = await safeQuery(`
    SELECT
      id,
      token_mint,
      token_symbol,
      signal_type,
      confidence,
      reason,
      wallet_count,
      risk_score,
      created_at,
      acted_on
    FROM solana_signals
    ORDER BY created_at DESC
    LIMIT $1
  `, [limit]);
  return { ok: true, signals: res.rows };
}

export async function solanaPaperPositions() {
  const res = await safeQuery(`
    SELECT *
    FROM solana_paper_trades
    WHERE status = 'open'
    ORDER BY opened_at DESC
  `);
  return { ok: true, positions: res.rows };
}

export async function solanaPaperTrades(limit = 50) {
  const res = await safeQuery(`
    SELECT *
    FROM solana_paper_trades
    WHERE status != 'open'
    ORDER BY closed_at DESC NULLS LAST, opened_at DESC
    LIMIT $1
  `, [limit]);
  return { ok: true, trades: res.rows };
}

export async function solanaPaperStats() {
  const [balance, closed, wins, open, pf, equity, recent] = await Promise.all([
    safeQuery("SELECT value FROM org_state WHERE key = 'solana_paper_balance' LIMIT 1"),
    safeQuery(`
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(pnl_sol), 0)::float8 AS total_pnl,
        COALESCE(AVG(pnl_sol), 0)::float8 AS avg_pnl,
        COALESCE(AVG(pnl_sol) FILTER (WHERE pnl_sol > 0), 0)::float8 AS avg_win,
        COALESCE(AVG(pnl_sol) FILTER (WHERE pnl_sol < 0), 0)::float8 AS avg_loss
      FROM solana_paper_trades WHERE status != 'open'
    `),
    safeQuery("SELECT COUNT(*)::int AS wins FROM solana_paper_trades WHERE pnl_sol > 0"),
    safeQuery("SELECT COUNT(*)::int AS open_positions, COALESCE(SUM(COALESCE(remaining_tokens, tokens) * COALESCE(current_price_sol, entry_price_sol)), 0)::float8 AS open_value FROM solana_paper_trades WHERE status = 'open'"),
    safeQuery(`
      SELECT
        COALESCE(SUM(pnl_sol) FILTER (WHERE pnl_sol > 0), 0)::float8 AS gross_wins,
        ABS(COALESCE(SUM(pnl_sol) FILTER (WHERE pnl_sol < 0), 0))::float8 AS gross_losses
      FROM solana_paper_trades WHERE status != 'open'
    `),
    safeQuery('SELECT total_sol FROM solana_equity_snapshots ORDER BY ts ASC LIMIT 500'),
    safeQuery("SELECT pnl_sol FROM solana_paper_trades WHERE status != 'open' ORDER BY closed_at DESC LIMIT 20"),
  ]);

  const bal = n(balance.rows[0]?.value, DEFAULT_BALANCE);
  const openValue = n(open.rows[0]?.open_value);
  const totalTrades = n(closed.rows[0]?.total);
  const winCount = n(wins.rows[0]?.wins);

  const grossWins = n(pf.rows[0]?.gross_wins);
  const grossLosses = n(pf.rows[0]?.gross_losses);
  const profitFactor = grossLosses > 0
    ? Math.round((grossWins / grossLosses) * 100) / 100
    : grossWins > 0 ? 9.99 : 0;

  let maxDrawdownPct = 0;
  if (equity.rows.length > 1) {
    let peak = -Infinity;
    for (const row of equity.rows) {
      const v = n(row.total_sol);
      if (v > peak) peak = v;
      if (peak > 0) {
        const dd = (peak - v) / peak * 100;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;
      }
    }
    maxDrawdownPct = Math.round(maxDrawdownPct * 10) / 10;
  }

  let streak = 0;
  const recentPnls = recent.rows.map(r => n(r.pnl_sol));
  if (recentPnls.length > 0) {
    const isWin = recentPnls[0] > 0;
    for (const pnl of recentPnls) {
      if ((pnl > 0) === isWin) streak++;
      else break;
    }
    if (!isWin) streak = -streak;
  }

  return {
    ok: true,
    balance: bal,
    openValue,
    totalSol: Math.round((bal + openValue) * 10000) / 10000,
    totalPnlSol: Math.round(n(closed.rows[0]?.total_pnl) * 10000) / 10000,
    totalTrades,
    wins: winCount,
    winRate: totalTrades > 0 ? Math.round((winCount / totalTrades) * 1000) / 10 : 0,
    avgPnlSol: Math.round(n(closed.rows[0]?.avg_pnl) * 10000) / 10000,
    avgWinSol: Math.round(n(closed.rows[0]?.avg_win) * 10000) / 10000,
    avgLossSol: Math.round(n(closed.rows[0]?.avg_loss) * 10000) / 10000,
    openPositions: n(open.rows[0]?.open_positions),
    liveMode: false,
    profitFactor,
    maxDrawdownPct,
    streak,
  };
}

export async function solanaEquityCurve(limit = 200) {
  const res = await safeQuery(`
    SELECT
      ts,
      balance_sol,
      open_value_sol,
      total_sol
    FROM solana_equity_snapshots
    ORDER BY ts DESC
    LIMIT $1
  `, [limit]);
  return { ok: true, curve: res.rows.reverse() };
}
