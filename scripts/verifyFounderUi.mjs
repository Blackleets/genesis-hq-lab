// Isolated UI acceptance harness. Serves dist and synthetic readiness locally;
// never starts an agent runner, reads credentials or contacts an exchange.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { once } from 'node:events';
import { createHmac, randomBytes } from 'node:crypto';
import { chromium } from 'playwright';
import { buildFounderSnapshot, founderScope } from '../server/genesis/founderReadiness.mjs';

const root = resolve('dist');
let scenario = 'blocked';
let posts = 0;
const env = { GENESIS_OWNER_ADDRESS: `0x${randomBytes(20).toString('hex')}`, GENESIS_EXECUTION_VENUE: 'binance',
  GENESIS_ACCOUNT_ID: 'ui-fixture', GENESIS_STRATEGY_ID: 'ui-fixture', GENESIS_STRATEGY_VERSION: '1', GENESIS_REVISION: 'ui-fixture',
  GENESIS_MAX_DAILY_LOSS_USD: '20', GENESIS_MAX_ORDER_NOTIONAL_USD: '100', GENESIS_FOUNDER_PAUSED: 'false',
  BINANCE_API_KEY: randomBytes(20).toString('hex'), BINANCE_API_SECRET: randomBytes(32).toString('hex'),
  GENESIS_PREFLIGHT_HMAC_KEY: randomBytes(32).toString('hex') };
function readySnapshot() {
  const now = Date.now();
  const proof = { version: 1, scope: founderScope(env), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 45_000).toISOString(),
    gates: { ownerVerified: true, killSwitchArmed: true, killSwitchTested: true, founderPauseClear: true, strategyApproved: true,
      truthLedgerOnline: true, ledgerReconciled: true, auditLogOnline: true, brokerAuthenticated: true, executionSafetyVerified: true },
    connectors: Object.fromEntries(['binance', 'execution_broker'].map(id => [id, { status: 'online', mode: 'read_only', checkedAt: new Date(now).toISOString() }])) };
  env.GENESIS_PREFLIGHT_JSON = JSON.stringify(proof);
  env.GENESIS_PREFLIGHT_SIGNATURE = createHmac('sha256', env.GENESIS_PREFLIGHT_HMAC_KEY).update(env.GENESIS_PREFLIGHT_JSON).digest('hex');
  return buildFounderSnapshot(env, now);
}
const server = createServer(async (req, res) => {
  if (req.method !== 'GET') { posts++; res.writeHead(405).end(); return; }
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/api/genesis/founder') {
      if (scenario === 'offline') { res.writeHead(503).end('{"ok":false}'); return; }
      const data = scenario === 'ready' ? readySnapshot() : buildFounderSnapshot({});
      res.end(JSON.stringify(data)); return;
    }
    res.writeHead(path === '/api/auth/session' ? 401 : 503).end('{"ok":false}'); return;
  }
  const file = resolve(root, path === '/' ? 'index.html' : `.${path}`);
  if (!file.startsWith(`${root}/`)) { res.writeHead(403).end(); return; }
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const launch = { headless: true };
if (process.env.FOUNDER_CHROMIUM_EXECUTABLE) {
  launch.executablePath = process.env.FOUNDER_CHROMIUM_EXECUTABLE;
  launch.args = ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
}
let browser;
try {
  browser = await chromium.launch(launch);
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await context.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  const page = await context.newPage();
  const crashes = []; page.on('pageerror', err => crashes.push(err.message));
  await page.clock.install();
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Founder Live Control' }).waitFor();
  const button = page.getByRole('button', { name: 'Review external cutover' });
  await page.getByText('Selected broker/account credentials missing or unsupported venue', { exact: true }).first().waitFor();
  assert.equal(await button.isDisabled(), true);
  assert.equal(await page.getByText('$10,000.00', { exact: true }).count(), 0);
  await page.screenshot({ path: 'docs/evidence/founder-desktop.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Founder Live Control' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/evidence/founder-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  scenario = 'ready';
  await page.getByRole('button', { name: 'Refresh readiness', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === 'Review external cutover')?.disabled);
  await button.click();
  await page.getByRole('status').filter({ hasText: 'Readiness is evidence for review' }).waitFor();
  assert.equal(posts, 0, 'review action must not send writes');
  // Client expiry must block even before a replacement server response arrives.
  await page.route('**/api/genesis/founder', route => route.abort());
  await page.clock.fastForward(61_000);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].find(b => b.textContent === 'Review external cutover')?.disabled);
  assert.equal(await button.isDisabled(), true);
  scenario = 'offline';
  await page.getByRole('button', { name: 'Refresh readiness', exact: true }).click();
  await page.getByText('Backend unavailable. No cached readiness is trusted.').waitFor();
  assert.equal(await button.isDisabled(), true);
  assert.equal(posts, 0);
  assert.deepEqual(crashes, []);
  console.log('PASS: desktop/mobile render, no horizontal viewport overflow, missing data, blocked/ready/offline/expiry states, review performs zero writes, no runtime errors.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
