import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../../supabase/functions/genesis-solana-mev-radar/index.ts', import.meta.url);

test('Cents Hunter is paper-only, route-local and requires a captured cent', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /const MIN_CAPTURE_PNL_USD = 0\.01/);
  assert.match(source, /const NOTIONAL_GRID = \[10, 25, 50, 100, 250\]/);
  assert.match(source, /const QUOTE_CONCURRENCY = 1/);
  assert.match(source, /const DEXES_PER_RUN = 3/);
  assert.match(source, /await sleep\(750\)/);
  assert.match(source, /const activeDexes = Array\.from/);
  assert.match(source, /getRecentPrioritizationFees/);
  assert.match(source, /params: \[accounts\]/);
  assert.match(source, /localized: accounts\.length > 0/);
  assert.match(source, /centsCaptured: capturedNet >= MIN_CAPTURE_PNL_USD/);
  assert.match(source, /event\.centsCaptured === true/);
  assert.match(source, /executionAuthority: false/);
  assert.match(source, /liveLocked: true/);
  assert.doesNotMatch(source, /sendRawTransaction|sendTransaction|signTransaction/);
});

test('Cents Hunter rejects single-route coverage before evaluating an edge', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /const TOP_BUYS = 2/);
  assert.match(source, /const MIN_VENUE_QUOTES_PER_DIRECTION = 2/);
  assert.match(source, /topBuys\.length < MIN_VENUE_QUOTES_PER_DIRECTION/);
  assert.match(source, /sellVenueQuotes >= MIN_VENUE_QUOTES_PER_DIRECTION/);
  assert.match(source, /reason: "venue_coverage_insufficient"/);
  assert.match(source, /persistCoverageInsufficient/);
});
