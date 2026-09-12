// server/genesis/researchProviderProbe.mjs
// RESEARCH_ONLY availability probe for redundant public market-data routes.
// It validates access before any alternative venue is allowed into Genesis evidence.
// No credentials, orders, candidate promotion, REAL_TRADING changes, or audit-gate changes.

import fs from 'node:fs';
import path from 'node:path';
import { okxInstrumentIds } from './okxResearchContext.mjs';

const PROVIDERS = Object.freeze({
  bybit: {
    base: 'https://api.bybit.com',
    checks(symbol) {
      return {
        funding: `/v5/market/funding/history?category=linear&symbol=${symbol}&limit=3`,
        oi: `/v5/market/open-interest?category=linear&symbol=${symbol}&intervalTime=5min&limit=3`,
        perp: `/v5/market/kline?category=linear&symbol=${symbol}&interval=1&limit=3`,
        spot: `/v5/market/kline?category=spot&symbol=${symbol}&interval=1&limit=3`,
        trades: `/v5/market/recent-trade?category=linear&symbol=${symbol}&limit=10`,
      };
    },
  },
  okx: {
    base: 'https://www.okx.com',
    checks(symbol) {
      const { spot, perp } = okxInstrumentIds(symbol);
      return {
        funding: `/api/v5/public/funding-rate-history?instId=${perp}&limit=3`,
        oi: `/api/v5/public/open-interest?instType=SWAP&instId=${perp}`,
        perp: `/api/v5/market/candles?instId=${perp}&bar=1m&limit=3`,
        spot: `/api/v5/market/candles?instId=${spot}&bar=1m&limit=3`,
        trades: `/api/v5/market/trades?instId=${perp}&limit=10`,
      };
    },
  },
});

function semanticStatus(provider, payload) {
  if (provider === 'bybit') {
    return {
      ok: payload?.retCode === 0,
      code: payload?.retCode ?? null,
      count: Array.isArray(payload?.result?.list) ? payload.result.list.length : 0,
    };
  }
  if (provider === 'okx') {
    return {
      ok: String(payload?.code ?? '') === '0',
      code: payload?.code ?? null,
      count: Array.isArray(payload?.data) ? payload.data.length : 0,
    };
  }
  return { ok: false, code: 'unknown_provider', count: 0 };
}

async function requestJson(url, fetchImpl = fetch) {
  const started = Date.now();
  const response = await fetchImpl(url, {
    headers: { 'user-agent': 'genesis-hq-research-only/1.0' },
    signal: AbortSignal.timeout(15_000),
  });
  const latencyMs = Date.now() - started;
  let payload = null;
  try { payload = await response.json(); } catch { /* recorded below */ }
  return { httpOk: response.ok, status: response.status, latencyMs, payload };
}

export async function probeProvider(name, { fetchImpl = fetch, symbol = 'BTCUSDT' } = {}) {
  const definition = PROVIDERS[name];
  if (!definition) throw new Error(`unsupported provider: ${name}`);
  const upper = String(symbol || '').toUpperCase();
  const routes = definition.checks(upper);
  const checks = {};
  for (const [dimension, route] of Object.entries(routes)) {
    const url = `${definition.base}${route}`;
    try {
      const result = await requestJson(url, fetchImpl);
      const semantic = semanticStatus(name, result.payload);
      checks[dimension] = {
        ok: result.httpOk && semantic.ok && semantic.count > 0,
        httpStatus: result.status,
        providerCode: semantic.code,
        sampleCount: semantic.count,
        latencyMs: result.latencyMs,
        endpoint: route.split('?')[0],
      };
    } catch (error) {
      checks[dimension] = {
        ok: false,
        httpStatus: null,
        providerCode: null,
        sampleCount: 0,
        latencyMs: null,
        endpoint: route.split('?')[0],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  const availableDimensions = Object.entries(checks).filter(([, value]) => value.ok).map(([key]) => key);
  const required = ['funding', 'oi', 'perp', 'spot', 'trades'];
  return {
    provider: name,
    symbol: upper,
    researchOnly: true,
    usableForSynchronizedResearch: required.every(key => checks[key]?.ok === true),
    availableDimensions,
    checks,
  };
}

export async function runProviderProbe({ out, providers = ['bybit', 'okx'], symbol = 'BTCUSDT' } = {}) {
  const upper = String(symbol || '').toUpperCase();
  const startedAt = new Date().toISOString();
  const results = {};
  for (const provider of providers) results[provider] = await probeProvider(provider, { symbol: upper });
  const usableProviders = Object.values(results)
    .filter(result => result.usableForSynchronizedResearch)
    .map(result => result.provider);
  const report = {
    schemaVersion: 2,
    mode: 'RESEARCH_ONLY',
    purpose: 'validate_redundant_market_data_before_use',
    symbol: upper,
    startedAt,
    completedAt: new Date().toISOString(),
    dimensions: ['funding', 'oi', 'perp', 'spot', 'trades'],
    usableProviders,
    results,
    authority: {
      execution: false,
      liveTrading: false,
      candidatePromotion: false,
      holdoutRanking: false,
    },
  };
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && process.argv[1].endsWith('researchProviderProbe.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  runProviderProbe({ out: valueAfter('--out'), symbol: valueAfter('--symbol') || 'BTCUSDT' })
    .then(report => {
      console.log(JSON.stringify(report, null, 2));
      if (!report.usableProviders.length) process.exitCode = 2;
    })
    .catch(error => { console.error('ERROR:', error.message); process.exitCode = 1; });
}
