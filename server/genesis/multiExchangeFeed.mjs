// server/genesis/multiExchangeFeed.mjs
// Expands the universe beyond Binance using ccxt (the #1 GitHub exchange lib).
// Fetches USDT perpetual / swap markets from multiple exchanges so the learner
// can scan a WIDER space (more edges, more regimes). PAPER analysis only.
//
// Real data via ccxt. No execution. REAL requires human GO + keys + confirm.

import ccxt from 'ccxt';

const EXCHANGES = ['binance', 'bybit', 'okx', 'kucoin', 'gateio'];

// Get tradable USDT perpetual/swap symbols for one exchange.
async function getPerpSymbols(exchangeId) {
  try {
    const ex = new ccxt[exchangeId]();
    // prefer swap/linear perpetual markets
    let markets;
    if (ex.has['fetchMarkets']) {
      markets = await ex.fetchMarkets();
    } else return [];
    const out = [];
    for (const m of markets) {
      if (m.active === false) continue;
      if (m.quote === 'USDT' && (m.swap === true || m.linear === true || /PERP/i.test(m.id) || /:USDT$/.test(m.symbol))) {
        out.push(`${exchangeId.toUpperCase()}:${m.symbol}`);
      }
    }
    return out;
  } catch (e) {
    return [];
  }
}

export async function getMultiExchangeUniverse() {
  const all = {};
  let total = 0;
  for (const ex of EXCHANGES) {
    const syms = await getPerpSymbols(ex);
    all[ex] = syms;
    total += syms.length;
    console.log(`  ${ex}: ${syms.length} USDT perp symbols`);
  }
  console.log(`Multiverse total: ${total} symbols across ${EXCHANGES.length} exchanges`);
  return { all, total, exchanges: EXCHANGES };
}

// Fetch OHLCV for a prefixed symbol like "BYBIT:ETHUSDT"
export async function fetchMultiExchangeOHLCV(prefixedSymbol, { days = 30, interval = '1h' } = {}) {
  const [exId, symbol] = prefixedSymbol.split(':');
  const ex = new ccxt[exId.toLowerCase()]();
  const since = Date.now() - days * 86400000;
  const tf = interval === '1h' ? '1h' : interval === '15m' ? '15m' : interval === '5m' ? '5m' : '1h';
  const data = await ex.fetchOHLCV(symbol, tf, since, 1000);
  // normalize to [ts, o, h, l, c, v]
  return data.map(d => [d[0], d[1], d[2], d[3], d[4], d[5] || 0]);
}

if (process.argv[1] && process.argv[1].endsWith('multiExchangeFeed.mjs')) {
  getMultiExchangeUniverse().then(() => process.exit(0)).catch(e => { console.error('ERR', e.message); process.exit(1); });
}
