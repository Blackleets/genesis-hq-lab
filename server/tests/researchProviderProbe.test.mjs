import test from 'node:test';
import assert from 'node:assert/strict';
import { probeProvider } from '../genesis/researchProviderProbe.mjs';

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test('Bybit is usable only when every required research dimension is present', async () => {
  const fetchImpl = async url => {
    const list = url.includes('recent-trade') ? [{ time: '1', side: 'Buy' }]
      : url.includes('open-interest') ? [{ timestamp: '1', openInterest: '10' }]
      : url.includes('funding/history') ? [{ fundingRateTimestamp: '1', fundingRate: '0.0001' }]
      : [['1', '1', '1', '1', '1', '1']];
    return response({ retCode: 0, result: { list } });
  };
  const result = await probeProvider('bybit', { fetchImpl });
  assert.equal(result.researchOnly, true);
  assert.equal(result.symbol, 'BTCUSDT');
  assert.equal(result.usableForSynchronizedResearch, true);
  assert.deepEqual(result.availableDimensions.sort(), ['funding', 'oi', 'perp', 'spot', 'trades']);
});

test('provider HTTP/semantic failure cannot be presented as usable evidence', async () => {
  const fetchImpl = async url => {
    if (url.includes('open-interest')) return response({ retCode: 10001, result: { list: [] } });
    return response({ retCode: 0, result: { list: [{ ok: true }] } });
  };
  const result = await probeProvider('bybit', { fetchImpl });
  assert.equal(result.usableForSynchronizedResearch, false);
  assert.equal(result.checks.oi.ok, false);
  assert.equal(result.checks.oi.providerCode, 10001);
});

test('OKX requires code=0 plus non-empty data for each dimension', async () => {
  const fetchImpl = async () => response({ code: '0', data: [{ ts: '1' }] });
  const result = await probeProvider('okx', { fetchImpl });
  assert.equal(result.usableForSynchronizedResearch, true);
  assert.equal(result.availableDimensions.length, 5);
});

test('OKX probe uses the requested asset consistently across all routes', async () => {
  const urls = [];
  const fetchImpl = async url => {
    urls.push(url);
    return response({ code: '0', data: [{ ts: '1' }] });
  };
  const result = await probeProvider('okx', { fetchImpl, symbol: 'ETHUSDT' });
  assert.equal(result.symbol, 'ETHUSDT');
  assert.equal(result.usableForSynchronizedResearch, true);
  assert.ok(urls.some(url => url.includes('ETH-USDT-SWAP')));
  assert.ok(urls.some(url => url.includes('ETH-USDT&')));
  assert.equal(urls.some(url => url.includes('BTC-USDT')), false);
});

test('unsupported OKX research symbols fail closed before any request', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return response({ code: '0', data: [{}] }); };
  await assert.rejects(() => probeProvider('okx', { fetchImpl, symbol: 'DOGEUSDT' }), /Unsupported OKX research symbol/);
  assert.equal(calls, 0);
});
