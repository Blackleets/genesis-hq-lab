// researchAgent — gathers free signals for the markets under consideration.
// Pipeline: market question → search query → news + HN → score → store signal.
// Runs inside the trading cycle so the debate has fresh context. Zero cost.

import { fetchHeadlines } from './newsFeed.mjs';
import { fetchHackerNews } from './hackerNews.mjs';
import { fetchRedditSignals } from './redditFeed.mjs';
import { scoreHeadlines, saveSignal, getRecentSignals } from './signalExtractor.mjs';

const STOPWORDS = new Set([
  'will', 'the', 'a', 'an', 'be', 'to', 'of', 'in', 'on', 'at', 'by', 'for',
  'win', 'reach', 'before', 'after', 'than', 'this', 'that', 'and', 'or', 'is',
  'are', 'was', 'were', '2024', '2025', '2026', 'happen', 'who', 'what', 'when',
]);

// Build a concise search query from a market question
function questionToQuery(question) {
  if (!question) return '';
  const words = question
    .replace(/[?¿.,!:'"()–—]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w.toLowerCase()));
  // Keep the most meaningful 4 words
  return words.slice(0, 4).join(' ');
}

// Which categories warrant a Hacker News lookup (tech/finance topics)
const HN_CATEGORIES = new Set(['crypto', 'economics', 'tech', 'business', 'science']);

/**
 * Research a single market. Returns a signal object (or null) and stores it.
 */
export async function researchMarket(market) {
  const query    = questionToQuery(market.question);
  const category = (market.category ?? 'general').toLowerCase();
  if (!query) return null;

  // Gather from free sources in parallel
  const tasks = [fetchHeadlines(query, 5)];
  if (HN_CATEGORIES.has(category)) tasks.push(fetchHackerNews(query, 4));
  tasks.push(fetchRedditSignals(category, 4)); // best-effort (often empty)

  const [news, hn = [], reddit = []] = await Promise.all(tasks);
  const allHeadlines = [...news, ...hn, ...reddit];

  const scored = scoreHeadlines(allHeadlines);
  if (!scored || scored.count === 0) return null;

  // Build a human-readable signal
  const signalText =
    `${scored.sentiment.toUpperCase()} on "${query}" — ${scored.count} headlines ` +
    `(${scored.bull}↑/${scored.bear}↓, ${scored.freshness} fresh)`;

  // Persist signal linked to this market's category
  const signalId = saveSignal({
    source:     news.length > 0 ? 'news' : 'hn',
    text:       signalText,
    category,
    confidence: scored.strength,
  });

  return {
    signalId,
    marketId:   market.id,
    sentiment:  scored.sentiment,
    strength:   scored.strength,
    text:       signalText,
    sampleHeadline: allHeadlines[0]?.title ?? null,
  };
}

/**
 * Research the top N markets in a qualified list.
 * Returns a map: marketId → signal, plus stores everything.
 */
export async function runResearchCycle(markets, topN = 3) {
  const targets = markets.slice(0, topN);
  const signals = {};

  for (const market of targets) {
    try {
      const signal = await researchMarket(market);
      if (signal) {
        signals[market.id] = signal;
        console.log(`[research] ${signal.sentiment} signal for "${market.question?.slice(0, 45)}" (${signal.strength})`);
      }
    } catch (err) {
      console.warn(`[research] failed for ${market.id}:`, err.message);
    }
    await new Promise((r) => setTimeout(r, 200)); // gentle rate limit
  }

  return signals;
}

/**
 * Get stored signals relevant to a market, formatted for the debate prompt.
 */
export function getMarketSignals(market) {
  const category = (market.category ?? 'general').toLowerCase();
  return getRecentSignals(category, 3);
}
