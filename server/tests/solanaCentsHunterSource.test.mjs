import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../../supabase/functions/genesis-solana-mev-radar/index.ts', import.meta.url);

test('Cents Hunter v2 expands edge discovery while remaining paper-only', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /const ENGINE_VERSION = "edge_discovery_paper_v2"/);
  assert.match(source, /const MIN_CAPTURE_PNL_USD = 0\.01/);
  assert.match(source, /const NOTIONAL_GRID = \[10, 25, 50, 100, 250\]/);
  assert.match(source, /const QUOTE_CONCURRENCY = 1/);
  assert.match(source, /const DEXES_PER_RUN = 3/);
  assert.match(source, /symbol: "RAY"/);
  assert.match(source, /symbol: "PYTH"/);
  assert.match(source, /symbol: "POPCAT"/);
  assert.match(source, /for \(const notionalUsd of NOTIONAL_GRID\)/);
  assert.match(source, /for \(const buy of buyQuotes\) for \(const sellDex of activeDexes\) if \(sellDex !== buy\.dex\)/);
  assert.match(source, /requireLocalizedEvidence && grossPositive/);
  assert.match(source, /blockers\.push\("gross_not_positive"\)/);
  assert.match(source, /breakEvenGrossEdgeBps/);
  assert.match(source, /earlyRejectGrossNonPositive: true/);
  assert.match(source, /getRecentPrioritizationFees/);
  assert.match(source, /params: \[accounts\]/);
  assert.match(source, /localized: accounts\.length > 0/);
  assert.match(source, /centsCaptured: capturedNet >= MIN_CAPTURE_PNL_USD/);
  assert.match(source, /event\.centsCaptured === true/);
  assert.match(source, /executionAuthority: false/);
  assert.match(source, /liveLocked: true/);
  assert.doesNotMatch(source, /sendRawTransaction|sendTransaction|signTransaction/);
});
