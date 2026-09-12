// crossExchangeArbShadow.mjs
// SHADOW-ONLY cross-exchange arbitrage scanner.
//
// Purpose:
//   Detect executable buy-low / sell-high opportunities using REAL L2 books
//   from multiple exchanges while preserving Genesis PAPER/LIVE locks.
//
// Safety:
//   - no order placement
//   - no API keys required
//   - no mutation of v9, ratchet, TP/SL, sizing or execution
//   - executionAuthority=false by construction
//
// Economics:
//   buy leg uses ask-side VWAP for the target notional
//   sell leg uses bid-side VWAP for the same base quantity
//   fees are exchange-specific when ccxt exposes taker fees, otherwise the
//   opportunity is marked feeModel='unknown' and is NOT eligible for GO.
//   rebalance/transfer costs are intentionally NOT assumed away; the scanner
//   reports them as unresolved unless an explicit bps budget is supplied.

import ccxt from 'ccxt';

export const EXECUTION_AUTHORITY = false;
export const MODE = 'SHADOW';

const DEFAULT_EXCHANGES = ['binance', 'bybit', 'okx'];
const DEFAULT_SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

export function vwapForQuote(asks, quoteNotional) {
  if (!Array.isArray(asks) || quoteNotional <= 0) return null;
  let quoteUsed = 0;
  let baseBought = 0;
  for (const [priceRaw, amountRaw] of asks) {
    const price = Number(priceRaw), amount = Number(amountRaw);
    if (!(price > 0) || !(amount > 0)) continue;
    const levelQuote = price * amount;
    const takeQuote = Math.min(levelQuote, quoteNotional - quoteUsed);
    if (takeQuote <= 0) break;
    const takeBase = takeQuote / price;
    quoteUsed += takeQuote;
    baseBought += takeBase;
    if (quoteUsed + 1e-9 >= quoteNotional) break;
  }
  if (quoteUsed + 1e-9 < quoteNotional || baseBought <= 0) return null;
  return { vwap: quoteUsed / baseBought, baseQty: baseBought, quoteUsed };
}

export function vwapForBase(bids, baseQty) {
  if (!Array.isArray(bids) || baseQty <= 0) return null;
  let baseSold = 0;
  let quoteReceived = 0;
  for (const [priceRaw, amountRaw] of bids) {
    const price = Number(priceRaw), amount = Number(amountRaw);
    if (!(price > 0) || !(amount > 0)) continue;
    const takeBase = Math.min(amount, baseQty - baseSold);
    if (takeBase <= 0) break;
    baseSold += takeBase;
    quoteReceived += takeBase * price;
    if (baseSold + 1e-12 >= baseQty) break;
  }
  if (baseSold + 1e-12 < baseQty || quoteReceived <= 0) return null;
  return { vwap: quoteReceived / baseSold, baseSold, quoteReceived };
}

export function evaluateCrossVenueArb({
  symbol,
  buyVenue,
  sellVenue,
  buyAsks,
  sellBids,
  quoteNotional,
  buyTakerFee,
  sellTakerFee,
  rebalanceBps = null,
  capturedAt = new Date().toISOString(),
}) {
  const buy = vwapForQuote(buyAsks, quoteNotional);
  if (!buy) return { executable: false, reason: 'insufficient_buy_depth', symbol, buyVenue, sellVenue };
  const sell = vwapForBase(sellBids, buy.baseQty);
  if (!sell) return { executable: false, reason: 'insufficient_sell_depth', symbol, buyVenue, sellVenue };

  const grossPnl = sell.quoteReceived - buy.quoteUsed;
  const grossEdgeBps = (grossPnl / buy.quoteUsed) * 10_000;

  const feesKnown = Number.isFinite(buyTakerFee) && Number.isFinite(sellTakerFee);
  const buyFeeUsd = feesKnown ? buy.quoteUsed * buyTakerFee : null;
  const sellFeeUsd = feesKnown ? sell.quoteReceived * sellTakerFee : null;
  const tradingFeesUsd = feesKnown ? buyFeeUsd + sellFeeUsd : null;
  const edgeAfterTradingFeesBps = feesKnown
    ? ((grossPnl - tradingFeesUsd) / buy.quoteUsed) * 10_000
    : null;

  const rebalanceKnown = Number.isFinite(rebalanceBps);
  const rebalanceCostUsd = rebalanceKnown ? buy.quoteUsed * (rebalanceBps / 10_000) : null;
  const netPnlUsd = feesKnown && rebalanceKnown
    ? grossPnl - tradingFeesUsd - rebalanceCostUsd
    : null;
  const netEdgeBps = netPnlUsd == null ? null : (netPnlUsd / buy.quoteUsed) * 10_000;

  return {
    executable: true,
    mode: MODE,
    executionAuthority: EXECUTION_AUTHORITY,
    symbol,
    buyVenue,
    sellVenue,
    capturedAt,
    quoteNotional: buy.quoteUsed,
    baseQty: buy.baseQty,
    buyVwap: buy.vwap,
    sellVwap: sell.vwap,
    grossPnlUsd: grossPnl,
    grossEdgeBps,
    buyTakerFee: feesKnown ? buyTakerFee : null,
    sellTakerFee: feesKnown ? sellTakerFee : null,
    tradingFeesUsd,
    edgeAfterTradingFeesBps,
    rebalanceBps: rebalanceKnown ? rebalanceBps : null,
    rebalanceCostUsd,
    netPnlUsd,
    netEdgeBps,
    feeModel: feesKnown ? 'ccxt_market_taker' : 'unknown',
    rebalanceModel: rebalanceKnown ? 'explicit_budget' : 'unresolved',
    verdict: netEdgeBps != null && netEdgeBps > 0 ? 'SHADOW_CANDIDATE' : 'NO_GO',
  };
}

function normalizeTakerFee(market) {
  const fee = Number(market?.taker);
  return Number.isFinite(fee) && fee >= 0 ? fee : null;
}

async function buildExchange(exchangeId) {
  if (!ccxt[exchangeId]) throw new Error(`Unsupported exchange: ${exchangeId}`);
  const ex = new ccxt[exchangeId]({ enableRateLimit: true });
  await ex.loadMarkets();
  return ex;
}

async function fetchBook(ex, symbol, limit = 20) {
  const startedAt = Date.now();
  const book = await ex.fetchOrderBook(symbol, limit);
  return {
    bids: book.bids ?? [],
    asks: book.asks ?? [],
    exchangeTs: book.timestamp ?? null,
    fetchedAt: Date.now(),
    latencyMs: Date.now() - startedAt,
  };
}

export async function scanCrossExchangeArbShadow({
  exchanges = DEFAULT_EXCHANGES,
  symbols = DEFAULT_SYMBOLS,
  quoteNotional = Number(process.env.GENESIS_ARB_NOTIONAL_USD || 1000),
  rebalanceBps = process.env.GENESIS_ARB_REBALANCE_BPS === undefined
    ? null
    : Number(process.env.GENESIS_ARB_REBALANCE_BPS),
  maxBookAgeMs = Number(process.env.GENESIS_ARB_MAX_BOOK_AGE_MS || 3000),
} = {}) {
  const clients = {};
  for (const id of exchanges) clients[id] = await buildExchange(id);

  const results = [];
  for (const symbol of symbols) {
    const snapshots = {};
    await Promise.all(exchanges.map(async (id) => {
      const ex = clients[id];
      const market = ex.market(symbol);
      const book = await fetchBook(ex, symbol, 20);
      snapshots[id] = { ex, market, book };
    }));

    for (const buyVenue of exchanges) {
      for (const sellVenue of exchanges) {
        if (buyVenue === sellVenue) continue;
        const buySnap = snapshots[buyVenue];
        const sellSnap = snapshots[sellVenue];
        const now = Date.now();
        const buyAge = now - buySnap.book.fetchedAt;
        const sellAge = now - sellSnap.book.fetchedAt;
        if (buyAge > maxBookAgeMs || sellAge > maxBookAgeMs) continue;

        results.push(evaluateCrossVenueArb({
          symbol,
          buyVenue,
          sellVenue,
          buyAsks: buySnap.book.asks,
          sellBids: sellSnap.book.bids,
          quoteNotional,
          buyTakerFee: normalizeTakerFee(buySnap.market),
          sellTakerFee: normalizeTakerFee(sellSnap.market),
          rebalanceBps,
        }));
      }
    }
  }

  return results
    .filter(r => r.executable)
    .sort((a, b) => (b.netEdgeBps ?? b.edgeAfterTradingFeesBps ?? b.grossEdgeBps)
      - (a.netEdgeBps ?? a.edgeAfterTradingFeesBps ?? a.grossEdgeBps));
}

if (process.argv[1]?.endsWith('crossExchangeArbShadow.mjs')) {
  const results = await scanCrossExchangeArbShadow();
  console.log(JSON.stringify({
    mode: MODE,
    executionAuthority: EXECUTION_AUTHORITY,
    scannedAt: new Date().toISOString(),
    opportunities: results.slice(0, 25),
  }, null, 2));
}
