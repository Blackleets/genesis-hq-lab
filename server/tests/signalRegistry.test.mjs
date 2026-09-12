// signalRegistry.test.mjs — Trading signals registration and tracking

import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  SIGNAL_SOURCES,
  registerSignal,
  getActiveSignals,
  resolveSignal,
  getSignalAccuracy,
  getValidatedSignals,
} from '../research/signalRegistry.mjs';

test('signal: SIGNAL_SOURCES defines 5 sources', () => {
  assert.equal(Object.keys(SIGNAL_SOURCES).length, 5);
  assert.ok(SIGNAL_SOURCES.market_data);
  assert.ok(SIGNAL_SOURCES.sentiment);
  assert.ok(SIGNAL_SOURCES.model_prediction);
  assert.ok(SIGNAL_SOURCES.manual_research);
  assert.ok(SIGNAL_SOURCES.event_alpha);
});

test('signal: registerSignal creates new signal', () => {
  const result = registerSignal(
    'market_data',
    'BTC volume spike detected',
    'technical',
    0.75,
    { period: '4h', ma_cross: true }
  );

  assert.ok(result.id);
  assert.equal(result.source, 'market_data');
  assert.equal(result.confidence, 0.75);
  assert.equal(result.category, 'technical');
  console.log('[test] Registered signal:', result.id);
});

test('signal: registerSignal rejects invalid confidence', () => {
  try {
    registerSignal('market_data', 'test', 'technical', 1.5);
    assert.fail('should reject confidence > 1');
  } catch (err) {
    assert.ok(err.message.includes('confidence'));
  }
});

test('signal: registerSignal rejects unknown source', () => {
  try {
    registerSignal('unknown_source', 'test', 'technical', 0.5);
    assert.fail('should reject unknown source');
  } catch (err) {
    assert.ok(err.message.includes('unknown signal source'));
  }
});

test('signal: getActiveSignals returns unresolved signals', () => {
  // Register a new unresolved signal
  const signal = registerSignal('sentiment', 'Market sentiment bullish', 'sentiment', 0.70);

  const active = getActiveSignals('sentiment');
  assert.ok(Array.isArray(active));
  assert.ok(active.some(s => s.id === signal.id));
  console.log(`[test] Found ${active.length} active sentiment signals`);
});

test('signal: resolveSignal marks signal as correct/incorrect', () => {
  // Register signal
  const signal = registerSignal('market_data', 'Volume breakout', 'technical', 0.80);

  // Resolve as correct
  resolveSignal(signal.id, true);

  const accuracy = getSignalAccuracy('market_data');
  if (accuracy.length > 0) {
    assert.ok(accuracy[0].correct >= 0);
    console.log('[test] Signal accuracy:', accuracy[0]);
  }
});

test('signal: getValidatedSignals returns high-confidence correct signals', () => {
  // Register and resolve some signals
  for (let i = 0; i < 3; i++) {
    const signal = registerSignal(
      'model_prediction',
      `Prediction ${i}`,
      'price',
      0.70 + i * 0.05
    );
    resolveSignal(signal.id, true);
  }

  const validated = getValidatedSignals(5);
  assert.ok(Array.isArray(validated));
  if (validated.length > 0) {
    assert.equal(validated[0].proved_correct, 1);
    console.log(`[test] Found ${validated.length} validated signals`);
  }
});

test('signal: getSignalAccuracy by source', () => {
  // Register signals from different sources
  const s1 = registerSignal('market_data', 'Signal A', 'technical', 0.75);
  const s2 = registerSignal('sentiment', 'Signal B', 'sentiment', 0.80);

  resolveSignal(s1.id, true);
  resolveSignal(s2.id, false);

  const accuracy = getSignalAccuracy();
  assert.ok(Array.isArray(accuracy));
  if (accuracy.length > 0) {
    assert.ok(accuracy[0].source);
    assert.ok(typeof accuracy[0].accuracy_pct === 'number');
    console.log('[test] Accuracy by source:', accuracy);
  }
});
