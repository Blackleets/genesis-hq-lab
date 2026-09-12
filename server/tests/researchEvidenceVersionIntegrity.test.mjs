import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../../supabase/migrations/20260912120940_guard_strategy_validation_research_version.sql', import.meta.url),
  'utf8',
);

test('strategy validation snapshots reject mismatched research versions', () => {
  assert.match(migration, /guard_strategy_validation_research_version/);
  assert.match(migration, /research_version is distinct from new\.strategy_version_id/);
  assert.match(migration, /new\.walk_forward := null/);
  assert.match(migration, /new\.oos_evidence := null/);
  assert.match(migration, /before insert or update of strategy_version_id, walk_forward, oos_evidence/);
});

test('the evidence guard covers every futures profile family', () => {
  for (const profile of ['short_micro', 'short_core', 'short_alt', 'long_probe']) {
    assert.match(migration, new RegExp(`'${profile}'`));
  }
  assert.match(migration, /quant_research_evidence_v1/);
});

test('migration cleans already contaminated snapshots instead of rewriting verdicts', () => {
  assert.match(migration, /update public\.strategy_validation_snapshots/);
  assert.match(migration, /set walk_forward = null,\s*oos_evidence = null/);
  assert.doesNotMatch(migration, /set verdict\s*=/i);
});
