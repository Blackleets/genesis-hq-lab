// redditFeed — fetches hot posts from public subreddits (keyless JSON API).
// Reddit's .json endpoints are public; only a User-Agent header is required.
// Used to gauge retail sentiment around prediction-market topics.

// Subreddits mapped to market categories
const CATEGORY_SUBREDDITS = {
  crypto:    ['CryptoCurrency', 'Bitcoin'],
  politics:  ['politics', 'PredictionMarkets'],
  sports:    ['sportsbook', 'soccer'],
  soccer:    ['soccer', 'football'],
  economics: ['economics', 'wallstreetbets'],
  general:   ['PredictionMarkets'],
};

async function fetchSubreddit(subreddit, limit = 6) {
  try {
    const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GenesisHQ:research-agent:v1.0 (by /u/genesis-hq)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const posts = data?.data?.children ?? [];
    return posts
      .map((p) => p.data)
      .filter((p) => p && !p.stickied)
      .map((p) => ({
        title:     p.title,
        score:     p.score ?? 0,
        comments:  p.num_comments ?? 0,
        subreddit: p.subreddit,
        ageHours:  p.created_utc ? Math.round((Date.now() / 1000 - p.created_utc) / 3600) : null,
        upvoteRatio: p.upvote_ratio ?? null,
      }));
  } catch (err) {
    console.warn(`[redditFeed] r/${subreddit} unavailable:`, err.message);
    return [];
  }
}

/** Fetch hot posts for a market category. */
export async function fetchRedditSignals(category = 'general', limit = 6) {
  const subs = CATEGORY_SUBREDDITS[category?.toLowerCase()] ?? CATEGORY_SUBREDDITS.general;
  const results = await Promise.allSettled(subs.map((s) => fetchSubreddit(s, limit)));
  return results
    .filter((r) => r.status === 'fulfilled')
    .flatMap((r) => r.value)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
