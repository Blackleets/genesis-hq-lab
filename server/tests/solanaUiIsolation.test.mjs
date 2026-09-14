import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('Futures chart remains mounted only in the Futures branch and Solana owns a separate desk', async () => {
  const source = await readFile(new URL('src/components/trading/TradingWorkspace.tsx', root), 'utf8');
  assert.match(source, /deskMode === 'solana'/);
  assert.match(source, /<SolanaDesk \/>/);
  assert.match(source, /id="desk-chart"[^>]*><MarketChart \/>/);
  assert.equal(source.includes('<ArbitrageRadarPanel /><MarketChart'), false);
});

test('global Solana opportunity indicator navigates without overlaying Futures', async () => {
  const source = await readFile(new URL('src/components/trading/TradingHeader.tsx', root), 'utf8');
  assert.match(source, /trading-header__solana-signal/);
  assert.match(source, /chooseDesk\('solana'\)/);
  assert.match(source, /OPPORTUNITY_DETECTED/);
});

test('Telegram token is a password field and is never stored in browser storage', async () => {
  const source = await readFile(new URL('src/components/trading/GenesisSettingsDrawer.tsx', root), 'utf8');
  assert.match(source, /type="password"/);
  assert.equal(/localStorage|sessionStorage/.test(source), false);
});
