// versioningMiddleware.test.mjs — API versioning tests

import { strict as assert } from 'assert';
import { test } from 'node:test';
import {
  parseApiVersion,
  getDeprecationStatus,
  adaptStrategyParamsV1toV2,
  formatVersionedResponse,
  logApiUsage,
} from '../api/versioningMiddleware.mjs';

test('versioning: parseApiVersion from Accept-Version header', () => {
  const req = { headers: { 'accept-version': 'v2' } };
  assert.equal(parseApiVersion(req), 2);

  const req1 = { headers: { 'accept-version': '1.0.0' } };
  assert.equal(parseApiVersion(req1), 1);
});

test('versioning: parseApiVersion from URL path', () => {
  const req = { url: '/v2/strategy' };
  assert.equal(parseApiVersion(req), 2);

  const req1 = { url: '/v1/capital' };
  assert.equal(parseApiVersion(req1), 1);
});

test('versioning: parseApiVersion defaults to v2', () => {
  const req = { url: '/strategy', headers: {} };
  assert.equal(parseApiVersion(req), 2);
});

test('versioning: getDeprecationStatus reports deprecated features', () => {
  const status = getDeprecationStatus('hardcoded_params', 2);
  assert.ok(status.deprecated);
  assert.ok(status.replacement);
  assert.ok(status.sunsetAt);
  console.log('[test] Deprecation status:', status);
});

test('versioning: getDeprecationStatus returns false for unknown features', () => {
  const status = getDeprecationStatus('future_feature_xyz', 2);
  assert.equal(status.deprecated, false);
});

test('versioning: adaptStrategyParamsV1toV2 converts legacy params', () => {
  const v1 = {
    minConfidence: 0.70,
    maxPosition: 400,
    stopLoss: 0.25,
    daysToHold: 30,
  };

  const v2 = adaptStrategyParamsV1toV2(v1);
  assert.equal(v2.min_confidence, 0.70);
  assert.equal(v2.max_position_usd, 400);
  assert.equal(v2.stop_loss_pct, 0.25);
  assert.equal(v2.max_hold_days, 30);
  console.log('[test] Adapted v1→v2:', v2);
});

test('versioning: adaptStrategyParamsV1toV2 applies defaults', () => {
  const v1 = { venue: 'kalshi' };
  const v2 = adaptStrategyParamsV1toV2(v1);

  assert.equal(v2.min_confidence, 0.65); // default
  assert.equal(v2.max_position_usd, 500); // default
  assert.equal(v2.stop_loss_pct, 0.20);  // default
});

test('versioning: formatVersionedResponse adds metadata', () => {
  const data = { capital: 10000, trades: 5 };
  const response = formatVersionedResponse(data, 2);

  assert.equal(response.ok, true);
  assert.equal(response.apiVersion, 2);
  assert.ok(response.buildDate);
  assert.deepEqual(response.data, data);
  console.log('[test] Formatted response:', response);
});

test('versioning: logApiUsage records requests', () => {
  const log = logApiUsage(2, '/strategy', 200);
  assert.equal(log.apiVersion, 2);
  assert.equal(log.endpoint, '/strategy');
  assert.equal(log.statusCode, 200);
  assert.ok(log.timestamp);
});
