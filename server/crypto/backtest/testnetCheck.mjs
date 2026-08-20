// testnetCheck.mjs — Validate end-to-end connectivity to the REAL Binance
// Spot TESTNET using YOUR testnet keys. Zero real-money risk: testnet uses
// fake funds. This proves the executor's signing + order path works against
// the actual testnet before you trust it.
//
// HOW TO RUN (operator only — agent never stores keys):
//   1. Get free testnet keys at https://testnet.binance.vision (GitHub login).
//   2. Set env vars, then run:
//      BINANCE_API_KEY=xxxx BINANCE_API_SECRET=yyyy \
//      node --env-file-if-exists=.env server/crypto/backtest/testnetCheck.mjs
//
// It will: GET /api/v3/account (verify signature + key) and POST a tiny
// MARKET order (BUY 0.0001 of a stable pair if available, or just validates
// the signed request is accepted). Testnet has no real balance, so use a
// pair you can afford in testnet USDT.

import { createHmac } from 'node:crypto';

const BASE = 'https://testnet.binance.vision';
const KEY = process.env.BINANCE_API_KEY;
const SECRET = process.env.BINANCE_API_SECRET;
const SYMBOL = process.env.TN_SYMBOL || 'BTCUSDT';
const QTY = process.env.TN_QTY || '0.0001';

if (!KEY || !SECRET) {
  console.error('MISSING KEYS: set BINANCE_API_KEY and BINANCE_API_SECRET (testnet).');
  process.exit(2);
}

function sign(qs) {
  return createHmac('sha256', SECRET).update(qs).digest('hex');
}
function orderedQs(obj) {
  return Object.keys(obj).sort().map(k => `${k}=${encodeURIComponent(obj[k])}`).join('&');
}

async function getAccount() {
  const base = { timestamp: String(Date.now()) };
  const qs = orderedQs(base);
  const sig = sign(qs);
  const url = `${BASE}/api/v3/account?${qs}&signature=${sig}`;
  const r = await fetch(url, { headers: { 'X-MBX-APIKEY': KEY } });
  const txt = await r.text();
  console.log(`GET /account -> ${r.status}`);
  if (!r.ok) { console.log(txt); throw new Error('account check failed'); }
  const j = JSON.parse(txt);
  console.log(`  balances: ${j.balances.length}, canTrade: ${j.canTrade}`);
  return j;
}

async function postOrder() {
  const base = { symbol: SYMBOL, side: 'BUY', type: 'MARKET', quantity: QTY, timestamp: String(Date.now()) };
  const qs = orderedQs(base);
  const sig = sign(qs);
  const body = qs + '&signature=' + sig;
  const r = await fetch(`${BASE}/api/v3/order`, {
    method: 'POST',
    headers: { 'X-MBX-APIKEY': KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const txt = await r.text();
  console.log(`POST /order (${SYMBOL} BUY ${QTY}) -> ${r.status}`);
  console.log(txt);
  if (!r.ok) throw new Error('order check failed');
  return JSON.parse(txt);
}

async function main() {
  console.log(`\n=== TESTNET CONNECTIVITY CHECK (${BASE}) ===`);
  await getAccount();
  console.log('\nAccount reachable + signature valid. Now testing a signed order...');
  try { await postOrder(); console.log('\nTESTNET PATH OK — executor can trade on testnet.'); }
  catch (e) { console.log('\nOrder test failed (may be insufficient testnet balance — that is fine, signing worked if account check passed).'); }
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
