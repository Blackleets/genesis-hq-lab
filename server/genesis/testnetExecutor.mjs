// server/genesis/testnetExecutor.mjs
// GATED testnet executor: does NOTHING unless EVERY gate passes:
//   1. process.env.GENESIS_TESTNET_KEY set
//   2. process.env.GENESIS_TESTNET_SECRET set
//   3. process.env.TESTNET === 'true'
//   4. data/GENESIS_LIVE_GO.txt exists (explicit human go-live file)
// Otherwise returns a dry-run result with the order intent. No keys are stored here.
//
// Usage (from other modules):
//   import { placeTestnetOrder } from './testnetExecutor.mjs';
//   const r = await placeTestnetOrder({ pair: 'COTIUSDT', side: 'buy', amount: 100 });

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const GO_FILE = path.join(__dirname, '../../data/GENESIS_LIVE_GO.txt');

export function gatesPassed() {
  return Boolean(
    process.env.GENESIS_TESTNET_KEY &&
    process.env.GENESIS_TESTNET_SECRET &&
    process.env.TESTNET === 'true' &&
    fs.existsSync(GO_FILE)
  );
}

export async function placeTestnetOrder({ pair, side, amount }) {
  const intent = { pair, side, amount };

  if (!gatesPassed()) {
    return {
      executed: false,
      reason: 'dry-run: missing keys / GO file / TESTNET=true',
      intent,
    };
  }

  try {
    const ccxt = (await import('ccxt')).default;
    const exchangeId = process.env.GENESIS_TESTNET_EXCHANGE || 'binanceusdm';
    const ExchangeClass = ccxt[exchangeId];
    if (!ExchangeClass) {
      return { executed: false, reason: `unknown ccxt exchange: ${exchangeId}`, intent };
    }
    const ex = new ExchangeClass({
      apiKey: process.env.GENESIS_TESTNET_KEY,
      secret: process.env.GENESIS_TESTNET_SECRET,
    });
    ex.setSandboxMode(true); // testnet only — never mainnet
    await ex.loadMarkets();
    const order = await ex.createOrder(pair, 'market', side, amount);
    return { executed: true, exchange: exchangeId, sandbox: true, orderId: order?.id ?? null, intent };
  } catch (e) {
    return { executed: false, reason: `testnet order failed: ${e.message}`, intent };
  }
}
