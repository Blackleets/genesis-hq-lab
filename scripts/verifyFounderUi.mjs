// Isolated UI acceptance harness for the current Genesis trading desk.
// Serves dist and synthetic readiness locally; never starts an agent runner,
// reads real credentials, contacts an exchange, or sends a trading write.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { buildFounderSnapshot } from '../server/genesis/founderReadiness.mjs';

const root = resolve('dist');
let founderOffline = false;
let writes = 0;

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (req.method !== 'GET') {
    writes += 1;
    res.writeHead(405).end();
    return;
  }
  if (path.startsWith('/api')) {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/api/genesis/founder') {
      if (founderOffline) {
        res.writeHead(503).end('{"ok":false}');
        return;
      }
      res.end(JSON.stringify(buildFounderSnapshot({})));
      return;
    }
    // All other trading resources intentionally remain unavailable in this
    // isolated fixture. The UI must fail closed and must not manufacture data.
    res.writeHead(path === '/api/auth/session' ? 401 : 503).end('{"ok":false}');
    return;
  }

  const file = resolve(root, path === '/' ? 'index.html' : `.${path}`);
  if (!file.startsWith(`${root}/`)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] ?? 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');

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
  const crashes = [];
  page.on('pageerror', err => crashes.push(err.message));

  await page.goto(origin);
  const liveLock = page.getByRole('button', { name: /LIVE LOCKED/i }).first();
  await liveLock.waitFor();
  await liveLock.click();

  const drawer = page.getByRole('dialog', { name: 'Founder control' });
  await drawer.waitFor();
  await drawer.getByText('LIVE EXECUTION', { exact: true }).waitFor();
  await drawer.getByText('READ-ONLY CONTROL SURFACE', { exact: true }).waitFor();
  await drawer.getByText('Can execute', { exact: true }).waitFor();
  assert.equal(await drawer.getByText('FALSE', { exact: true }).count(), 1, 'founder cutover must remain false');
  assert.equal(await page.getByText('$10,000.00', { exact: true }).count(), 0, 'fixture must not invent capital/equity');
  assert.equal(writes, 0, 'opening founder control must never send writes');

  await page.screenshot({ path: 'docs/evidence/founder-desktop.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'desktop must not overflow horizontally');

  await drawer.getByRole('button', { name: /REFRESH EVIDENCE/i }).click();
  await page.waitForTimeout(250);
  assert.equal(writes, 0, 'refresh evidence must remain read-only');

  await drawer.getByRole('button', { name: 'Close founder control' }).first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileControl = page.getByRole('button', { name: /^Control$/i }).last();
  await mobileControl.scrollIntoViewIfNeeded();
  await mobileControl.click();
  await page.getByRole('dialog', { name: 'Founder control' }).waitFor();
  await page.screenshot({ path: 'docs/evidence/founder-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile must not overflow horizontally');

  // A backend outage must degrade to NOT VERIFIED rather than trusting stale
  // readiness or enabling execution.
  founderOffline = true;
  await page.getByRole('dialog', { name: 'Founder control' }).getByRole('button', { name: /REFRESH EVIDENCE/i }).click();
  await page.waitForTimeout(350);
  const offlineDrawer = page.getByRole('dialog', { name: 'Founder control' });
  await offlineDrawer.getByText('NOT VERIFIED', { exact: true }).first().waitFor();
  assert.equal(await offlineDrawer.getByText('FALSE', { exact: true }).count(), 0, 'offline state must not claim fresh cutover evidence');
  assert.equal(writes, 0, 'offline handling must never send writes');
  assert.deepEqual(crashes, []);

  console.log('PASS: desktop/mobile render, no horizontal overflow, founder cutover fail-closed, offline state untrusted, refresh is read-only, zero trading writes, no runtime errors.');
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolveClose => server.close(resolveClose));
}
