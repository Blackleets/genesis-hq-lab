// api/_lib/rateLimit.js — in-memory fixed-window rate limiter per IP.
//
// Phase 1 (this): per-instance memory, fine for a single serverless instance
// and for the local Node backend. Phase 2 candidate: Upstash Redis for
// cross-instance limits on Vercel.
import { sendJson } from './http.js';

// makeRateLimit({windowMs, max, blockMs}) -> async middleware(req,res)
// Returns true if the request is allowed; false if it was rejected with 429.
export function makeRateLimit({ windowMs = 60_000, max = 10, blockMs = 15 * 60_000 } = {}) {
  // ip -> { count, windowStart, blockedUntil }
  const buckets = new Map();

  return async function rateLimit(req, res) {
    const ip =
      (Array.isArray(req.headers?.['x-forwarded-for'])
        ? req.headers['x-forwarded-for'][0]
        : req.headers?.['x-forwarded-for'])?.split(',')[0]?.trim() ||
      req.socket?.remoteAddress ||
      'unknown';
    const now = Date.now();
    let b = buckets.get(ip);

    if (b && b.blockedUntil > now) {
      sendJson(res, 429, { ok: false, error: 'rate_limited', retryAfterMs: b.blockedUntil - now });
      return false;
    }

    if (!b || now - b.windowStart >= windowMs) {
      b = { count: 0, windowStart: now, blockedUntil: 0 };
      buckets.set(ip, b);
    }
    b.count += 1;

    if (b.count > max) {
      b.blockedUntil = now + blockMs;
      sendJson(res, 429, { ok: false, error: 'rate_limited', retryAfterMs: blockMs });
      return false;
    }
    return true;
  };
}
