// priceOracle.mjs — FREE price source for pump.fun tokens.
//
// PumpPortal's free WebSocket only streams new-token creation events; live
// trade data is paywalled. To paper-trade we still need a current price, so
// we poll pump.fun's public frontend API (no key required) for each open
// position. Price is derived from the bonding-curve virtual reserves so it
// matches how the token actually prices on pump.fun pre-migration.

const PUMP_API = 'https://frontend-api-v3.pump.fun/coins/';

/**
 * Fetch the current on-curve state for a mint.
 * @returns {Promise<null | { priceSol: number|null, complete: boolean, marketCapSol: number|null }>}
 */
export async function fetchTokenState(mint) {
  if (!mint) return null;
  try {
    const res = await fetch(PUMP_API + mint, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const c = await res.json();
    const vSol = Number(c.virtual_sol_reserves);
    const vTok = Number(c.virtual_token_reserves);
    // reserves: SOL in lamports (1e9), tokens in base units (1e6 decimals)
    const priceSol = vSol > 0 && vTok > 0 ? (vSol / 1e9) / (vTok / 1e6) : null;
    return {
      priceSol,
      complete: !!c.complete,                 // migrated to Raydium → curve closed
      marketCapSol: Number(c.market_cap) || null,
    };
  } catch {
    return null; // network/timeout/rate-limit — caller skips this tick
  }
}
