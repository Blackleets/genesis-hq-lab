// server/genesis/feeAccountant.mjs
// Fee accounting from real exchange data instead of the 0.10% hardcode.
// Port of the Hummingbot TradeFeeBase pattern (see scripts/genesis_paper_connector.py,
// FeeSchema) — P2 of .hermes/plans/2026-08-24_unified-integration-plan.md.
//
// FLOAT LIMITATION (documented, deliberate): JS numbers are IEEE-754 doubles,
// so fee math here is NOT exactly decimal like the Python reference
// (scripts/genesis_paper_connector.py uses Decimal everywhere). For paper
// trading at these magnitudes double error is ~1e-16 relative and acceptable;
// if this ever graduates to real capital, swap to a decimal library or route
// accounting through the Python connector.

const FALLBACK = { makerPercent: 0.0001, takerPercent: 0.0001, addedToCost: true };

function finitePositive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/**
 * Read maker/taker fees for `symbol` from a ccxt exchange object AFTER
 * loadMarkets(). ccxt stores per-market fractions: market.maker / market.taker
 * (e.g. Binance spot taker = 0.001). Some exchanges only expose tiered
 * fees on the top-level object; we try both before falling back.
 *
 * @param {{markets?: Record<string, any>}|undefined} exchangeObj ccxt instance (or undefined)
 * @param {string} symbol unified ccxt symbol, e.g. 'BTC/USDT'
 * @returns {{makerPercent: number, takerPercent: number, addedToCost: boolean}}
 */
export function loadFeeSchema(exchangeObj, symbol) {
  if (!exchangeObj || !symbol || typeof symbol !== 'string') return { ...FALLBACK };
  try {
    const market = exchangeObj.markets && exchangeObj.markets[symbol];
    if (market && typeof market === 'object') {
      const maker = finitePositive(market.maker) ? market.maker : null;
      const taker = finitePositive(market.taker) ? market.taker : null;
      if (maker !== null || taker !== null) {
        return {
          makerPercent: maker ?? taker ?? FALLBACK.makerPercent,
          takerPercent: taker ?? maker ?? FALLBACK.takerPercent,
          // Spot crypto convention: fees are paid on top of the buy cost and
          // deducted from sell proceeds (matches HB AddedToCost).
          addedToCost: true,
        };
      }
    }
  } catch {
    // fall through to fallback — fee lookup must never break execution
  }
  return { ...FALLBACK };
}

/**
 * Fee in quote currency for one fill.
 * @param {{schema: {makerPercent:number,takerPercent:number}, isMaker?: boolean, cost: number}} p
 * @returns {number} fee >= 0 (Decimal-like value; float precision caveat above)
 */
export function computeFee({ schema, isMaker = false, cost }) {
  if (!schema) throw new Error('computeFee: schema required');
  if (!Number.isFinite(cost) || cost < 0) throw new Error(`computeFee: invalid cost ${cost}`);
  const percent = isMaker ? schema.makerPercent : schema.takerPercent;
  if (!finitePositive(percent)) throw new Error('computeFee: schema percent missing/invalid');
  return cost * percent;
}

/**
 * Quote-currency impact of one fill including its fee.
 *   BUY  -> total outflow  = cost + fee when addedToCost else cost
 *   SELL -> net inflow     = cost - fee (fees always reduce proceeds)
 * @param {{side: 'buy'|'sell'|'BUY'|'SELL', cost: number, fee: number, schema: object}} p
 * @returns {number} positive number = quote currency amount moved
 */
export function netProceeds({ side, cost, fee, schema }) {
  if (typeof side !== 'string') throw new Error('netProceeds: side required');
  if (!Number.isFinite(cost) || cost < 0) throw new Error(`netProceeds: invalid cost ${cost}`);
  if (!Number.isFinite(fee) || fee < 0) throw new Error(`netProceeds: invalid fee ${fee}`);
  const isBuy = side.toUpperCase() === 'BUY';
  if (isBuy) return schema && schema.addedToCost === false ? cost : cost + fee;
  return cost - fee;
}
