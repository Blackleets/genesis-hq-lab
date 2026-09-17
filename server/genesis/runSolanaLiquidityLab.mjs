import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  DEFAULT_LIQUIDITY_POLICY,
  scoreLiquiditySnapshot,
  forwardLiquidityWindow,
  buildLiquiditySleeve,
} from '../../src/core/solanaLiquidityEconomics.mjs';

const VERSION = 'solana_liquidity_lab_v2_official_pool_metrics';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'quant-evidence/solana-liquidity-lab-latest.json';
const HISTORY = process.argv.includes('--history') ? process.argv[process.argv.indexOf('--history') + 1] : 'quant-evidence/solana-liquidity-history.jsonl';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ASSETS = [
  { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112' },
  { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  { symbol: 'RAY', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
  { symbol: 'PYTH', mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3' },
  { symbol: 'POPCAT', mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
];
const BY_MINT = new Map(ASSETS.map((x) => [x.mint, x]));
const FETCH_TIMEOUT_MS = 15_000;

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const x = n(value);
    if (x != null) return x;
  }
  return null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'GenesisHQ-SolanaLiquidityLab/1.0' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`http_${response.status}:${url}`);
  return response.json();
}

async function dexScreenerPair(poolAddress) {
  try {
    const data = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/solana/${encodeURIComponent(poolAddress)}`);
    const pair = Array.isArray(data?.pairs) ? data.pairs[0] : data?.pair;
    if (!pair) return null;
    return {
      priceUsd: firstNumber(pair.priceUsd),
      priceChange24hPct: firstNumber(pair.priceChange?.h24),
      liquidityUsd: firstNumber(pair.liquidity?.usd),
      volume24hUsd: firstNumber(pair.volume?.h24),
      dexId: pair.dexId ?? null,
    };
  } catch {
    return null;
  }
}

async function fetchMeteoraCandidates() {
  const all = [];
  for (const asset of ASSETS) {
    const base = new URL('https://dlmm.datapi.meteora.ag/pools/groups');
    base.searchParams.set('page', '1');
    base.searchParams.set('page_size', '20');
    base.searchParams.set('query', asset.symbol);
    base.searchParams.set('sort_by', 'volume_24h:desc');

    let groups;
    try {
      groups = await fetchJson(base.toString());
    } catch {
      continue;
    }

    const selected = (Array.isArray(groups?.data) ? groups.data : [])
      .filter((g) => {
        const x = String(g?.token_x ?? '');
        const y = String(g?.token_y ?? '');
        const name = String(g?.group_name ?? '').toUpperCase();
        const exact = (x === USDC && y === asset.mint) || (y === USDC && x === asset.mint);
        const labelled = name.includes(asset.symbol) && name.includes('USDC');
        return exact || labelled;
      })
      .slice(0, 4);

    for (const group of selected) {
      const lexical = String(group.lexical_order_mints ?? '');
      if (!lexical) continue;
      const url = new URL(`https://dlmm.datapi.meteora.ag/pools/groups/${encodeURIComponent(lexical)}`);
      url.searchParams.set('page', '1');
      url.searchParams.set('page_size', '20');
      url.searchParams.set('sort_by', 'fee_24h:desc');

      let detail;
      try {
        detail = await fetchJson(url.toString());
      } catch {
        continue;
      }

      for (const pool of Array.isArray(detail?.data) ? detail.data : []) {
        if (pool?.is_blacklisted === true) continue;
        const xMint = String(pool?.token_x?.address ?? group.token_x ?? '');
        const yMint = String(pool?.token_y?.address ?? group.token_y ?? '');
        const xSym = String(pool?.token_x?.symbol ?? '').toUpperCase();
        const ySym = String(pool?.token_y?.symbol ?? '').toUpperCase();
        const exactPair = (xMint === USDC && yMint === asset.mint) || (yMint === USDC && xMint === asset.mint);
        const symbolPair = [xSym, ySym].includes('USDC') && [xSym, ySym].includes(asset.symbol);
        if (!exactPair && !symbolPair) continue;

        const poolAddress = String(pool.address ?? '');
        const market = poolAddress ? await dexScreenerPair(poolAddress) : null;
        const token = xSym === asset.symbol ? pool.token_x : (ySym === asset.symbol ? pool.token_y : null);
        const tvlUsd = firstNumber(pool.tvl, market?.liquidityUsd);
        const volume24hUsd = firstNumber(pool.volume?.['24h'], market?.volume24hUsd);
        if (!(tvlUsd > 0) || !(volume24hUsd >= 0)) continue;

        all.push({
          venue: 'METEORA_DLMM',
          poolAddress,
          symbol: asset.symbol,
          pair: `${asset.symbol}/USDC`,
          tvlUsd,
          fees24hUsd: firstNumber(pool.fees?.['24h']),
          volume24hUsd,
          dynamicFeePct: firstNumber(pool.dynamic_fee_pct),
          priceUsd: firstNumber(token?.price, market?.priceUsd),
          priceChange24hPct: firstNumber(market?.priceChange24hPct),
          officialSource: true,
          source: 'meteora_dlmm_datapi+dexscreener_volatility',
          sourceEvidence: {
            meteora: true,
            dexscreener: Boolean(market),
            group: lexical,
          },
        });
      }
    }
  }
  return all;
}

function raydiumDay(pool) {
  const d = pool?.day ?? {};
  const price = firstNumber(pool?.price);
  const priceMin = firstNumber(d.priceMin);
  const priceMax = firstNumber(d.priceMax);
  let priceStressPct = null;
  if (price > 0 && priceMin > 0 && priceMax > 0) {
    priceStressPct = Math.max(
      Math.abs(priceMin / price - 1),
      Math.abs(priceMax / price - 1),
    ) * 100;
  }
  return {
    fee: firstNumber(d.volumeFee, d.fee, d.fees, d.feeVolume, d.feeAmount, d.feeUsd),
    volume: firstNumber(d.volume, d.volumeUsd, d.volumeQuote),
    priceStressPct,
  };
}

async function fetchRaydiumCandidates() {
  const results = [];
  for (const asset of ASSETS) {
    try {
      const url = new URL('https://api-v3.raydium.io/pools/info/mint');
      url.searchParams.set('mint1', asset.mint);
      url.searchParams.set('mint2', USDC);
      url.searchParams.set('poolType', 'concentrated');
      url.searchParams.set('poolSortField', 'fee24h');
      url.searchParams.set('sortType', 'desc');
      url.searchParams.set('pageSize', '20');
      url.searchParams.set('page', '1');
      const json = await fetchJson(url.toString());
      const pools = Array.isArray(json?.data?.data) ? json.data.data : [];
      for (const pool of pools.slice(0, 8)) {
        const poolAddress = String(pool.id ?? '');
        const market = poolAddress ? await dexScreenerPair(poolAddress) : null;
        const day = raydiumDay(pool);
        results.push({
          venue: 'RAYDIUM_CLMM',
          poolAddress,
          symbol: asset.symbol,
          pair: `${asset.symbol}/USDC`,
          tvlUsd: firstNumber(pool.tvl, market?.liquidityUsd),
          fees24hUsd: day.fee,
          volume24hUsd: firstNumber(day.volume, market?.volume24hUsd),
          priceUsd: firstNumber(pool.price, market?.priceUsd),
          priceChange24hPct: firstNumber(day.priceStressPct, market?.priceChange24hPct),
          officialSource: true,
          source: day.priceStressPct != null ? 'raydium_api_v3_official_24h_range' : 'raydium_api_v3+dexscreener_volatility',
          sourceEvidence: { raydium: true, dexscreener: Boolean(market) },
        });
      }
    } catch {
      // Per-asset failure must not kill the research run; source health is reported below.
    }
  }
  return results;
}

async function readHistory() {
  try {
    const raw = await readFile(HISTORY, 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).filter(Boolean);
  } catch {
    return [];
  }
}

function compactCandidate(c) {
  return {
    venue: c.venue,
    poolAddress: c.poolAddress,
    symbol: c.symbol,
    pair: c.pair,
    observedAt: c.observedAt,
    priceUsd: c.priceUsd,
    dailyFeeYieldBps: c.dailyFeeYieldBps,
    expectedNetStressBps: c.expectedNetStressBps,
    officialSource: c.officialSource,
  };
}

function choosePoolSleeve(windows) {
  const byPool = new Map();
  for (const window of windows) {
    const key = `${window.venue}:${window.poolAddress}`;
    if (!byPool.has(key)) byPool.set(key, []);
    byPool.get(key).push(window);
  }

  const ranked = [];
  for (const rows of byPool.values()) {
    const officialRatio = rows.length ? rows.filter((x) => x.officialSource === true).length / rows.length : 0;
    const sleeve = buildLiquiditySleeve(rows, { officialObservationRatio: officialRatio });
    ranked.push({
      ...sleeve,
      venue: rows[0]?.venue ?? null,
      poolAddress: rows[0]?.poolAddress ?? null,
      symbol: rows[0]?.symbol ?? null,
      score: sleeve.expectancyBps == null ? -Infinity : sleeve.expectancyBps * Math.sqrt(Math.max(1, sleeve.samples)),
    });
  }

  ranked.sort((a, b) =>
    Number(b.paperCapitalEligible) - Number(a.paperCapitalEligible) ||
    b.score - a.score
  );

  if (!ranked.length) {
    return {
      ...buildLiquiditySleeve([], { officialObservationRatio: 0 }),
      candidatePools: 0,
      venue: null,
      poolAddress: null,
      symbol: null,
    };
  }
  const best = ranked[0];
  const { score, ...clean } = best;
  return { ...clean, candidatePools: ranked.length };
}

function buildForwardWindows(history) {
  const byPool = new Map();
  for (const snapshot of history) {
    for (const candidate of snapshot.candidates ?? []) {
      const key = `${candidate.venue}:${candidate.poolAddress}`;
      if (!byPool.has(key)) byPool.set(key, []);
      byPool.get(key).push(candidate);
    }
  }
  const windows = [];
  for (const rows of byPool.values()) {
    rows.sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1], curr = rows[i];
      const elapsedHours = (Date.parse(curr.observedAt) - Date.parse(prev.observedAt)) / 3_600_000;
      if (!(elapsedHours > 0) || elapsedHours > 3) continue;
      const window = forwardLiquidityWindow(prev, curr, elapsedHours);
      if (window) windows.push(window);
    }
  }
  return windows;
}

async function main() {
  const observedAt = new Date().toISOString();
  const [meteoraResult, raydiumResult] = await Promise.allSettled([
    fetchMeteoraCandidates(),
    fetchRaydiumCandidates(),
  ]);
  const raw = [
    ...(meteoraResult.status === 'fulfilled' ? meteoraResult.value : []),
    ...(raydiumResult.status === 'fulfilled' ? raydiumResult.value : []),
  ];

  const candidates = raw
    .map((x) => scoreLiquiditySnapshot({ ...x, observedAt }))
    .filter((x) => x.tvlUsd != null && x.volume24hUsd != null)
    .sort((a, b) =>
      Number(b.screenPass) - Number(a.screenPass) ||
      (b.expectedNetStressBps ?? -Infinity) - (a.expectedNetStressBps ?? -Infinity)
    );

  const oldHistory = await readHistory();
  const history = [...oldHistory, {
    generatedAt: observedAt,
    candidates: candidates.filter((x) => x.screenPass).slice(0, 30).map(compactCandidate),
  }].slice(-500);

  const windows = buildForwardWindows(history);
  const sleeve = choosePoolSleeve(windows);

  const output = {
    ok: true,
    version: VERSION,
    generatedAt: observedAt,
    mode: 'RESEARCH_PAPER_ONLY',
    executionAuthority: false,
    liveLocked: true,
    signsTransactions: false,
    broadcastsTransactions: false,
    methodology: {
      officialPoolMetrics: ['Meteora DLMM', 'Raydium API v3'],
      volatilityContext: 'Raydium official 24h priceMin/priceMax when available; DexScreener fallback; Meteora uses DexScreener volatility context',
      feeCaptureHaircut: DEFAULT_LIQUIDITY_POLICY.feeCaptureHaircut,
      ilReserveMultiplier: DEFAULT_LIQUIDITY_POLICY.ilReserveMultiplier,
      rangeHalfWidthPct: DEFAULT_LIQUIDITY_POLICY.rangeHalfWidthPct,
      rewardsIncluded: false,
      forwardProxy: 'consecutive scheduled snapshots; no claimed live LP fills',
      promotion: 'PAPER sleeve only after sufficient positive forward proxy evidence; LIVE remains locked',
    },
    sourceHealth: {
      meteora: meteoraResult.status === 'fulfilled',
      raydium: raydiumResult.status === 'fulfilled',
      meteoraError: meteoraResult.status === 'rejected' ? String(meteoraResult.reason) : null,
      raydiumError: raydiumResult.status === 'rejected' ? String(raydiumResult.reason) : null,
    },
    candidateCount: candidates.length,
    screenPassCount: candidates.filter((x) => x.screenPass).length,
    best: candidates.find((x) => x.screenPass) ?? candidates[0] ?? null,
    topCandidates: candidates.slice(0, 12),
    forwardWindowCount: windows.length,
    recentForwardWindows: windows.slice(-20),
    sleeve,
    invariants: {
      paperOnly: true,
      liveLocked: true,
      executionAuthority: false,
      signsTransactions: false,
      broadcastsTransactions: false,
      rewardsNotAssumed: true,
    },
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  await mkdir(dirname(HISTORY), { recursive: true });
  await writeFile(HISTORY, history.map((x) => JSON.stringify(x)).join('\n') + '\n');

  console.log(JSON.stringify({
    version: VERSION,
    candidates: output.candidateCount,
    screenPass: output.screenPassCount,
    forwardWindows: output.forwardWindowCount,
    top: output.best ? {
      venue: output.best.venue,
      pair: output.best.pair,
      tvlUsd: output.best.tvlUsd,
      fees24hUsd: output.best.fees24hUsd,
      dailyFeeYieldBps: output.best.dailyFeeYieldBps,
      expectedNetStressBps: output.best.expectedNetStressBps,
    } : null,
    sleeve: {
      samples: sleeve.samples,
      expectancyBps: sleeve.expectancyBps,
      eligible: sleeve.paperCapitalEligible,
    },
    sourceHealth: output.sourceHealth,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
