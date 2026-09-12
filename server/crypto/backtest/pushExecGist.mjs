// pushExecGist.mjs — uploads data/executions.json to the live GitHub Gist so
// the public Vercel site (genesis-hq-lab.vercel.app) can show REAL bot activity.
// Uses `gh` (already authenticated on this machine). No secrets in this file.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..', '..');
const EXEC_FILE = join(REPO, 'data', 'executions.json');
const GIST_ID = (() => { try { return readFileSync(join(REPO, '.gist_id'), 'utf8').trim(); } catch { return ''; } })();

if (!GIST_ID) { console.error('No .gist_id found — cannot push'); process.exit(1); }
const content = readFileSync(EXEC_FILE, 'utf8');

// Build the PATCH body and pass it to `gh api` via stdin (--input -) to avoid
// shell-quoting issues with the JSON content.
const body = JSON.stringify({ files: { 'executions.json': { content } } });
try {
  const out = execFileSync('gh', ['api', `gists/${GIST_ID}`, '-X', 'PATCH', '--input', '-'], {
    encoding: 'utf8', input: body, maxBuffer: 10 * 1024 * 1024,
  });
  console.log(`[pushExecGist] pushed executions.json to gist ${GIST_ID} (${content.length} bytes)`);
} catch (e) {
  console.error('[pushExecGist] failed:', e.message);
  process.exit(1);
}
