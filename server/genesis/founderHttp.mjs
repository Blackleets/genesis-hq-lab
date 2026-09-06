import { buildFounderSnapshot } from './founderReadiness.mjs';

export function founderResponse(method, env = process.env, now = Date.now()) {
  return method === 'GET'
    ? { status: 200, body: buildFounderSnapshot(env, now) }
    : { status: 405, body: { ok: false, error: 'method_not_allowed' } };
}

export function handleFounderRequest(req, res) {
  const result = founderResponse(req.method);
  res.writeHead(result.status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate', 'Allow': 'GET' });
  res.end(JSON.stringify(result.body));
}
