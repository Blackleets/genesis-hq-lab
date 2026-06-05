// strategyParams.mjs — single source of truth for the crypto scalping strategy
// parameters. Read by the LIVE engine (signal + targets) and WRITTEN by the
// optimizer ("training"). Persisted as JSON so the optimizer process and the
// agent process share one config across restarts.
//
// Unit conventions:
//   targetPct / stopPct / emaMarginPct  → fractions (0.015 = 1.5%)
//   momentumPct                         → PERCENT (0.2 = 0.2%, matches ctx.change1h)
//   rsi* bands                          → RSI points (0..100)

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = join(__dir, '..', '..', 'data', 'strategy', 'crypto_params.json');

// Safe defaults = the strategy as it shipped. The optimizer only moves off these
// when an out-of-sample backtest proves a better config.
export const DEFAULTS = Object.freeze({
  targetPct:    0.015,   // +1.5% take-profit
  stopPct:      0.0075,  // -0.75% stop-loss
  timeoutHours: 4,       // force-close after 4h
  emaMarginPct: 0.001,   // EMA9 vs EMA21 must separate by ≥0.1% to call a trend
  momentumPct:  0.2,     // |1h change| must be ≥0.2% (real move, not noise)
  rsiLongMin:   45,      // LONG only when RSI in [45, 68] — rising, not overbought
  rsiLongMax:   68,
  rsiShortMin:  32,      // SHORT only when RSI in [32, 55] — falling, not oversold
  rsiShortMax:  55,
  minVolume24h: 1_000_000,
});

const CACHE_TTL_MS = 30_000;
let _cache = null;        // { params, at }

function paramsPath() {
  return process.env.CRYPTO_PARAMS_PATH || DEFAULT_PATH;
}

/** Clear the in-memory cache (used by tests and right after saveParams). */
export function clearParamsCache() {
  _cache = null;
}

/** Current strategy params: saved file merged over DEFAULTS, with a short cache. */
export function getParams() {
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.params;

  let saved = {};
  try {
    const raw = readFileSync(paramsPath(), 'utf8');
    const parsed = JSON.parse(raw);
    saved = parsed?.params ?? parsed ?? {};
  } catch {
    saved = {}; // missing or corrupt → defaults
  }

  const params = { ...DEFAULTS, ...sanitize(saved) };
  _cache = { params, at: Date.now() };
  return params;
}

/** Only accept known numeric keys, so a bad file can't inject garbage. */
function sanitize(obj) {
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/** Persist params (merged over defaults) plus metadata about who/why. */
export function saveParams(params, meta = {}) {
  const merged = { ...DEFAULTS, ...sanitize(params) };
  const payload = {
    params: merged,
    meta,
    updatedAt: new Date().toISOString(),
  };
  mkdirSync(dirname(paramsPath()), { recursive: true });
  writeFileSync(paramsPath(), JSON.stringify(payload, null, 2), 'utf8');
  _cache = { params: merged, at: Date.now() };
  return merged;
}

/** Full saved payload (params + meta) for the UI; null if never saved. */
export function getParamsMeta() {
  try {
    return JSON.parse(readFileSync(paramsPath(), 'utf8'));
  } catch {
    return null;
  }
}
