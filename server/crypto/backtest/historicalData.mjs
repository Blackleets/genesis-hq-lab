// historicalData.mjs — fetch & cache historical 1m klines from Binance.
// Paginates /klines (1000 per request) and caches to data/backtest/<pair>-<interval>.json
// with incremental refresh so repeated backtests don't hammer the API.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(__dir, '..', '..', '..', 'data', 'backtest');
const BINANCE = 'https://api.binance.com/api/v3';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function cachePath(pair, interval) {
  return join(CACHE_DIR, `${pair}-${interval}.json`);
}

function loadCache(pair, interval) {
  try {
    return JSON.parse(readFileSync(cachePath(pair, interval), 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(pair, interval, klines) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(cachePath(pair, interval), JSON.stringify({ pair, interval, klines, savedAt: new Date().toISOString() }));
}

/**
 * Return historical klines for the last `days`, fetching only what's missing.
 * @param {string} pair      e.g. 'BTCUSDT'
 * @param {{ days?: number, interval?: string }} opts
 * @returns {Promise<Array>} klines [openTime, open, high, low, close, volume, closeTime, quoteVolume, ...]
 */
export async function fetchKlines(pair, { days = 30, interval = '1m' } = {}) {
  const now = Date.now();
  const wantStart = now - days * 86_400_000;

  const cached = loadCache(pair, interval);
  let klines = cached?.klines ?? [];

  // If the cache doesn't reach far enough back, start fresh.
  if (klines.length && klines[0][0] > wantStart + 60_000) klines = [];

  let startTime = klines.length ? klines[klines.length - 1][0] + 1 : wantStart;

  while (startTime < now) {
    const url = `${BINANCE}/klines?symbol=${pair}&interval=${interval}&startTime=${startTime}&limit=1000`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Binance klines HTTP ${res.status} for ${pair}`);
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    klines.push(...batch);
    startTime = batch[batch.length - 1][0] + 1;
    if (batch.length < 1000) break;
    await sleep(150); // be polite to the public API
  }

  klines = klines.filter(c => c[0] >= wantStart);
  saveCache(pair, interval, klines);
  return klines;
}

export function isCached(pair, interval = '1m') {
  return existsSync(cachePath(pair, interval));
}
