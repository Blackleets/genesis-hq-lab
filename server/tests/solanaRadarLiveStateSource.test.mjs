import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('../../api/genesis/context.js', import.meta.url);

test('Solana radar reads the fresh safety-validated Supabase state before the hosted fallback', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /SOLANA_RADAR_STATE_KEY = 'solana_mev_venue_radar_v2'/);
  assert.match(source, /readLiveSolanaRadarState/);
  assert.match(source, /state\.executionAuthority !== false \|\| state\.liveLocked !== true/);
  assert.match(source, /event\.executionAuthority !== false \|\| event\.liveLocked !== true/);
  assert.match(source, /const liveState = await readLiveSolanaRadarState\(\)\.catch\(\(\) => null\)/);
  assert.match(source, /if \(liveState\) return liveState/);
  assert.match(source, /SOLANA_RADAR_SNAPSHOT_URL/);
});
