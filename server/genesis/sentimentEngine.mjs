// server/genesis/sentimentEngine.mjs
// SENTIMENT ENGINE (plan P6 — FinGPT-lite, costo-cero)
//
// Fuentes gratuitas (sin API key):
//   - GDELT DOC API      https://api.gdeltproject.org/api/v2/doc/doc?...mode=artlist&format=json
//   - CryptoCompare News https://min-api.cryptocompare.com/data/v2/news/?lang=EN
//
// Scoring: vader-lite embebido (~100 términos financieros con pesos -4..4).
//   headlineScore = sum(pesos matcheados) / sqrt(n términos con peso) -> clamp -1..1
//
// Advertencia del plan: esta feature es secundaria; su peso jamás debe ser el
// trigger principal de una estrategia.
//
// Usage (CLI):
//   node sentimentEngine.mjs BTC          # snapshot legible (score + top 3 titulares)
//
// Usage (module):
//   import { getSentimentSnapshot, refreshSentimentCache } from './sentimentEngine.mjs';
//   const snap = await getSentimentSnapshot({ symbol: 'BTC', hours: 24 });

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../data');
const CACHE_TTL_MS = 60 * 60 * 1000; // 1h: si el snapshot en disco es más viejo, refetch

const GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';
const CRYPTOCOMPARE_NEWS = 'https://min-api.cryptocompare.com/data/v2/news/';

// ---------------------------------------------------------------------------
// VADER-LITE LEXICON — subconjunto financiero. Frases multi-palabra se matchean
// antes que palabras sueltas (longest-match-first) para no doble-contar.
// Pesos estilo VADER: -4..4. Términos técnicos neutros van en 0 (documentales).
// ---------------------------------------------------------------------------
export const VADER_LITE = Object.freeze({
  // --- bullish (+2..+4) ---
  'surge': 3, 'surges': 3, 'surging': 3,
  'rally': 3, 'rallies': 3,
  'soar': 4, 'soars': 4, 'soaring': 4,
  'breakout': 3, 'breaks out': 3,
  'adoption': 2, 'adopted': 2,
  'institutional': 2, 'institutionally': 2,
  'etf approval': 4, 'etf approved': 4,
  'record high': 4, 'all-time high': 4, 'all time high': 4, 'ath': 3,
  'bullish': 3, 'upgrade': 2, 'upgraded': 2, 'upgrades': 2,
  'inflow': 2, 'inflows': 2,
  'moon': 3, 'mooning': 3, 'pump': 2, 'pumps': 2, 'pumping': 2,
  'gains': 2, 'gain': 2, 'jump': 2, 'jumps': 2, 'jumps higher': 3,
  'climbs': 2, 'climb': 2, 'rises': 2, 'rise': 1, 'rising': 2,
  'recovers': 2, 'recovery': 2, 'rebound': 2, 'rebounds': 2,
  'accumulation': 2, 'accumulate': 2, 'buying spree': 3,
  'partnership': 2, 'partnerships': 2, 'integrates': 1, 'integration': 1,
  'halving': 2, 'burn': 1, 'buyback': 2, 'whale buying': 3,
  'green': 1, 'optimism': 2, 'optimistic': 2, 'confidence': 1,
  'milestone': 1, 'approval': 3, 'approves': 3, 'approved': 3,
  'legalized': 3, 'legalizes': 3, 'mainstream': 1,

  // --- bearish (-2..-4) ---
  'crash': -4, 'crashes': -4, 'crashed': -4, 'crashing': -4,
  'plunge': -4, 'plunges': -4, 'plunged': -4, 'plunging': -4,
  'collapse': -4, 'collapses': -4, 'collapsed': -4, 'collapsing': -4,
  'hack': -4, 'hacked': -4, 'hacker': -3, 'hacking': -3, 'breach': -3,
  'exploit': -4, 'exploited': -4, 'drained': -3,
  'liquidation cascade': -4, 'liquidated': -3, 'liquidations': -3,
  'ban': -3, 'banned': -3, 'bans': -3, 'banning': -3,
  'lawsuit': -3, 'sued': -2, 'sues': -2, 'indictment': -3, 'charged': -2,
  'dump': -3, 'dumps': -3, 'dumping': -3, 'dumped': -3,
  'outflow': -2, 'outflows': -2,
  'fear': -2, 'panic': -3, 'capitulation': -4, 'capitulate': -3,
  'sell-off': -3, 'selloff': -3, 'sell off': -3,
  'bearish': -3, 'downgrade': -2, 'downgraded': -2, 'downgrades': -2,
  'tumble': -3, 'tumbles': -3, 'tumbled': -3,
  'slump': -3, 'slumps': -3, 'slumped': -3,
  'plummet': -4, 'plummets': -4, 'plummeted': -4,
  'sink': -2, 'sinks': -2, 'sank': -2,
  'slide': -2, 'slides': -2, 'sliding': -2,
  'drop': -2, 'drops': -2, 'dropped': -2,
  'fall': -1, 'falls': -2, 'fell': -2, 'falling': -2,
  'losses': -2, 'loss': -2, 'loses': -2,
  'bankruptcy': -4, 'bankrupt': -4, 'insolvent': -4, 'insolvency': -4,
  'ponzi': -4, 'scam': -4, 'fraud': -4, 'rug pull': -4, 'rugpull': -4,
  'sec sues': -3, 'subpoena': -3, 'probe': -2, 'investigation': -2,
  'warning': -1, 'warns': -1, 'risk': -1, 'risks': -1,
  'delisting': -3, 'delisted': -3, 'halt': -2, 'halted': -2,
  'freezes withdrawals': -4, 'withdrawal halt': -4,
  'red': -1, 'pessimism': -2, 'uncertainty': -1,

  // --- técnicos / neutros (0) — se matchean pero no aportan peso ---
  'consolidation': 0, 'sideways': 0, 'volatility': 0, 'volatile': 0,
  'resistance': 0, 'support': 0, 'analysis': 0, 'forecast': 0,
  'prediction': 0, 'price target': 0, 'update': 0, 'launch': 0,
});

// Términos ordenados longest-first para matching frase > palabra.
const _LEX_ENTRIES = Object.entries(VADER_LITE)
  .map(([term, w]) => ({ term: term.toLowerCase(), w }))
  .sort((a, b) => b.term.length - a.term.length);

/** Normaliza un título: lowercase, sin puntuación, espacios colapsados. */
export function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * vader-lite: suma de pesos de términos matcheados dividida por
 * sqrt(número de términos con peso != 0), clamp a [-1, 1].
 */
export function scoreHeadline(title) {
  const text = normalizeTitle(title);
  if (!text) return 0;
  let sum = 0;
  let nWeighted = 0;
  let remaining = ` ${text} `;
  for (const { term, w } of _LEX_ENTRIES) {
    if (!remaining.includes(term)) continue;
    // consumir el término para no doble-contar frases dentro de otras
    remaining = remaining.split(term).join(' ');
    if (w !== 0) {
      sum += w;
      nWeighted += 1;
    }
  }
  if (nWeighted === 0) return 0;
  const raw = sum / Math.sqrt(nWeighted);
  return Math.max(-1, Math.min(1, raw));
}

/** Dedupe por título normalizado; conserva la primera aparición. */
export function dedupeHeadlines(headlines) {
  const seen = new Set();
  const out = [];
  for (const h of headlines) {
    const key = normalizeTitle(h.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
  }
  return out;
}

async function jget(u, timeoutMs = 15_000) {
  const res = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
  // res.ok puede ser undefined con fetch mocks de test que devuelven { json }
  if (res.ok === false) throw new Error(`HTTP ${res.status} for ${u.split('?')[0]}`);
  const ct = String(res.headers?.get?.('content-type') || '');
  if (ct.includes('xml') || ct.includes('rss')) return res.text();
  return res.json();
}

/** Titulares GDELT DOC API (artlist). Sin key. */
export async function fetchGdeltHeadlines(symbol, hours) {
  const q = `(crypto OR bitcoin OR ethereum OR ${symbol}) sourcelang:english`;
  const fullUrl = `${GDELT_DOC}?query=${encodeURIComponent(q)}&mode=artlist&format=json&timespan=${hours}h`;
  const data = await jget(fullUrl);
  const articles = Array.isArray(data.articles) ? data.articles : [];
  return articles.map(a => ({
    title: a.title || '',
    source: a.domain || 'gdelt',
    ts: a.seendate ? Date.parse(
      `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}T${a.seendate.slice(9, 11)}:${a.seendate.slice(11, 13)}:${a.seendate.slice(13, 15)}Z`
    ) : Date.now(),
  })).filter(h => h.title);
}

/** Titulares CryptoCompare News por categorías del symbol. Sin key. */
export async function fetchCryptoCompareHeadlines(symbol) {
  const u = `${CRYPTOCOMPARE_NEWS}?lang=EN&categories=${encodeURIComponent(symbol)}`;
  const data = await jget(u);
  const items = Array.isArray(data?.Data) ? data.Data : [];
  return items.map(n => ({
    title: n.title || '',
    source: n.source_info?.name || n.source || 'cryptocompare',
    ts: (n.published_on || 0) * 1000,
  })).filter(h => h.title);
}

/** Fallback RSS: CoinDesk + Cointelegraph (parse XML mínimo, sin deps). Sin key. */
export async function fetchRssHeadlines() {
  const FEEDS = [
    'https://www.coindesk.com/arc/outboundfeeds/rss/',
    'https://cointelegraph.com/rss',
  ];
  const results = await Promise.allSettled(FEEDS.map(f => jget(f, 12_000)));
  // jget espera JSON; para RSS leemos el texto crudo del body resuelto.
  // Si TODOS los feeds fallan, la fuente entera cuenta como fallida.
  const out = [];
  if (results.every(r => r.status === 'rejected')) {
    throw new Error(`rss feeds down: ${results.map(r => r.reason?.message).join('; ')}`);
  }
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const xml = typeof r.value === 'string' ? r.value : (r.value?.xmlText ?? '');
    if (!xml) continue;
    const items = xml.split('<item>').slice(1);
    for (const it of items.slice(0, 20)) {
      const title = (/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/.exec(it) || [])[1] || (/<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/.exec(it) || [])[2];
      const date = (/\<pubDate\>(.*?)\<\/pubDate\>/.exec(it) || [])[1];
      if (!title) continue;
      out.push({
        title: title.trim(),
        source: xml.includes('coindesk') ? 'coindesk' : 'cointelegraph',
        ts: date ? Date.parse(date) || Date.now() : Date.now(),
      });
    }
  }
  return out;
}

/** Snapshot agregado desde red (sin tocar caché). */
export async function buildSentimentSnapshot({ symbol = 'BTC', hours = 24 } = {}) {
  const SYM = String(symbol).toUpperCase().trim() || 'BTC';
  const [gdeltRes, ccRes, rssRes] = await Promise.allSettled([
    fetchGdeltHeadlines(SYM, hours),
    fetchCryptoCompareHeadlines(SYM),
    fetchRssHeadlines(),
  ]);

  const gdelt = gdeltRes.status === 'fulfilled' ? gdeltRes.value : [];
  const cryptocompare = ccRes.status === 'fulfilled' ? ccRes.value : [];
  const rss = rssRes.status === 'fulfilled' ? rssRes.value : [];
  if (gdeltRes.status === 'rejected' && ccRes.status === 'rejected' && rssRes.status === 'rejected') {
    throw new Error(`Todas las fuentes fallaron: gdelt=${gdeltRes.reason?.message}; cryptocompare=${ccRes.reason?.message}; rss=${rssRes.reason?.message}`);
  }

  const scored = [
    ...gdelt.map(h => ({ ...h, sourceTag: 'gdelt' })),
    ...cryptocompare.map(h => ({ ...h, sourceTag: 'cryptocompare' })),
    ...rss.map(h => ({ ...h, sourceTag: 'rss' })),
  ].map(h => ({ ...h, score: scoreHeadline(h.title) }));

  const headlines = dedupeHeadlines(scored);

  // Score agregado: media simple de titulares con señal (score != 0).
  const withSignal = headlines.filter(h => h.score !== 0);
  const agg = withSignal.length
    ? withSignal.reduce((a, h) => a + h.score, 0) / withSignal.length
    : 0;

  return {
    symbol: SYM,
    score: Math.max(-1, Math.min(1, agg)),
    mentions: headlines.length,
    sources: { gdelt: gdelt.length, cryptocompare: cryptocompare.length },
    headlines: headlines.map(({ title, score, source, ts }) => ({ title, score, source, ts })),
    ts: Date.now(),
  };
}

function cachePath(symbol) {
  return path.join(DATA_DIR, `sentiment_${String(symbol).toUpperCase().trim()}.json`);
}

function readCachedSnapshot(symbol, ttlMs = CACHE_TTL_MS) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(symbol), 'utf8'));
    const snap = raw.data ?? raw;
    const at = raw.at ?? snap.ts ?? 0;
    if (Date.now() - at < ttlMs) return snap;
  } catch { /* miss */ }
  return null;
}

/** Escritura atómica: temp + rename. */
function writeSnapshotAtomic(symbol, snapshot) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const finalPath = cachePath(symbol);
  const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, JSON.stringify({ at: Date.now(), data: snapshot }));
  fs.renameSync(tmpPath, finalPath);
  return finalPath;
}

/**
 * Snapshot con caché TTL 1h. Si hay snapshot en disco <1h viejo, se devuelve
 * sin refetch; si no, refetch + escritura atómica.
 */
export async function getSentimentSnapshot({ symbol = 'BTC', hours = 24, forceRefresh = false } = {}) {
  const SYM = String(symbol).toUpperCase().trim() || 'BTC';
  if (!forceRefresh) {
    const hit = readCachedSnapshot(SYM);
    if (hit) return { ...hit, cached: true };
  }
  const snap = await buildSentimentSnapshot({ symbol: SYM, hours });
  writeSnapshotAtomic(SYM, snap);
  return snap;
}

/** Refetch explícito y reescritura del caché en disco. */
export async function refreshSentimentCache(symbol, hours = 24) {
  const SYM = String(symbol).toUpperCase().trim() || 'BTC';
  const snap = await buildSentimentSnapshot({ symbol: SYM, hours });
  writeSnapshotAtomic(SYM, snap);
  return snap;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function printReadable(snapshot) {
  const pct = (snapshot.score * 100).toFixed(1);
  const label = snapshot.score > 0.25 ? 'BULLISH'
    : snapshot.score < -0.25 ? 'BEARISH' : 'NEUTRAL';
  console.log(`\n=== Sentiment ${snapshot.symbol} (${new Date(snapshot.ts).toISOString()}) ===`);
  console.log(`Score agregado: ${snapshot.score.toFixed(3)} [${label}] (${pct}%)`);
  console.log(`Menciones: ${snapshot.mentions} (gdelt: ${snapshot.sources.gdelt}, cryptocompare: ${snapshot.sources.cryptocompare})`);
  const top = [...snapshot.headlines]
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 3);
  console.log('Top 3 titulares:');
  for (const h of top) {
    console.log(`  [${h.score >= 0 ? '+' : ''}${h.score.toFixed(2)}] ${h.title}`);
    console.log(`         (${h.source})`);
  }
  console.log('');
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(url.fileURLToPath(import.meta.url))) {
  const symbol = process.argv[2] || 'BTC';
  getSentimentSnapshot({ symbol })
    .then(printReadable)
    .catch(err => {
      console.error(`[sentimentEngine] ERROR: ${err.message}`);
      process.exitCode = 1;
    });
}
