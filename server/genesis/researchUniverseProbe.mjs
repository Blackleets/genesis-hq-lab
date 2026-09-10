// RESEARCH_ONLY admission gate for the multi-asset positioning universe.
// Public read-only data only. Missing dimensions exclude a symbol from research.

import fs from 'node:fs';
import path from 'node:path';
import { probeProvider } from './researchProviderProbe.mjs';

export const POSITIONING_UNIVERSE = Object.freeze(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']);

export async function runPositioningUniverseProbe({
  out,
  symbols = POSITIONING_UNIVERSE,
  provider = 'okx',
  probe = probeProvider,
} = {}) {
  const startedAt = new Date().toISOString();
  const entries = await Promise.all(symbols.map(async raw => {
    const symbol = String(raw || '').toUpperCase();
    try {
      const result = await probe(provider, { symbol });
      return [symbol, {
        symbol,
        provider,
        usableForSynchronizedResearch: result.usableForSynchronizedResearch === true,
        availableDimensions: result.availableDimensions ?? [],
        checks: result.checks ?? {},
        error: null,
      }];
    } catch (error) {
      return [symbol, {
        symbol,
        provider,
        usableForSynchronizedResearch: false,
        availableDimensions: [],
        checks: {},
        error: error instanceof Error ? error.message : String(error),
      }];
    }
  }));

  const results = Object.fromEntries(entries);
  const usableSymbols = Object.values(results)
    .filter(entry => entry.usableForSynchronizedResearch)
    .map(entry => entry.symbol);
  const excludedSymbols = Object.values(results)
    .filter(entry => !entry.usableForSynchronizedResearch)
    .map(entry => entry.symbol);

  const report = {
    schemaVersion: 1,
    mode: 'RESEARCH_ONLY',
    purpose: 'positioning_universe_admission_gate',
    provider,
    startedAt,
    completedAt: new Date().toISOString(),
    requiredDimensions: ['funding', 'oi', 'perp', 'spot', 'trades'],
    requestedSymbols: [...symbols],
    usableSymbols,
    excludedSymbols,
    results,
    policy: {
      missingDimensionExcludesSymbol: true,
      substitutionsAllowed: false,
      admissionDoesNotImplyEdge: true,
    },
    boundaries: {
      executionAuthority: false,
      liveTrading: false,
      realOrders: false,
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

if (process.argv[1]?.endsWith('researchUniverseProbe.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  runPositioningUniverseProbe({ out: valueAfter('--out') })
    .then(report => console.log(JSON.stringify(report, null, 2)))
    .catch(error => { console.error('ERROR:', error.message); process.exitCode = 1; });
}
