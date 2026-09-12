// Authentication cookies are invisible to JavaScript. No bearer JSON payload.
export const SESSION_COOKIE = '__Host-genesis_session';

export function setSessionCookie(res, token, maxAge) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`);
}

export function readSessionCookie(req) {
  const raw = req.headers?.cookie;
  if (typeof raw !== 'string' || raw.length > 16_384) return null;
  const matches = raw.split(';').map(part => part.trim()).filter(part => part.startsWith(`${SESSION_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(SESSION_COOKIE.length + 1);
  return /^[A-Za-z0-9_.-]+$/.test(token) ? token : null;
}

// Cookie-authenticated writes require a same-origin browser request. Reject
// cross-site requests even when a browser/proxy unexpectedly sends the cookie.
export function sameOriginRequest(req) {
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers?.origin;
  const host = req.headers?.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    const parsed = new URL(origin);
    return parsed.host === host && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)));
  } catch { return false; }
}
