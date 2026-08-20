// pushExecGist.mjs — uploads data/executions.json to the live GitHub Gist so
// the public Vercel site (genesis-hq-lab.vercel.app) can show REAL bot activity.
// Uses `gh` (already authenticated on this machine). No secrets in this file.
// Run: node server/crypto/backtest/pushExecGist.mjs
import { readFileSync, readFileSync as rf } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dir, '..', '..', '..');
const EXEC_FILE = join(REPO, 'data', 'executions.json');
const GIST_ID = (() => { try { return readFileSync(join(REPO, '.gist_id'), 'utf8').trim(); } catch { return ''; } })();

if (!GIST_ID) { console.error('No .gist_id found — cannot push'); process.exit(1); }
const content = readFileSync(EXEC_FILE, 'utf8');

// GitHub gist file content must be base64 for the REST API.
const b64 = Buffer.from(content, 'utf8').toString('base64');
const body = JSON.stringify({ files: { 'executions.json': { content } } });

try {
  const out = execFileSync('gh', ['api', `gists/${GIST_ID}`, '-X', 'PATCH', '-f', `files[executions.json][content]=${content}`], { encoding: 'utf8' });
  console.log(`[pushExecGist] pushed executions.json to gist ${GIST_ID} (${content.length} bytes)`);
} catch (e) {
  console.error('[pushExecGist] failed:', e.message);
  process.exit(1);
}
