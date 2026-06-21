// kalshiE2E.test.mjs — End-to-end test for Kalshi real trading flow
// SCAN → DEBATE → EXECUTE → FILL → CLOSE → LEARN

import { strict as assert } from 'assert';
import { test } from 'node:test';
import db from '../db/database.mjs';
import { saveTrade, closeTrade, getOpenTrades } from '../memory/tradingMemory.mjs';
import { settleTradeCapital, getTreasury } from '../trading/treasury.mjs';
import { processFill, processPosition } from '../kalshi/fillProcessor.mjs';

test('Kalshi E2E: place order → receive fill → close trade → settle capital', async (t) => {
  // 1. SETUP: Clear any prior test data
  db.prepare('DELETE FROM trades WHERE market_source = ? AND market_id LIKE ?')
    .run('kalshi', 'TEST_%');

  const initialCapital = getTreasury().total;
  console.log(`[test] Initial capital: $${initialCapital.toFixed(2)}`);

  // 2. PLACE ORDER (simulating executeTrade for Kalshi)
  const kalshiOrderId = 'test-order-' + Date.now();
  const tradeId = saveTrade({
    marketId: 'TEST_ELECTION_2026',
    marketSource: 'kalshi',
    marketQuestion: 'Will X win the 2026 election?',
    marketCategory: 'politics',
    outcome: 'YES',
    outcomeChoice: 'YES',
    entryPrice: 0.55,            // Kalshi prices are 0-1
    shares: 10,
    capitalUsed: 550,
    confidence: 0.75,
    reason: 'Test: strong polling data',
    evidence: ['Poll A: 60%', 'Poll B: 65%'],
    // agentId omitted — will default to 'market-agent-1'
    externalOrderId: kalshiOrderId,
    tradeType: 'real',
    mode: 'real',
    openedAt: new Date().toISOString(),
  });

  console.log(`[test] Placed trade: ${tradeId}, Kalshi order: ${kalshiOrderId}`);

  // 3. VERIFY trade is open
  const openTrades = getOpenTrades();
  const trade = openTrades.find(t => t.id === tradeId);
  assert.ok(trade, 'Trade should be open');
  assert.equal(trade.external_order_id, kalshiOrderId, 'Order ID should be linked');
  assert.equal(trade.status, 'open', 'Status should be open');
  console.log(`[test] ✓ Trade open: ${JSON.stringify({id: trade.id, shares: trade.shares, entry: trade.entry_price})}`);

  // 4. SIMULATE KALSHI FILL (WS event)
  const fillEvent = {
    ticker: 'TEST_ELECTION_2026',
    orderId: kalshiOrderId,
    side: 'YES',
    count: 10,
    price: 0.72,                 // Filled at 0.72 (profitable!)
    ts: new Date().toISOString(),
  };

  console.log(`[test] Simulating fill: ${JSON.stringify(fillEvent)}`);
  processFill(fillEvent);

  // 5. VERIFY trade is closed
  const closedTrade = db.prepare(
    'SELECT * FROM trades WHERE id = ?'
  ).get(tradeId);

  assert.equal(closedTrade.status, 'closed', 'Trade should be closed after fill');
  assert.ok(closedTrade.exit_price, 'Exit price should be set');
  assert.ok(
    Math.abs(closedTrade.exit_price - 0.72) < 0.001,
    'Exit price should match fill price'
  );
  console.log(`[test] ✓ Trade closed: exit_price=${closedTrade.exit_price.toFixed(4)}`);

  // 6. VERIFY PnL calculation
  // Entry: 550 (capital_used), Exit: 0.72 * 100 * 10 = 720
  // PnL = 720 - 550 = 170
  const expectedPnL = 720 - 550;
  assert.ok(closedTrade.pnl, 'PnL should be computed');
  assert.ok(
    Math.abs(closedTrade.pnl - expectedPnL) < 10,
    `PnL should be ~${expectedPnL} (got ${closedTrade.pnl})`
  );
  console.log(`[test] ✓ PnL computed: $${closedTrade.pnl.toFixed(2)} (expected ~$${expectedPnL})`);

  // 7. VERIFY capital settled
  const newTreasury = getTreasury();
  const expectedNewCapital = initialCapital + closedTrade.pnl;
  assert.ok(
    Math.abs(newTreasury.total - expectedNewCapital) < 10,
    `Capital should increase by PnL (got ${newTreasury.total}, expected ~${expectedNewCapital})`
  );
  console.log(`[test] ✓ Capital settled: $${newTreasury.total.toFixed(2)} (was $${initialCapital.toFixed(2)})`);

  // 8. POSITION UPDATE validation
  const positionEvent = {
    ticker: 'TEST_ELECTION_2026',
    position: 0,                  // Position closed to 0
    value: 0,
  };
  console.log(`[test] Processing position update (closed): ${JSON.stringify(positionEvent)}`);
  processPosition(positionEvent);

  console.log(`[test] ✅ E2E TEST PASSED`);
});
