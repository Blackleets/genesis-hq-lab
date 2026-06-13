// walletTracker.mjs — Smart Money identification and scoring.
// Tracks wallets from PumpPortal trade events. No external API needed.

import db from '../db/database.mjs';
import { updateWallet } from './state.mjs';

// Track pending positions per wallet (in-memory, confirmed on SELL)
const _walletPositions = new Map(); // address:mint → { entryPriceSol, sizeSol, bondingCurveAtEntry }

/**
 * Process a trade event from PumpPortal.
 * @param {{ traderPublicKey, mint, txType, solAmount, tokenAmount, marketCapSol, bondingCurveKey, vSolInBondingCurve, vTokensInBondingCurve }} trade
 */
export function processWalletTrade(trade) {
  const {
    traderPublicKey: address,
    mint,
    txType,       // 'buy' | 'sell'
    solAmount,
    tokenAmount,
    marketCapSol,
  } = trade;

  if (!address || !mint || !txType) return;

  const posKey = `${address}:${mint}`;

  if (txType === 'buy') {
    _walletPositions.set(posKey, {
      entryPriceSol: tokenAmount > 0 ? solAmount / tokenAmount : 0,
      sizeSol: solAmount,
      marketCapAtEntry: marketCapSol ?? 0,
      entryTs: Date.now(),
    });
    _upsertWallet(address, { totalTrades: 1, volume: solAmount });

  } else if (txType === 'sell') {
    const entry = _walletPositions.get(posKey);
    if (entry) {
      const exitPriceSol = tokenAmount > 0 ? solAmount / tokenAmount : 0;
      const profitX = entry.entryPriceSol > 0 ? exitPriceSol / entry.entryPriceSol : 1;
      const won = profitX > 1.1;
      _upsertWallet(address, {
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        profitX,
        volume: solAmount,
        marketCapAtEntry: entry.marketCapAtEntry,
      });
      _walletPositions.delete(posKey);
    } else {
      _upsertWallet(address, { totalTrades: 1, volume: solAmount });
    }
  }
}

function _upsertWallet(address, delta) {
  try {
    const existing = db.prepare(`SELECT * FROM solana_wallets WHERE address = ?`).get(address);
    if (!existing) {
      db.prepare(`
        INSERT INTO solana_wallets (address, total_trades, wins, losses, total_volume_sol)
        VALUES (?, ?, ?, ?, ?)
      `).run(address, 1, delta.wins ?? 0, delta.losses ?? 0, delta.volume ?? 0);
    } else {
      const wins = existing.wins + (delta.wins ?? 0);
      const losses = existing.losses + (delta.losses ?? 0);
      const total = existing.total_trades + (delta.totalTrades ?? (wins + losses > 0 ? 1 : 0));
      const vol = existing.total_volume_sol + (delta.volume ?? 0);

      // Weighted average profit
      let avgProfitX = existing.avg_profit_x;
      if (delta.profitX != null) {
        const n = wins + losses;
        avgProfitX = n > 0 ? ((existing.avg_profit_x * (n - 1)) + delta.profitX) / n : delta.profitX;
      }

      const score = _computeScore({ wins, total, avgProfitX });

      db.prepare(`
        UPDATE solana_wallets SET
          total_trades = ?, wins = ?, losses = ?,
          total_volume_sol = ?, avg_profit_x = ?,
          score = ?, last_active = datetime('now'),
          label = ?
        WHERE address = ?
      `).run(total, wins, losses, vol, avgProfitX, score, _label(score), address);

      updateWallet(address, { score, wins, losses, totalTrades: total, avgProfitX, label: _label(score) });
    }
  } catch (err) {
    // Non-fatal: wallet tracking is best-effort
    console.error('[walletTracker] upsert error:', err.message);
  }
}

function _computeScore({ wins, total, avgProfitX }) {
  if (total < 3) return 40; // insufficient data
  const winRate = wins / total;
  const base = winRate * 50;               // 0-50 from win rate
  const profitBonus = Math.min(30, (avgProfitX - 1) * 15); // 0-30 from avg profit
  const sampleBonus = Math.min(20, total * 2); // 0-20 from sample size
  return Math.round(Math.min(100, Math.max(0, base + profitBonus + sampleBonus)));
}

function _label(score) {
  if (score >= 75) return 'smart_money';
  if (score >= 55) return 'skilled';
  if (score >= 40) return 'average';
  return 'weak';
}

export function getSmartMoneyWallets(minScore = 65, limit = 20) {
  return db.prepare(`
    SELECT * FROM solana_wallets
    WHERE score >= ? AND total_trades >= 3
    ORDER BY score DESC, total_volume_sol DESC
    LIMIT ?
  `).all(minScore, limit);
}

export function getWalletSummary() {
  const total = db.prepare(`SELECT COUNT(*) as n FROM solana_wallets`).get()?.n ?? 0;
  const smart = db.prepare(`SELECT COUNT(*) as n FROM solana_wallets WHERE score >= 65`).get()?.n ?? 0;
  return { total, smart };
}
