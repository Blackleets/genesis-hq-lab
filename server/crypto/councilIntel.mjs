// councilIntel.mjs — real external intelligence for the Decision Council.
//
// Two live sources, both already part of Genesis, now wired into council
// decisions:
//
//   · News sentiment — Google News RSS via research/newsFeed (keyless) scored
//     by research/signalExtractor's deterministic lexicon. Real headlines,
//     real scores; when the fetch fails the council reports insufficient_data
//     instead of inventing narrative.
//   · Real spread — best bid/ask from the live Binance order book via
//     crypto/liquidityMatrix.fetchDepth. When unavailable, callers fall back
//     to the liquidity-tier estimate (flagged as an estimate).
//
// Both are cached per symbol/pair so engine loops don't hammer the sources,
// and failures are cached too (short TTL) so an offline environment degrades
// to fast, honest abstention rather than per-signal timeouts.

import { fetchHeadlines } from '../research/newsFeed.mjs';
import { scoreHeadlines } from '../research/signalExtractor.mjs';
import { fetchDepth } from './liquidityMatrix.mjs';

const NEWS_TTL_MS = parseInt(process.env.COUNCIL_NEWS_TTL_MS ?? '600000', 10);   // 10 min
const NEWS_FAIL_TTL_MS = 120_000;
const DEPTH_TTL_MS = 30_000;
const DEPTH_FAIL_TTL_MS = 60_000;

// Human search queries per symbol — headline quality beats ticker matching.
const SYMBOL_QUERY = {
  BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana',
  ADA: 'Cardano', XRP: 'XRP crypto', DOGE: 'Dogecoin',
};

const _newsCache = new Map();   // symbol → { ts, ok, data }
const _depthCache = new Map();  // pair → { ts, ok, spreadPct }

/**
 * Real news sentiment for a crypto symbol.
 * @returns {Promise<null | {
 *   sentiment: 'bullish'|'bearish'|'neutral', strength: number,
 *   bull: number, bear: number, count: number,
 *   headlines: { title: string, source: string|null }[], fetchedAt: string,
 * }>} null = source unavailable (council must abstain)
 */
export async function getNewsSentiment(symbol) {
  if (!symbol) return null;
  const hit = _newsCache.get(symbol);
  const now = Date.now();
  if (hit && now - hit.ts < (hit.ok ? NEWS_TTL_MS : NEWS_FAIL_TTL_MS)) {
    return hit.ok ? hit.data : null;
  }
  try {
    const query = SYMBOL_QUERY[symbol] ?? `${symbol} crypto`;
    const headlines = await fetchHeadlines(query, 8);
    if (!headlines || headlines.length === 0) throw new Error('no headlines');
    const score = scoreHeadlines(headlines);
    const data = {
      sentiment: score.sentiment,
      strength: score.strength,
      bull: score.bull,
      bear: score.bear,
      count: score.count,
      headlines: headlines.slice(0, 4).map((h) => ({ title: h.title, source: h.source ?? null })),
      fetchedAt: new Date(now).toISOString(),
    };
    _newsCache.set(symbol, { ts: now, ok: true, data });
    return data;
  } catch {
    _newsCache.set(symbol, { ts: now, ok: false, data: null });
    return null;
  }
}

/**
 * Real spread (fraction of mid price) from the live order book.
 * @returns {Promise<number|null>} null = book unavailable (use tier estimate)
 */
export async function getRealSpreadPct(pair) {
  if (!pair) return null;
  const hit = _depthCache.get(pair);
  const now = Date.now();
  if (hit && now - hit.ts < (hit.ok ? DEPTH_TTL_MS : DEPTH_FAIL_TTL_MS)) {
    return hit.ok ? hit.spreadPct : null;
  }
  try {
    const depth = await fetchDepth(pair, 10);
    const spreadPct = Number.isFinite(depth?.spreadPct) && depth.spreadPct >= 0 ? depth.spreadPct : null;
    _depthCache.set(pair, { ts: now, ok: spreadPct != null, spreadPct });
    return spreadPct;
  } catch {
    _depthCache.set(pair, { ts: now, ok: false, spreadPct: null });
    return null;
  }
}

/** Test hook: clear caches so tests control freshness. */
export function _resetCouncilIntelCacheForTest() {
  _newsCache.clear();
  _depthCache.clear();
}
