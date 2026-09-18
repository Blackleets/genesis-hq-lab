// Persist RESEARCH_ONLY OKX RPI order-book snapshots as durable evidence.
// Read-only public market data. Never places orders or changes trading gates.

import fs from 'node:fs';
import path from 'node:path';
import { getOkxRpiOrderBookContext } from './okxRpiOrderBook.mjs';

export function appendRpiOrderBookJsonl(jsonl, payload) {
  if (!jsonl) return;
  fs.mkdirSync(path.dirname(jsonl), { recursive: true });
  fs.appendFileSync(jsonl, `${JSON.stringify(payload)}\n`);
}

export async function captureRpiOrderBook({ instId = 'BTC-USDT-SWAP', depth = 20, out, jsonl } = {}) {
  const context = await getOkxRpiOrderBookContext(instId, { depth });
  const capturedAt = new Date().toISOString();
  const payload = {
    schemaVersion: 3,
    mode: 'RESEARCH_ONLY',
    provider: 'okx',
    source: context.source,
    instId,
    capturedAt,
    sourceAsOf: new Date(context.time).toISOString(),
    sourceAgeMs: Math.max(0, Date.parse(capturedAt) - context.time),
    features: {
      rpiBookLevelCount: context.rpiBookLevelCount,
      rpiBestBid: context.rpiBestBid,
      rpiBestAsk: context.rpiBestAsk,
      rpiBestBidQty: context.rpiBestBidQty,
      rpiBestAskQty: context.rpiBestAskQty,
      rpiMidPrice: context.rpiMidPrice,
      rpiBidDepth: context.rpiBidDepth,
      rpiAskDepth: context.rpiAskDepth,
      rpiDepthImbalance: context.rpiDepthImbalance,
      rpiDepthShare: context.rpiDepthShare,
      rpiSpreadBps: context.rpiSpreadBps,
      rpiMicroprice: context.rpiMicroprice,
      rpiMicropriceSkewBps: context.rpiMicropriceSkewBps,
      rpiBidDepth10Bps: context.rpiBidDepth10Bps,
      rpiAskDepth10Bps: context.rpiAskDepth10Bps,
      rpiDepthImbalance10Bps: context.rpiDepthImbalance10Bps,
      rpiBidDepth25Bps: context.rpiBidDepth25Bps,
      rpiAskDepth25Bps: context.rpiAskDepth25Bps,
      rpiDepthImbalance25Bps: context.rpiDepthImbalance25Bps,
      rpiBidDepth50Bps: context.rpiBidDepth50Bps,
      rpiAskDepth50Bps: context.rpiAskDepth50Bps,
      rpiDepthImbalance50Bps: context.rpiDepthImbalance50Bps,
      rpiBidOrderCount: context.rpiBidOrderCount,
      rpiAskOrderCount: context.rpiAskOrderCount,
      rpiOrderCountImbalance: context.rpiOrderCountImbalance,
    },
    researchUse: 'OBSERVATIONAL_ONLY_NOT_IN_H1',
  };
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  }
  appendRpiOrderBookJsonl(jsonl, payload);
  return payload;
}

if (process.argv[1] && process.argv[1].endsWith('rpiOrderBookCapture.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  captureRpiOrderBook({
    instId: valueAfter('--inst') || 'BTC-USDT-SWAP',
    depth: valueAfter('--depth') || 20,
    out: valueAfter('--out'),
    jsonl: valueAfter('--jsonl'),
  })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error('ERROR:', error.message); process.exitCode = 1; });
}
