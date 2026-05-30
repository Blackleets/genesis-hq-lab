// hackerNews — fetches recent stories from the HN Algolia API (keyless, free, reliable).
// Good signal source for crypto, tech, economics, and macro topics.
// https://hn.algolia.com/api — no auth required.

const HN_SEARCH = 'https://hn.algolia.com/api/v1/search_by_date';

/**
 * Search recent Hacker News stories for a query.
 * @param {string} query   e.g. "bitcoin", "election", "recession"
 * @param {number} limit   max stories
 */
export async function fetchHackerNews(query, limit = 5) {
  try {
    // Only stories from the last 7 days, sorted by recency, min 5 points (filters noise)
    const since = Math.floor(Date.now() / 1000) - 7 * 86400;
    const url = `${HN_SEARCH}?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since},points>5&hitsPerPage=${limit}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GenesisHQ Research Agent' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.hits ?? []).map((hit) => ({
      title:    hit.title,
      points:   hit.points ?? 0,
      comments: hit.num_comments ?? 0,
      query,
      ageHours: hit.created_at_i
        ? Math.round((Date.now() / 1000 - hit.created_at_i) / 3600)
        : null,
    }));
  } catch (err) {
    console.warn(`[hackerNews] "${query}" unavailable:`, err.message);
    return [];
  }
}

/** Fetch HN stories for multiple queries in parallel. */
export async function fetchHackerNewsBatch(queries, perQuery = 4) {
  const results = await Promise.allSettled(
    queries.map((q) => fetchHackerNews(q, perQuery)),
  );
  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value);
}
