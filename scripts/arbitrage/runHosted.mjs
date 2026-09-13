import { writeFile } from 'node:fs/promises';
import { runResilientMevShadowWorker } from '../../server/genesis/mevResilientWorker.mjs';
import { buildHostedSnapshot } from './hostedSnapshot.mjs';

const repo = 'Blackleets/genesis-hq-lab';
const branch = 'data/arbitrage-observations';
const path = 'data/arbitrage-radar.json';
const headers = {
  accept: 'application/vnd.github+json',
  authorization: `Bearer ${process.env.GITHUB_TOKEN ?? ''}`,
  'content-type': 'application/json',
};
const endpoint = `https://api.github.com/repos/${repo}/contents/${path}`;
const oldResponse = await fetch(`${endpoint}?ref=${encodeURIComponent(branch)}`, { headers, signal: AbortSignal.timeout(10000) });
if (!oldResponse.ok && oldResponse.status !== 404) throw new Error(`evidence_read_${oldResponse.status}`);
const oldFile = oldResponse.ok ? await oldResponse.json() : null;
const previous = oldFile ? JSON.parse(Buffer.from(oldFile.content, 'base64').toString('utf8')) : null;
let result;
try {
  result = await runResilientMevShadowWorker({ once: true });
} catch {
  result = { ok: false }; // Never publish provider exception strings.
}
const snapshot = buildHostedSnapshot(result, previous);
await writeFile('arbitrage-snapshot.json', JSON.stringify(snapshot, null, 2));
const response = await fetch(endpoint, {
  method: 'PUT', headers, signal: AbortSignal.timeout(15000),
  body: JSON.stringify({
    message: 'chore: record periodic arbitrage evidence', branch,
    ...(oldFile ? { sha: oldFile.sha } : {}),
    content: Buffer.from(JSON.stringify(snapshot)).toString('base64'),
  }),
});
if (!response.ok) throw new Error(`evidence_publish_${response.status}`);
console.log(JSON.stringify({ status: snapshot.status, block: snapshot.blockNumber, quoted: snapshot.routesQuoted, bestNetPnlUsd: snapshot.bestNetPnlUsd, executionAuthority: false }));
