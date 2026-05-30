// newsFeed — fetches headlines from Google News RSS (keyless, free).
// No API key required. Used to detect sentiment/momentum around market topics.
// Falls back to empty array on any failure — never breaks the research cycle.

// Google News RSS search endpoint (public, no auth)
const GNEWS_RSS = 'https://news.google.com/rss/search';

// Minimal RSS item extraction (avoid pulling an XML parser dependency)
function parseRssItems(xml, limit = 8) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
    const block = match[1];
    const title = (block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '')
      .replace(/<!\[CDATA\[|\]\]>/g, '')
      .trim();
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() ?? null;
    const source = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim() ?? null;
    if (title) items.push({ title, pubDate, source });
  }
  return items;
}

/**
 * Fetch recent headlines for a search query.
 * @param {string} query  e.g. "Champions League", "Bitcoin price", "US election"
 * @param {number} limit  max headlines
 */
export async function fetchHeadlines(query, limit = 6) {
  try {
    const url = `${GNEWS_RSS}?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (GenesisHQ Research Agent)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRssItems(xml, limit).map((item) => ({
      ...item,
      query,
      ageHours: item.pubDate
        ? Math.round((Date.now() - new Date(item.pubDate).getTime()) / 3_600_000)
        : null,
    }));
  } catch (err) {
    console.warn(`[newsFeed] "${query}" unavailable:`, err.message);
    return [];
  }
}

/** Fetch headlines for multiple queries in parallel. */
export async function fetchHeadlinesBatch(queries, perQuery = 4) {
  const results = await Promise.allSettled(
    queries.map((q) => fetchHeadlines(q, perQuery)),
  );
  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value);
}
