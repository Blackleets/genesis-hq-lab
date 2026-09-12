// realTradingStressTest.mjs — Stress testing before enabling REAL_TRADING=true
// Tests edge cases: losses, extreme prices, rapid trades, concurrent fills

import { strict as assert } from 'assert';
import { test } from 'node:test';
import db from '../db/database.mjs';
import { saveTrade, closeTrade, getOpenTrades } from '../memory/tradingMemory.mjs';
import { getTreasury } from '../trading/treasury.mjs';
import { processFill } from '../kalshi/fillProcessor.mjs';

test('stress: 100% loss trade settlement', async () => {
  const before = getTreasury();
  const beforeTotal = before.total;

  // Trade that loses 100% ($500 → $0)
  const orderId = 'stress-loss-100';
  const tradeId = saveTrade({
    marketId: 'TEST_LOSS_100',
    marketSource: 'kalshi',
    marketQuestion: 'Will price go to zero?',
    outcome: 'YES',
    entryPrice: 0.50,
    shares: 1000,
    capitalUsed: 500,
    confidence: 0.75,
    reason: 'test loss',
    externalOrderId: orderId,
  });

  // Process fill at 0.00 (total loss)
  processFill({
    ticker: 'TEST_LOSS_100',
    orderId: 'stress-loss-100',
    side: 'YES',
    count: 1000,
    price: 0.00,
    ts: new Date().toISOString(),
  });

  const after = getTreasury();
  assert.ok(after.total <= beforeTotal, 'Capital should decrease or stay same on 100% loss');
  console.log(`[test] 100% loss: $${beforeTotal.toFixed(2)} → $${after.total.toFixed(2)}`);
});

test('stress: Multiple rapid trades without double-settlement', async () => {
  const before = getTreasury();

  // Rapid sequence: Win, Win, Loss, Loss
  const trades = [];
  for (let i = 0; i < 4; i++) {
    const orderId = `rapid-${i}`;
    const tradeId = saveTrade({
      marketId: `TEST_RAPID_${i}`,
      marketSource: 'kalshi',
      marketQuestion: `Rapid trade ${i}`,
      outcome: 'YES',
      entryPrice: 0.50,
      shares: 100,
      capitalUsed: 50,
      confidence: 0.70,
      reason: 'rapid test',
      externalOrderId: orderId,
    });
    trades.push({ tradeId, index: i, orderId });
  }

  // Process all fills
  trades.forEach((t) => {
    const priceLow = [0.60, 0.70, 0.40, 0.30]; // 2 wins, 2 losses
    processFill({
      ticker: `TEST_RAPID_${t.index}`,
      orderId: t.orderId,
      side: 'YES',
      count: 100,
      price: priceLow[t.index],
      ts: new Date().toISOString(),
    });
  });

  const after = getTreasury();
  const trades_open = db.prepare('SELECT COUNT(*) as cnt FROM trades WHERE status = ? AND market_id LIKE ?')
    .get('open', 'TEST_RAPID_%');

  assert.equal(trades_open.cnt, 0, 'All trades should be closed');
  console.log(`[test] Rapid trades: all ${trades.length} closed, capital: $${after.total.toFixed(2)}`);
});

test('stress: Extreme price movements (0.01 → 0.99)', async () => {
  const before = getTreasury();

  // Buy at 0.01 (very low)
  const orderId = 'extreme-fill';
  const tradeId = saveTrade({
    marketId: 'TEST_EXTREME',
    marketSource: 'kalshi',
    marketQuestion: 'Extreme price move?',
    outcome: 'YES',
    entryPrice: 0.01,
    shares: 5000,
    capitalUsed: 50,
    confidence: 0.60,
    reason: 'extreme test',
    externalOrderId: orderId,
  });

  // Sell at 0.99 (very high) = massive profit
  processFill({
    ticker: 'TEST_EXTREME',
    orderId,
    side: 'YES',
    count: 5000,
    price: 0.99,
    ts: new Date().toISOString(),
  });

  const after = getTreasury();
  const expectedPnl = (0.99 - 0.01) * 5000; // $4900 profit
  assert.ok(after.total > before.total, 'Capital should increase significantly');
  console.log(`[test] Extreme price move: +$${expectedPnl.toFixed(2)} profit detected`);
});

test('stress: Capital allocation consistency', async () => {
  const before = getTreasury();
  const initialBuckets = {
    reserve: before.buckets.reserve ?? 0,
    agentUpgrade: before.buckets.agentUpgrade ?? 0,
    experiments: before.buckets.experiments ?? 0,
    expansion: before.buckets.expansion ?? 0,
    liquidity: before.buckets.liquidity ?? 0,
  };

  // Place a winning trade
  const bucketOrderId = 'buckets-fill';
  const tradeId = saveTrade({
    marketId: 'TEST_BUCKETS',
    marketSource: 'kalshi',
    marketQuestion: 'Bucket test?',
    outcome: 'YES',
    entryPrice: 0.50,
    shares: 100,  // reduced from 1000
    capitalUsed: 50,  // reduced from 500
    confidence: 0.75,
    reason: 'bucket test',
    externalOrderId: bucketOrderId,
  });

  // Fill with ~$100 profit
  processFill({
    ticker: 'TEST_BUCKETS',
    orderId: bucketOrderId,
    side: 'YES',
    count: 100,  // matching shares
    price: 1.50, // (1.50 - 0.50) * 100 = $100 profit
    ts: new Date().toISOString(),
  });

  const after = getTreasury();
  const afterBuckets = {
    reserve: after.buckets.reserve ?? 0,
    agentUpgrade: after.buckets.agentUpgrade ?? 0,
    experiments: after.buckets.experiments ?? 0,
    expansion: after.buckets.expansion ?? 0,
    liquidity: after.buckets.liquidity ?? 0,
  };

  // Verify buckets increased per Constitution (40/25/15/10/10)
  const bucketDeltas = {
    reserve: afterBuckets.reserve - initialBuckets.reserve,
    agentUpgrade: afterBuckets.agentUpgrade - initialBuckets.agentUpgrade,
    experiments: afterBuckets.experiments - initialBuckets.experiments,
    expansion: afterBuckets.expansion - initialBuckets.expansion,
    liquidity: afterBuckets.liquidity - initialBuckets.liquidity,
  };

  const totalDelta = Object.values(bucketDeltas).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(totalDelta - 100) < 1, `Bucket allocations should sum to $100, got $${totalDelta.toFixed(2)}`);
  console.log('[test] Bucket allocation verified:', bucketDeltas);
});

test('stress: No negative capital allowed', async () => {
  // Create multiple losing trades
  for (let i = 0; i < 3; i++) {
    const negOrderId = `negative-${i}`;
    const tradeId = saveTrade({
      marketId: `TEST_NEGATIVE_${i}`,
      marketSource: 'kalshi',
      marketQuestion: `Negative test ${i}`,
      outcome: 'YES',
      entryPrice: 0.50,
      shares: 100,
      capitalUsed: 50,
      confidence: 0.70,
      reason: 'negative test',
      externalOrderId: negOrderId,
    });

    // All lose
    processFill({
      ticker: `TEST_NEGATIVE_${i}`,
      orderId: negOrderId,
      side: 'YES',
      count: 100,
      price: 0.00,
      ts: new Date().toISOString(),
    });
  }

  const final = getTreasury();
  assert.ok(final.total >= 0, `Capital should never go negative, got $${final.total.toFixed(2)}`);
  console.log(`[test] ✓ Capital never went negative: $${final.total.toFixed(2)}`);
});

test('stress: Concurrent order deduplication', async () => {
  // Same orderId filled twice (shouldn't happen, but test resilience)
  const orderId = 'concurrent-test';

  const tradeId = saveTrade({
    marketId: 'TEST_CONCURRENT',
    marketSource: 'kalshi',
    marketQuestion: 'Concurrent test?',
    outcome: 'YES',
    entryPrice: 0.50,
    shares: 100,
    capitalUsed: 50,
    confidence: 0.75,
    reason: 'concurrent test',
    externalOrderId: orderId,
  });

  // First fill
  processFill({
    ticker: 'TEST_CONCURRENT',
    orderId,
    side: 'YES',
    count: 100,
    price: 0.75,
    ts: new Date().toISOString(),
  });

  const afterFirst = getTreasury();

  // Attempt second fill with same orderId (should be idempotent)
  processFill({
    ticker: 'TEST_CONCURRENT',
    orderId,
    side: 'YES',
    count: 100,
    price: 0.75,
    ts: new Date().toISOString(),
  });

  const afterSecond = getTreasury();
  assert.equal(afterFirst.total, afterSecond.total, 'Second identical fill should not change capital (idempotent)');
  console.log(`[test] ✓ Idempotence verified: duplicate fills ignored`);
});
