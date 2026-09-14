import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../dist/', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const STABLE_API_ORIGIN = (process.env.STABLE_API_ORIGIN || 'https://genesis-hq-lab.vercel.app').replace(/\/$/, '');
const SOLANA_SNAPSHOT_URL = 'https://raw.githubusercontent.com/Blackleets/genesis-hq-lab/data/solana-arbitrage-observations/data/solana-arbitrage-latest.json';

const TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
]);

function sendJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, no-cache, must-revalidate',
  });
  res.end(JSON.stringify(body));
}

async function solanaRadar(res) {
  try {
    const response = await fetch(SOLANA_SNAPSHOT_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`solana_snapshot_${response.status}`);
    const snapshot = await response.json();
    const observation = snapshot?.observation;
    const valid = snapshot?.mode === 'SHADOW'
      && snapshot?.executionAuthority === false
      && snapshot?.liveLocked === true
      && (!observation || observation?.chain === 'SOLANA');
    if (!valid) throw new Error('solana_snapshot_contract_violation');
    return sendJson(res, 200, {
      ok: true,
      status: observation?.status ?? snapshot?.status ?? 'OBSERVING',
      radar: snapshot,
      executionAuthority: false,
      liveLocked: true,
      mode: 'SHADOW',
      chain: 'SOLANA',
    });
  } catch (error) {
    return sendJson(res, 503, {
      ok: false,
      status: 'unavailable',
      error: error instanceof Error ? error.message : 'solana_radar_unavailable',
      radar: null,
      executionAuthority: false,
      liveLocked: true,
      mode: 'SHADOW',
      chain: 'SOLANA',
    });
  }
}

async function proxyStableApi(req, res, url) {
  try {
    const target = `${STABLE_API_ORIGIN}${url.pathname}${url.search}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null || ['host', 'content-length', 'connection'].includes(key.toLowerCase())) continue;
      headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
    }
    const method = req.method || 'GET';
    let body;
    if (!['GET', 'HEAD'].includes(method)) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      body = Buffer.concat(chunks);
    }
    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const outHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) outHeaders[key] = value;
    });
    res.writeHead(upstream.status, outHeaders);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    sendJson(res, 502, { ok: false, error: error instanceof Error ? error.message : 'upstream_unavailable' });
  }
}

function serveStatic(res, pathname) {
  const decoded = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const safe = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  let file = join(ROOT, safe);
  if (!file.startsWith(ROOT)) file = join(ROOT, 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) file = join(ROOT, 'index.html');
  res.writeHead(200, {
    'content-type': TYPES.get(extname(file).toLowerCase()) || 'application/octet-stream',
    'cache-control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/healthz') return sendJson(res, 200, { ok: true, mode: 'UI_ONLY', liveLocked: true });
  if (url.pathname === '/api/genesis/context' && url.searchParams.get('view') === 'solana-arbitrage-radar') {
    return solanaRadar(res);
  }
  if (url.pathname.startsWith('/api/')) return proxyStableApi(req, res, url);
  return serveStatic(res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`[solana-ui] listening on http://${HOST}:${PORT} · UI_ONLY · LIVE_LOCKED`);
});
