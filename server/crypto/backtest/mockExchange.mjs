// mockExchange.mjs — A LOCAL fake of the Binance Spot REST API.
//
// WHY: We want to prove the live execution path (liveExecutor.mjs with
// LIVE_MODE=true) works end-to-end — signing requests, placing orders,
// updating equity — WITHOUT risking a single real cent or hitting the
// real network. This mock mimics `POST /api/v3/order` including HMAC
// signature verification, so the executor's real code path is exercised.
//
// It does NOT trade real money. It simulates fills against REAL fetched
// prices is not needed here; it just acknowledges orders and tracks a
// fake balance so we can confirm the wiring is correct.
//
// Run: node server/crypto/backtest/mockExchange.mjs   (listens on :5811)
// The executor points here via EXEC_BASE_URL=http://127.0.0.1:5811

import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 5811);
const SECRET = process.env.BINANCE_API_SECRET || 'MOCK_SECRET_FOR_TESTING_ONLY';
const KEY = process.env.BINANCE_API_KEY || 'MOCK_KEY_FOR_TESTING_ONLY';

// fake account state
let balance = Number(process.env.MOCK_BALANCE || 100); // USDT
const orders = [];

function verifySignature(params, signature) {
  const qs = new URLSearchParams(params).toString();
  const expected = createHmac('sha256', SECRET).update(qs).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature || ''));
  } catch { return false; }
}

const server = http.createServer((req, res) => {
  // CORS-ish, tiny
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'GET' && req.url.startsWith('/api/v3/account')) {
    // requires valid signature too
    const u = new URL(req.url, 'http://x');
    const sig = u.searchParams.get('signature');
    const params = {};
    for (const [k, v] of u.searchParams) if (k !== 'signature') params[k] = v;
    if (!verifySignature(params, sig)) { res.statusCode = 401; res.end(JSON.stringify({ code: -2010, msg: 'API-key or signature invalid.' })); return; }
    res.end(JSON.stringify({ makerCommission: 0, takerCommission: 0, balances: [{ asset: 'USDT', free: String(balance), locked: '0.0' }] }));
    return;
  }
  if (req.method === 'POST' && req.url.startsWith('/api/v3/order')) {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      const sig = params.signature;
      const { signature, ...rest } = params;
      // Rebuild the alphabetically-ordered query string (same as client) and verify.
      const qs = Object.keys(rest).sort().map(k => `${k}=${encodeURIComponent(rest[k])}`).join('&');
      const expected = createHmac('sha256', SECRET).update(qs).digest('hex');
      let ok = false;
      try { ok = timingSafeEqual(Buffer.from(expected), Buffer.from(sig || '')); } catch { ok = false; }
      if (!ok) {
        res.statusCode = 401;
        res.end(JSON.stringify({ code: -2010, msg: 'API-key or signature invalid.' }));
        return;
      }
      if (params.symbol && params.side && params.type && params.quantity) {
        const order = {
          symbol: params.symbol, side: params.side, type: params.type,
          quantity: params.quantity, price: params.price || 'MARKET',
          status: 'FILLED', orderId: orders.length + 1,
          executedQty: params.quantity, time: Date.now(),
        };
        orders.push(order);
        // fake fill: nudge balance to show activity (no real PnL model here)
        const notional = parseFloat(params.quantity) * (parseFloat(params.price) || 1);
        if (params.side === 'BUY') balance -= notional * 0.0001; else balance += notional * 0.0001;
        res.statusCode = 200;
        res.end(JSON.stringify(order));
        return;
      }
      res.statusCode = 400;
      res.end(JSON.stringify({ code: -1102, msg: 'Mandatory parameter missing.' }));
    });
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ code: -1121, msg: 'Not found.' }));
});

server.listen(PORT, () => {
  console.log(`MOCK Binance exchange listening on http://127.0.0.1:${PORT}`);
  console.log(`Accepts HMAC-signed orders. Balance: $${balance} (FAKE, zero real risk).`);
  console.log(`Expected key: ${KEY.slice(0, 6)}... secret length ${SECRET.length}`);
});
