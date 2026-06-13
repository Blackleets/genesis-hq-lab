// paperEngine.mjs — Solana Alpha Paper Trading Engine.
//
// 100 SOL virtual balance. Completely isolated from global P&L.
// live_mode is ALWAYS false — no real execution path exists.

import { randomUUID } from 'node:crypto';
import db from '../db/database.mjs';
import { getState, broadcast } from './state.mjs';
import { logEvent, CATEGORY, SEVERITY } from '../observability/eventTimeline.mjs';

const LIVE_MODE = false;        // NEVER enable
const INITIAL_BALANCE = 100;   // SOL
const MAX_POSITION_SOL = 1;    // SOL per trade
const MAX_POSITIONS = 10;
const DEFAULT_SL = 0.10;       // -10%
const DEFAULT_TP1 = 0.25;      // +25% → sell 33%
const DEFAULT_TP2 = 0.50;      // +50% → sell 33%
const DEFAULT_TP3 = 1.00;      // +100% → sell remaining 34%
const TRAILING_STOP = 0.15;    // 15% from peak
const TRADE_EXPIRY_HOURS = 24;

// ── Balance management ───────────────────────────────────────────────────────

function loadBalance() {
  const row = db.prepare(`SELECT value FROM org_state WHERE key = 'solana_paper_balance'`).get();
  return row ? parseFloat(row.value) : INITIAL_BALANCE;
}

function saveBalance(sol) {
  db.prepare(`
    INSERT OR REPLACE INTO org_state (key, value, updated_at)
    VALUES ('solana_paper_balance', ?, datetime('now'))
  `).run(String(sol));
  getState().paperBalance = sol;
}

export function getPaperBalance() {
  return loadBalance();
}

export function resetPaperBalance() {
  saveBalance(INITIAL_BALANCE);
  db.prepare(`UPDATE solana_paper_trades SET status = 'reset', closed_at = datetime('now') WHERE status = 'open'`).run();
  _snapshotEquity();
  return { balance: INITIAL_BALANCE, message: 'Balance reset to 100 SOL' };
}

// ── Open position ────────────────────────────────────────────────────────────

/**
 * Open a paper long position.
 * @param {{ tokenMint, tokenSymbol, priceSol, sizeSol, signalReason, signalId }} opts
 */
export function openPaperPosition({ tokenMint, tokenSymbol = '???', priceSol, sizeSol, signalReason, signalId }) {
  if (LIVE_MODE) throw new Error('Live mode is disabled');
  if (!tokenMint || !priceSol || priceSol <= 0) return { ok: false, reason: 'invalid_params' };

  const balance = loadBalance();
  const openPositions = getOpenPaperPositions();

  if (openPositions.length >= MAX_POSITIONS) {
    return { ok: false, reason: 'max_positions_reached', openCount: openPositions.length };
  }
  if (openPositions.some(p => p.token_mint === tokenMint)) {
    return { ok: false, reason: 'position_already_open' };
  }

  const effectiveSize = Math.min(sizeSol ?? MAX_POSITION_SOL, MAX_POSITION_SOL, balance);
  if (effectiveSize < 0.01) {
    return { ok: false, reason: 'insufficient_balance', balance };
  }

  const tokens = effectiveSize / priceSol;
  const id = `spt_${randomUUID().slice(0, 12)}`;

  db.prepare(`
    INSERT INTO solana_paper_trades
      (id, token_mint, token_symbol, side, entry_price_sol, current_price_sol, size_sol, tokens,
       remaining_tokens, peak_price_sol, signal_reason)
    VALUES (?, ?, ?, 'LONG', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, tokenMint, tokenSymbol, priceSol, priceSol, effectiveSize, tokens, tokens, priceSol, signalReason ?? '');

  // Deduct from balance
  saveBalance(balance - effectiveSize);

  // Mark signal as acted on
  if (signalId) {
    db.prepare(`UPDATE solana_signals SET acted_on = 1, trade_id = ? WHERE id = ?`).run(id, signalId);
  }

  _snapshotEquity();
  logEvent({
    category: CATEGORY.EXECUTION,
    severity: SEVERITY.INFO,
    subsystem: 'solana-alpha-paper',
    reason: `PAPER OPEN LONG ${tokenSymbol} @ ${priceSol.toFixed(6)} SOL | size ${effectiveSize} SOL | id ${id}`,
    metadata: { tradeId: id, tokenMint, priceSol, effectiveSize },
  });

  broadcast({ type: 'solana:trade_opened', trade: getTradeById(id) });
  getState().stats.tradesOpened++;

  return { ok: true, tradeId: id, sizeSol: effectiveSize, tokens, entryPriceSol: priceSol };
}

// ── Tick: update prices + check exits ───────────────────────────────────────

/**
 * Called every 30s. Updates prices and checks TP/SL/trailing.
 * @param {Map<string, number>} priceMap  mint → current price in SOL
 */
export function tickPaperPositions(priceMap) {
  const positions = getOpenPaperPositions();
  if (positions.length === 0) return;

  const now = new Date().toISOString();

  for (const pos of positions) {
    const currentPrice = priceMap.get(pos.token_mint);
    if (!currentPrice || currentPrice <= 0) continue;

    // Update current price + peak
    const newPeak = Math.max(pos.peak_price_sol ?? pos.entry_price_sol, currentPrice);
    db.prepare(`UPDATE solana_paper_trades SET current_price_sol = ?, peak_price_sol = ? WHERE id = ?`)
      .run(currentPrice, newPeak, pos.id);

    const pricePct = (currentPrice - pos.entry_price_sol) / pos.entry_price_sol;

    // ── Partial TPs ────────────────────────────────────────────────────────
    let remaining = pos.remaining_tokens ?? pos.tokens;
    let realized = pos.realized_sol ?? 0;

    if (!pos.tp1_hit && pricePct >= DEFAULT_TP1) {
      const sellTokens = Math.min(remaining, pos.tokens * 0.33);
      const soldSol = sellTokens * currentPrice;
      remaining -= sellTokens;
      realized += soldSol;
      db.prepare(`UPDATE solana_paper_trades SET tp1_hit = 1, remaining_tokens = ?, realized_sol = ? WHERE id = ?`)
        .run(remaining, realized, pos.id);
      broadcast({ type: 'solana:tp_hit', tradeId: pos.id, level: 1, priceSol: currentPrice });
    }

    if (!pos.tp2_hit && pricePct >= DEFAULT_TP2) {
      const sellTokens = Math.min(remaining, pos.tokens * 0.33);
      const soldSol = sellTokens * currentPrice;
      remaining -= sellTokens;
      realized += soldSol;
      db.prepare(`UPDATE solana_paper_trades SET tp2_hit = 1, remaining_tokens = ?, realized_sol = ? WHERE id = ?`)
        .run(remaining, realized, pos.id);
      broadcast({ type: 'solana:tp_hit', tradeId: pos.id, level: 2, priceSol: currentPrice });
    }

    if (!pos.tp3_hit && pricePct >= DEFAULT_TP3) {
      const soldSol = remaining * currentPrice;
      realized += soldSol;
      _closeTrade(pos, currentPrice, 'take_profit_full', remaining, realized);
      continue;
    }

    // ── Stop Loss ─────────────────────────────────────────────────────────
    if (pricePct <= -DEFAULT_SL) {
      const soldSol = remaining * currentPrice;
      realized += soldSol;
      _closeTrade(pos, currentPrice, 'stop_loss', remaining, realized);
      continue;
    }

    // ── Trailing Stop ─────────────────────────────────────────────────────
    const dropFromPeak = (newPeak - currentPrice) / newPeak;
    if (dropFromPeak >= TRAILING_STOP && pricePct > 0) { // only trail if in profit
      const soldSol = remaining * currentPrice;
      realized += soldSol;
      _closeTrade(pos, currentPrice, 'trailing_stop', remaining, realized);
      continue;
    }

    // ── Timeout ────────────────────────────────────────────────────────────
    const ageHours = (Date.now() - new Date(pos.opened_at).getTime()) / 3_600_000;
    if (ageHours >= TRADE_EXPIRY_HOURS) {
      const soldSol = remaining * currentPrice;
      realized += soldSol;
      _closeTrade(pos, currentPrice, 'timeout', remaining, realized);
    }
  }
}

function _closeTrade(pos, exitPrice, reason, remainingTokens, realizedSol) {
  const totalIn = pos.size_sol;
  const totalOut = realizedSol;
  const pnlSol = totalOut - totalIn;
  const pnlPct = totalIn > 0 ? pnlSol / totalIn : 0;

  db.prepare(`
    UPDATE solana_paper_trades SET
      status = ?, exit_price_sol = ?, current_price_sol = ?,
      remaining_tokens = 0, realized_sol = ?,
      pnl_sol = ?, pnl_pct = ?, closed_at = datetime('now')
    WHERE id = ?
  `).run(`closed_${reason}`, exitPrice, exitPrice, totalOut, pnlSol, pnlPct, pos.id);

  // Return SOL to balance
  const currentBalance = loadBalance();
  saveBalance(currentBalance + totalOut);

  _snapshotEquity();

  logEvent({
    category: CATEGORY.EXECUTION,
    severity: SEVERITY.INFO,
    subsystem: 'solana-alpha-paper',
    reason: `PAPER CLOSE ${pos.token_symbol} @ ${exitPrice.toFixed(6)} SOL | reason ${reason} | PnL ${pnlSol >= 0 ? '+' : ''}${pnlSol.toFixed(4)} SOL (${(pnlPct * 100).toFixed(1)}%)`,
    metadata: { tradeId: pos.id, exitPrice, pnlSol, reason },
  });

  broadcast({ type: 'solana:trade_closed', tradeId: pos.id, pnlSol, pnlPct, reason });
  getState().stats.tradesClosed++;
}

function _snapshotEquity() {
  try {
    const balance = loadBalance();
    const openPositions = getOpenPaperPositions();
    const openValue = openPositions.reduce((sum, p) => {
      const price = p.current_price_sol ?? p.entry_price_sol;
      return sum + (p.remaining_tokens ?? p.tokens) * price;
    }, 0);
    db.prepare(`INSERT INTO solana_equity_snapshots (balance_sol, open_value_sol, total_sol) VALUES (?, ?, ?)`)
      .run(balance, openValue, balance + openValue);
  } catch { /* non-fatal */ }
}

// ── Queries ──────────────────────────────────────────────────────────────────

export function getOpenPaperPositions() {
  return db.prepare(`SELECT * FROM solana_paper_trades WHERE status = 'open' ORDER BY opened_at DESC`).all();
}

export function getClosedPaperTrades(limit = 50) {
  return db.prepare(`SELECT * FROM solana_paper_trades WHERE status != 'open' ORDER BY closed_at DESC LIMIT ?`).all(limit);
}

export function getTradeById(id) {
  return db.prepare(`SELECT * FROM solana_paper_trades WHERE id = ?`).get(id);
}

export function getPaperStats() {
  const balance = loadBalance();
  const closed = db.prepare(`SELECT COUNT(*) as n, SUM(pnl_sol) as totalPnl, AVG(pnl_sol) as avgPnl FROM solana_paper_trades WHERE status != 'open'`).get();
  const wins = db.prepare(`SELECT COUNT(*) as n FROM solana_paper_trades WHERE pnl_sol > 0`).get();
  const open = getOpenPaperPositions();
  const openValue = open.reduce((s, p) => s + (p.remaining_tokens ?? p.tokens) * (p.current_price_sol ?? p.entry_price_sol), 0);

  return {
    balance,
    openValue: Math.round(openValue * 10000) / 10000,
    totalSol: Math.round((balance + openValue) * 10000) / 10000,
    totalPnlSol: Math.round((closed.totalPnl ?? 0) * 10000) / 10000,
    totalTrades: closed.n ?? 0,
    wins: wins.n ?? 0,
    winRate: closed.n > 0 ? Math.round((wins.n / closed.n) * 1000) / 10 : 0,
    avgPnlSol: Math.round((closed.avgPnl ?? 0) * 10000) / 10000,
    openPositions: open.length,
    liveMode: LIVE_MODE,
  };
}

export function getEquityCurve(limit = 200) {
  return db.prepare(`SELECT * FROM solana_equity_snapshots ORDER BY ts DESC LIMIT ?`).all(limit).reverse();
}
