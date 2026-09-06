import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SESSION_COOKIE, readSessionCookie, sameOriginRequest } from '../../_lib/sessionCookie.js';
import { signSessionJwt } from '../../_lib/sessions.js';
import { requireSession } from '../../_lib/sessionAuth.js';
import sessionHandler from '../session.js';
import logoutHandler from '../logout.js';
import verifyHandler from '../verify.js';

const response = () => ({ headers: {}, status(code) { this.code = code; return this; }, setHeader(k, v) { this.headers[k] = v; return this; }, send(body) { this.json = JSON.parse(body); } });
describe('cookie session boundary', () => {
  it('rejects duplicate cookies, malformed and absent values', () => {
    expect(readSessionCookie({ headers: {} })).toBeNull();
    expect(readSessionCookie({ headers: { cookie: `${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b` } })).toBeNull();
    expect(readSessionCookie({ headers: { cookie: `${SESSION_COOKIE}=bad value` } })).toBeNull();
  });
  it('read endpoint exposes only metadata; cookie authenticates the existing tenant middleware', async () => {
    process.env.AUTH_JWT_SECRET = randomBytes(32).toString('hex');
    const address = `0x${randomBytes(20).toString('hex')}`;
    const token = await signSessionJwt(address, 'user');
    const req = { method: 'GET', headers: { cookie: `${SESSION_COOKIE}=${token}` } };
    const res = response(); await sessionHandler(req, res);
    expect(res.code).toBe(200); expect(res.json.session.address).toBe(address);
    expect(res.json.session.token).toBeUndefined(); expect(JSON.stringify(res.json)).not.toContain(token);
    const session = await requireSession(req, response()); expect(session.address).toBe(address);
  });
  it('rejects cookie writes without same-origin proof or with cross-site metadata', async () => {
    const token = await signSessionJwt(`0x${randomBytes(20).toString('hex')}`, 'user');
    for (const headers of [{}, { origin: 'https://evil.test', host: 'genesis.test' }, { origin: 'https://genesis.test', host: 'genesis.test', 'sec-fetch-site': 'cross-site' }]) {
      const res = response(); await requireSession({ method: 'POST', headers: { ...headers, cookie: `${SESSION_COOKIE}=${token}` } }, res);
      expect(res.code).toBe(403);
    }
    expect(sameOriginRequest({ headers: { origin: 'https://genesis.test', host: 'genesis.test' } })).toBe(true);
  });
  it('logout clears a Secure HttpOnly Strict cookie and is POST-only', () => {
    const res = response(); logoutHandler({ method: 'POST', headers: { origin: 'https://genesis.test', host: 'genesis.test' } }, res);
    expect(res.code).toBe(200); expect(res.headers['Set-Cookie']).toContain('HttpOnly; Secure; SameSite=Strict; Max-Age=0');
    const denied = response(); logoutHandler({ method: 'GET' }, denied); expect(denied.code).toBe(405);
  });
  it('login completion cannot set a session from a cross-origin request', async () => {
    const res = response(); await verifyHandler({ method: 'POST', headers: { origin: 'https://evil.test', host: 'genesis.test' } }, res);
    expect(res.code).toBe(403); expect(res.headers['Set-Cookie']).toBeUndefined();
  });
});
