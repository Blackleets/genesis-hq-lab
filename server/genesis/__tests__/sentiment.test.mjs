// server/genesis/__tests__/sentiment.test.mjs
// Tests de sentimentEngine: vader-lite scoring, dedupe, clamp, caché TTL.
// fetch global mockeado — cero red.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  VADER_LITE,
  normalizeTitle,
  scoreHeadline,
  dedupeHeadlines,
  getSentimentSnapshot,
  refreshSentimentCache,
} from '../sentimentEngine.mjs';

const realFetch = globalThis.fetch;

/** Instala un fetch falso que responde según la URL pedida. */
function mockFetch(handler) {
  globalThis.fetch = async (u) => {
    const url = String(u);
    const body = handler(url);
    if (body === null) throw new Error(`unexpected fetch: ${url}`);
    return { ok: true, status: 200, json: async () => body };
  };
}

function gdeltBody(titles) {
  return { articles: titles.map((t, i) => ({ title: t, domain: 'example.com', seendate: '20260825T120000Z', i })) };
}

function ccBody(titles) {
  return { Data: titles.map((t) => ({ title: t, source_info: { name: 'CC Wire' }, published_on: 1756100000 })) };
}

const GDELT_URL_PART = 'api.gdeltproject.org';
const CC_URL_PART = 'min-api.cryptocompare.com';

describe('vader-lite lexicon', () => {
  it('tiene ~100 términos financieros', () => {
    const n = Object.keys(VADER_LITE).length;
    expect(n).toBeGreaterThanOrEqual(90);
    expect(n).toBeLessThanOrEqual(200);
  });

  it('todos los pesos están en -4..4', () => {
    for (const w of Object.values(VADER_LITE)) {
      expect(w).toBeGreaterThanOrEqual(-4);
      expect(w).toBeLessThanOrEqual(4);
    }
  });
});

describe('scoreHeadline', () => {
  it('titular bullish da score > 0', () => {
    expect(scoreHeadline('Bitcoin surges to record high as ETF approval nears')).toBeGreaterThan(0);
  });

  it('titular bearish da score < 0', () => {
    expect(scoreHeadline('Crypto exchange hack triggers liquidation cascade and panic selling')).toBeLessThan(0);
  });

  it('titular neutro/técnico da 0', () => {
    expect(scoreHeadline('Bitcoin price analysis: consolidation continues sideways')).toBe(0);
  });

  it('clamp a [-1, 1] incluso con muchos términos extremos', () => {
    const extreme = 'crash crash crash crash plunge plunge collapse collapse hack exploit capitulation';
    expect(scoreHeadline(extreme)).toBeLessThanOrEqual(1);
    expect(scoreHeadline(extreme)).toBeGreaterThanOrEqual(-1);
    expect(scoreHeadline(extreme)).toBe(-1);

    const moon = 'soar soars rally surge breakout record high etf approval inflow pump';
    expect(scoreHeadline(moon)).toBe(1);
  });

  it('frases multi-palabra no doble-cuentan sub-términos', () => {
    // 'liquidation cascade' (-4) no debe sumar también 'liquidations' u otros
    const s = Math.abs(scoreHeadline('Liquidation cascade wipes out leveraged traders'));
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('título vacío o sin señal -> 0', () => {
    expect(scoreHeadline('')).toBe(0);
    expect(scoreHeadline(null)).toBe(0);
    expect(scoreHeadline('The quarterly report was published today')).toBe(0);
  });
});

describe('normalizeTitle + dedupeHeadlines', () => {
  it('normaliza lowercase y quita puntuación', () => {
    expect(normalizeTitle('Bitcoin Surges! BTC hits $100K...')).toBe('bitcoin surges btc hits 100k');
  });

  it('dedupe elimina duplicados por título normalizado', () => {
    const input = [
      { title: 'Bitcoin Crashes Below $50K!', source: 'a' },
      { title: 'bitcoin crashes below $50k', source: 'b' },
      { title: 'BITCOIN   crashes below 50k?!', source: 'c' },
      { title: 'Ethereum rally continues', source: 'd' },
    ];
    const out = dedupeHeadlines(input);
    expect(out).toHaveLength(2);
    expect(out[0].source).toBe('a'); // conserva primera aparición
    expect(out[1].source).toBe('d');
  });
});

describe('getSentimentSnapshot (fetch mockeado)', () => {
  let tmpFile;

  beforeEach(() => {
    // caché en disco aislada por test: usamos símbolo único para no pisar data/
    tmpFile = undefined;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (tmpFile) {
      try { fs.unlinkSync(tmpFile); } catch { /* ya no existe */ }
    }
  });

  function uniqueSymbol() {
    return `TST${Math.floor(Math.random() * 1e9)}`;
  }

  const DATA_DIR = path.resolve(import.meta.dirname, '../../../data');
  const cacheFileFor = (sym) => path.join(DATA_DIR, `sentiment_${sym}.json`);
  function cleanupCache(sym) {
    tmpFile = cacheFileFor(sym);
  }

  it('agrega GDELT + CryptoCompare, dedupes y puntúa', async () => {
    const sym = uniqueSymbol();
    mockFetch((url) => {
      if (url.includes(GDELT_URL_PART)) {
        expect(url).toContain('timespan=24h');
        return gdeltBody([
          'Bitcoin surges past resistance as institutional inflows grow',
          'Analyst upgrades outlook after ETF approval speculation',
        ]);
      }
      if (url.includes(CC_URL_PART)) {
        // el segundo duplica el primero (dedupe debe quitarlo)
        return ccBody([
          'Bitcoin surges past resistance as institutional inflows grow!',
          'Regulator lawsuit sparks fear among altcoin holders',
        ]);
      }
      return null;
    });

    const snap = await getSentimentSnapshot({ symbol: sym, hours: 24 });

    expect(snap.symbol).toBe(sym);
    expect(snap.mentions).toBe(3); // 2 gdelt + 2 cc - 1 dup
    expect(snap.sources.gdelt).toBe(2);
    expect(snap.sources.cryptocompare).toBe(2);
    for (const h of snap.headlines) {
      expect(typeof h.score).toBe('number');
      expect(h.score).toBeGreaterThanOrEqual(-1);
      expect(h.score).toBeLessThanOrEqual(1);
      expect(h.title).toBeTruthy();
      expect(h.source).toBeTruthy();
      expect(typeof h.ts).toBe('number');
    }
    expect(snap.score).toBeGreaterThanOrEqual(-1);
    expect(snap.score).toBeLessThanOrEqual(1);
    // 3 bullish vs 1 bearish -> agregado positivo
    expect(snap.score).toBeGreaterThan(0);
    expect(typeof snap.ts).toBe('number');
    cleanupCache(sym);
  });

  it('usa el snapshot en disco si es <1h viejo (sin refetch)', async () => {
    const sym = uniqueSymbol();
    let fetchCount = 0;
    mockFetch(() => { fetchCount += 1; return gdeltBody(['Bitcoin rally gathers pace']); });

    const first = await getSentimentSnapshot({ symbol: sym });
    expect(fetchCount).toBeGreaterThan(0);

    const countAfterFirst = fetchCount;
    const second = await getSentimentSnapshot({ symbol: sym });
    expect(fetchCount).toBe(countAfterFirst); // sin refetch
    expect(second.cached).toBe(true);
    expect(second.ts).toBe(first.ts);
    cleanupCache(sym);
  });

  it('forceRefresh ignora el caché y refetchea', async () => {
    const sym = uniqueSymbol();
    let fetchCount = 0;
    mockFetch(() => { fetchCount += 1; return gdeltBody(['Ethereum upgrade drives adoption']); });

    await getSentimentSnapshot({ symbol: sym });
    const n1 = fetchCount;
    await getSentimentSnapshot({ symbol: sym, forceRefresh: true });
    expect(fetchCount).toBe(n1 * 2);
    cleanupCache(sym);
  });

  it('refreshSentimentCache refetchea y persiste atómicamente', async () => {
    const sym = uniqueSymbol();
    mockFetch((url) => (url.includes(GDELT_URL_PART)
      ? gdeltBody(['Exchange collapse triggers capitulation'])
      : ccBody([])));

    const snap = await refreshSentimentCache(sym);
    expect(snap.score).toBeLessThan(0);
    const file = cacheFileFor(sym);
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.data.symbol).toBe(sym);
    tmpFile = file; // cleanup
  });

  it('lanza error honesto cuando todas las fuentes fallan', async () => {
    const sym = uniqueSymbol();
    globalThis.fetch = async () => { throw new Error('network down'); };
    await expect(getSentimentSnapshot({ symbol: sym })).rejects.toThrow(/Todas las fuentes fallaron/);
  });

  it('degrada con gracia si una fuente falla', async () => {
    const sym = uniqueSymbol();
    globalThis.fetch = async (u) => {
      const url = String(u);
      if (url.includes(GDELT_URL_PART)) return { ok: true, status: 200, json: async () => gdeltBody(['Whale buying pushes market green']) };
      throw new Error('cryptocompare down');
    };
    const snap = await getSentimentSnapshot({ symbol: sym });
    expect(snap.sources.gdelt).toBe(1);
    expect(snap.sources.cryptocompare).toBe(0);
    expect(snap.mentions).toBe(1);
    cleanupCache(sym);
  });
});
