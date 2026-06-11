export function sendJson(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(JSON.stringify(payload));
}

export function sendMethodNotAllowed(res, allow = 'GET') {
  res.setHeader('Allow', allow);
  return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
}
