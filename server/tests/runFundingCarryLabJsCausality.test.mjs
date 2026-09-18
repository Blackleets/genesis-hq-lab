import test from 'node:test';
import assert from 'node:assert/strict';
import {
  spotRowsFromKlines,
  nearestSpot,
  align,
} from '../genesis/runFundingCarryLab.mjs';

test('spot close becomes eligible only at kline close time', () => {
  const openMs = 1_700_000_000_000;
  const closeMs = openMs + 3_599_999;
  const rows = spotRowsFromKlines([
    [String(openMs), '100', '110', '90', '105', '1', String(closeMs)],
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].t, closeMs);
  assert.equal(rows[0].close, 105);
  assert.equal(nearestSpot(rows, openMs), null);
  assert.equal(nearestSpot(rows, closeMs), 105);
});

test('missing or invalid close timestamp fails closed', () => {
  const openMs = 1_700_000_000_000;
  assert.deepEqual(
    spotRowsFromKlines([[String(openMs), '100', '110', '90', '105']]),
    [],
  );
  assert.deepEqual(
    spotRowsFromKlines([[String(openMs), '100', '110', '90', '105', '1', String(openMs)]]),
    [],
  );
});

test('align cannot use the current candle close before that close is observable', () => {
  const hour = 60 * 60 * 1000;
  const firstOpen = 1_700_000_000_000;
  const firstClose = firstOpen + hour - 1;
  const secondOpen = firstOpen + hour;
  const secondClose = secondOpen + hour - 1;

  const spots = spotRowsFromKlines([
    [String(firstOpen), '100', '101', '99', '100', '1', String(firstClose)],
    [String(secondOpen), '100', '120', '80', '110', '1', String(secondClose)],
  ]);

  const fundingTime = secondOpen + 5 * 60 * 1000;
  const funding = [{
    t: fundingTime,
    rate: 0.0001,
    rateBps: 1,
    perp: 100,
  }];

  const rows = align(funding, spots);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spot, 100);
  assert.notEqual(rows[0].spot, 110);
});

test('align accepts the newer close once its information timestamp has passed', () => {
  const hour = 60 * 60 * 1000;
  const firstOpen = 1_700_000_000_000;
  const firstClose = firstOpen + hour - 1;
  const secondOpen = firstOpen + hour;
  const secondClose = secondOpen + hour - 1;

  const spots = spotRowsFromKlines([
    [String(firstOpen), '100', '101', '99', '100', '1', String(firstClose)],
    [String(secondOpen), '100', '120', '80', '110', '1', String(secondClose)],
  ]);

  const funding = [{
    t: secondClose,
    rate: 0.0001,
    rateBps: 1,
    perp: 100,
  }];

  const rows = align(funding, spots);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spot, 110);
});
