import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const charter = fs.readFileSync(new URL('../../docs/EDGE_DISCOVERY_ENGINE.md', import.meta.url), 'utf8');

test('edge discovery charter preserves execution and live safety boundaries', () => {
  assert.match(charter, /executionAuthority=false/);
  assert.match(charter, /LIVE_LOCKED/);
  assert.match(charter, /PAPER shadow/i);
  assert.match(charter, /NO EDGE/);
  assert.match(charter, /NO TRADE/);
});

test('edge discovery requires anti-overfit evidence gates', () => {
  for (const term of ['validation', 'walk-forward', 'sealed final holdout', 'Multiple-testing']) {
    assert.match(charter.toLowerCase(), new RegExp(term.toLowerCase()));
  }
});
