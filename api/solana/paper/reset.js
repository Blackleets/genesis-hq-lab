import { sendJson, sendMethodNotAllowed } from '../../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return sendMethodNotAllowed(res, 'POST');
  return sendJson(res, 409, {
    ok: false,
    error: 'Provider not configured',
    message: 'Paper reset is only available on the live backend runner, not the read-only Vercel snapshot.',
  });
}
