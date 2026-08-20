// riskProfile.mjs — Measure REAL cross-pair correlation and drawdown of the
// validated basket, so we can add a correlation filter + trailing stop that
// lowers risk BEFORE any real capital. Uses REAL fetched klines.
//
// Run: node --env-file-if-exists=.env server/crypto/backtest/riskProfile.mjs

import { fetchKlines } from './historicalData.mjs';

const PAIRS = (process.env.RP_PAIRS || 'SOLUSDT,ETHUSDT,DOGEUSDT,ADAUSDT,AVAXUSDT,LINKUSDT,LTCUSDT,DOTUSDT,NEARUSDT,ARBUSDT,OPUSDT,SUIUSDT,TIAUSDT,SEIUSDT,INJUSDT,FILUSDT,WIFUSDT,PEPEUSDT,XLMUSDT,ALGOUSDT,SANDUSDT,APTUSDT,BCHUSDT').split(',');
const INTERVAL = process.env.RP_INTERVAL || '4h';
const DAYS = Number(process.env.RP_DAYS || 200);

function returns(closes) {
  const r = [];
  for (let i = 1; i < closes.length; i++) r.push(Math.log(closes[i] / closes[i - 1]));
  return r;
}
function corr(a, b) {
  const n = Math.min(a.length, b.length);
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const xa = a[i] - ma, xb = b[i] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  return num / Math.sqrt(da * db);
}

async function main() {
  console.log(`\n=== RISK PROFILE (REAL ${INTERVAL} data, ${DAYS}d) ===`);
  const data = {};
  for (const p of PAIRS) {
    try { const k = await fetchKlines(p, { days: DAYS, interval: INTERVAL }); data[p] = returns(k.map(x => +x[4])); }
    catch (e) { console.log(p, 'skip'); }
  }
  const keys = Object.keys(data);
  // average absolute correlation per pair (how cluster-y it is)
  const avgCorr = {};
  for (const a of keys) {
    let s = 0, c = 0;
    for (const b of keys) if (a !== b) { s += Math.abs(corr(data[a], data[b])); c++; }
    avgCorr[a] = c ? s / c : 0;
  }
  console.log('\nPair | avg|corr| | most-correlated with');
  const sorted = keys.sort((x, y) => avgCorr[y] - avgCorr[x]);
  for (const a of sorted) {
    let best = null, bestv = -1;
    for (const b of keys) if (a !== b) { const v = corr(data[a], data[b]); if (Math.abs(v) > Math.abs(bestv)) { bestv = v; best = b; } }
    console.log(`${a.padEnd(9)} | ${avgCorr[a].toFixed(2)}     | ${best} (${(bestv*100).toFixed(0)}%)`);
  }
  // clusters: greedy group by high correlation
  console.log('\n=== CORRELATION CLUSTERS (|corr|>=0.6) ===');
  const seen = new Set();
  for (const a of sorted) {
    if (seen.has(a)) continue;
    const cluster = [a]; seen.add(a);
    for (const b of keys) if (!seen.has(b) && Math.abs(corr(data[a], data[b])) >= 0.6) { cluster.push(b); seen.add(b); }
    if (cluster.length > 1) console.log(`  cluster: ${cluster.join(', ')}`);
  }
  console.log('\nDone. Use clusters to cap concurrent exposure per cluster.');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
