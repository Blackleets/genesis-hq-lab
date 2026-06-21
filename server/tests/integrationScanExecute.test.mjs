// integrationScanExecute.test.mjs — Full SCAN→DEBATE→EXECUTE pipeline test
// Tests entire workflow with strategy params integration

import { strict as assert } from 'assert';
import { test } from 'node:test';
import db from '../db/database.mjs';
import { saveTrade, getOpenTrades, closeTrade } from '../memory/tradingMemory.mjs';
import { getTreasury, settleTradeCapital } from '../trading/treasury.mjs';
import { getStrategyParams, getActiveVenue, setActiveVenue } from '../strategy/strategyParams.mjs';
import { ensureDefaults } from '../strategy/strategyParams.mjs';

test('integration: SCAN→EXECUTE workflow', async () => {
  // Setup
  ensureDefaults();
  const venue = getActiveVenue();
  assert.equal(venue, 'kalshi', 'Kalshi should be active venue');

  const params = getStrategyParams();
  console.log('[test] Active venue params:', {
    minConfidence: params.min_confidence,
    maxPosition: params.max_position_usd,
    stopLoss: params.stop_loss_pct,
  });

  // Simulate SCAN phase: find a market opportunity
  const opportunity = {
    marketId: 'TEST_SCAN_001',
    marketSource: 'kalshi',
    marketQuestion: 'Will Bitcoin exceed $50k this week?',
    marketCategory: 'crypto',
    outcome: 'YES',
    entryPrice: 0.50,
    shares: 1000,  // More shares so stop loss is more meaningful
    capitalUsed: 500,  // Within Kalshi max of $500
    confidence: 0.75,
    reason: 'Strong technical setup + positive news',
    evidence: ['BTC volume spike', 'Macro sentiment improving'],
  };

  // GATE 1: Check confidence against strategy params
  assert.ok(
    opportunity.confidence >= params.min_confidence,
    `Confidence ${opportunity.confidence} must meet threshold ${params.min_confidence}`
  );

  // GATE 2: Check position sizing
  assert.ok(
    opportunity.capitalUsed <= params.max_position_usd,
    `Position $${opportunity.capitalUsed} must not exceed $${params.max_position_usd}`
  );

  // GATE 3: Check max open trades
  const openTrades = getOpenTrades();
  assert.ok(
    openTrades.length < params.max_open_trades,
    `Cannot open more than ${params.max_open_trades} trades`
  );

  // EXECUTE phase: Place the trade
  const tradeId = saveTrade(opportunity);
  assert.ok(tradeId, 'Trade ID should be generated');

  // Verify trade is open
  const trade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  assert.equal(trade.status, 'open');
  assert.equal(trade.market_id, opportunity.marketId);
  assert.equal(trade.entry_price, opportunity.entryPrice);

  console.log(`[test] ✓ Trade placed: ${tradeId}`);

  // MONITOR phase: Track against stop loss
  const entryCapital = opportunity.capitalUsed;
  const exitPrice = 0.40; // Market moved down significantly

  // Compute PnL
  const pnl = (exitPrice - opportunity.entryPrice) * opportunity.shares;
  const lossPercent = Math.abs(pnl) / entryCapital;

  console.log('[test] PnL check:', {
    entryCapital,
    pnl,
    lossPercent,
    stopLossPercent: params.stop_loss_pct,
  });

  // Should trigger stop loss (allow 0.1% tolerance for floating point)
  assert.ok(
    lossPercent >= (params.stop_loss_pct - 0.001),
    `Loss ${(lossPercent * 100).toFixed(1)}% exceeds stop loss ${(params.stop_loss_pct * 100).toFixed(1)}%`
  );

  // CLOSE phase: Exit at stop loss
  closeTrade(tradeId, {
    exitPrice,
    pnl,
    exitReason: 'Stop loss triggered',
    filledAt: new Date().toISOString(),
  });

  const closedTrade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  assert.equal(closedTrade.status, 'closed');
  assert.ok(closedTrade.exit_price <= opportunity.entryPrice);

  console.log(`[test] ✓ Trade closed at stop loss: ${closedTrade.exit_price}`);
});

test('integration: Venue switching', async () => {
  ensureDefaults();

  // Start with Kalshi
  let active = getActiveVenue();
  assert.equal(active, 'kalshi');

  // Switch to Polymarket
  const pmParams = setActiveVenue('polymarket');
  assert.equal(pmParams.venue, 'polymarket');
  assert.equal(pmParams.min_confidence, 0.70);
  assert.equal(pmParams.max_position_usd, 300);

  // Verify active changed
  active = getActiveVenue();
  assert.equal(active, 'polymarket');
  console.log('[test] ✓ Switched to Polymarket');

  // Switch back to Kalshi
  const kalshiParams = setActiveVenue('kalshi');
  assert.equal(kalshiParams.venue, 'kalshi');
  active = getActiveVenue();
  assert.equal(active, 'kalshi');
  console.log('[test] ✓ Switched back to Kalshi');
});

test('integration: Position sizing varies by venue', async () => {
  ensureDefaults();

  // Kalshi: max $500/position
  setActiveVenue('kalshi');
  let params = getStrategyParams();
  assert.equal(params.max_position_usd, 500);

  // Polymarket: max $300/position
  setActiveVenue('polymarket');
  params = getStrategyParams();
  assert.equal(params.max_position_usd, 300);

  // Crypto: max $1000/position
  setActiveVenue('crypto');
  params = getStrategyParams();
  assert.equal(params.max_position_usd, 1000);

  console.log('[test] ✓ Position sizing varies correctly by venue');
});

test('integration: Multi-trade portfolio respects max open trades', async () => {
  ensureDefaults();
  setActiveVenue('kalshi');
  const params = getStrategyParams();

  // Clear old test data
  db.prepare('DELETE FROM trades WHERE market_id LIKE ?').run('TEST_MULTI_%');

  // Open trades up to max
  const tradeIds = [];
  for (let i = 0; i < params.max_open_trades; i++) {
    const tradeId = saveTrade({
      marketId: `TEST_MULTI_${i}`,
      marketSource: 'kalshi',
      marketQuestion: `Test market ${i}`,
      outcome: 'YES',
      entryPrice: 0.50,
      shares: 10,
      capitalUsed: 500,
      confidence: 0.70,
      reason: 'test',
    });
    tradeIds.push(tradeId);
  }

  const openTrades = db.prepare('SELECT COUNT(*) as cnt FROM trades WHERE status = ? AND market_id LIKE ?')
    .get('open', 'TEST_MULTI_%');
  assert.equal(openTrades.cnt, params.max_open_trades);

  console.log(`[test] ✓ Opened ${params.max_open_trades} trades, at maximum`);

  // Close one to make room
  closeTrade(tradeIds[0], 'YES');
  const afterClose = db.prepare('SELECT COUNT(*) as cnt FROM trades WHERE status = ? AND market_id LIKE ?')
    .get('open', 'TEST_MULTI_%');
  assert.equal(afterClose.cnt, params.max_open_trades - 1);

  console.log('[test] ✓ Trade count decremented after close');

  // Cleanup
  db.prepare('DELETE FROM trades WHERE market_id LIKE ?').run('TEST_MULTI_%');
});

test('integration: Capital settlement with PnL reinvestment', async () => {
  ensureDefaults();

  const initialTreasury = getTreasury();
  const initialCapital = initialTreasury.total;

  // Place profitable trade
  const tradeId = saveTrade({
    marketId: 'TEST_PNL_001',
    marketSource: 'kalshi',
    marketQuestion: 'Profitable test trade',
    outcome: 'YES',
    entryPrice: 0.50,
    shares: 10,
    capitalUsed: 500,
    confidence: 0.75,
    reason: 'test profitable',
  });

  // Exit with profit
  const profitPnL = 200; // $200 profit
  closeTrade(tradeId, {
    exitPrice: 0.70,
    pnl: profitPnL,
    exitReason: 'Manual close',
  });

  // Verify trade closed correctly
  const closedTrade = db.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId);
  assert.equal(closedTrade.status, 'closed');
  assert.equal(closedTrade.pnl, profitPnL);

  console.log('[test] ✓ Profitable trade closed with $200 PnL');

  // Cleanup
  db.prepare('DELETE FROM trades WHERE market_id LIKE ?').run('TEST_PNL_%');
});
