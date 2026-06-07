// serverSyntax.test.mjs — guards against syntax/load errors in server modules.
//
// `npm run build` only type-checks the frontend; server .mjs files are never
// validated by it. A duplicate import in index.mjs once crashed the backend on
// boot (SyntaxError) — the health check failed and the deploy silently kept the
// old build. This test runs `node --check` on every server module so that class
// of bug fails in CI instead of in production.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

function collectMjs(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'tests') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectMjs(full, acc);
    else if (entry.endsWith('.mjs')) acc.push(full);
  }
  return acc;
}

describe('server modules parse cleanly (node --check)', () => {
  const files = collectMjs(SERVER_DIR);

  it('finds server modules to check', () => {
    assert.ok(files.length > 10, `expected many server modules, found ${files.length}`);
  });

  for (const file of files) {
    const rel = file.slice(SERVER_DIR.length + 1).replace(/\\/g, '/');
    it(`parses ${rel}`, () => {
      assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
      }, `syntax error in ${rel}`);
    });
  }
});
