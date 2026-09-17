import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  DEFAULT_LIQUIDITY_POLICY,
  scoreLiquiditySnapshot,
  forwardLiquidityWindow,
  shouldScoreLiquidityForwardWindow,
  buildLiquiditySleeve,
  solanaOperationCostBps,
  lpBreakEvenHoldDays,
  measuredCostForwardEntry,
} from '../../src/core/solanaLiquidityEconomics.mjs';

const VERSION = 'solana_liquidity_lab_v6_all_cost_forward';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'quant-evidence/solana-liquidity-lab-latest.json';
const HISTORY = process.argv.includes('--history') ? process.argv[process.argv.indexOf('--history') + 1] : 'quant-evidence/solana-liquidity-history.jsonl';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const USDT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const SOL = 'So11111111111111111111111111111111111111112';
const MSOL = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';
const JITOSOL = 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn';
const ASSETS = [
  { symbol: 'SOL', mint: SOL },
  { symbol: 'JUP', mint: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN' },
  { symbol: 'WIF', mint: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm' },
  { symbol: 'RAY', mint: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
  { symbol: 'PYTH', mint: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3' },
  { symbol: 'POPCAT', mint: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr' },
];
const BY_MINT = new Map(ASSETS.map((x) => [x.mint, x]));
const RAYDIUM_PAIRS = [
  ...ASSETS.map((asset) => ({
    symbol: asset.symbol,
    pair: `${asset.symbol}/USDC`,
    mint1: asset.mint,
    mint2: USDC,
    quoteIsUsd: true,
    pairClass: 'volatile_usd',
  })),
  { symbol: 'mSOL', pair: 'mSOL/SOL', mint1: MSOL, mint2: SOL, quoteIsUsd: false, pairClass: 'lst_correlated' },
  { symbol: 'JitoSOL', pair: 'JitoSOL/SOL', mint1: JITOSOL, mint2: SOL, quoteIsUsd: false, pairClass: 'lst_correlated' },
  { symbol: 'USDT', pair: 'USDT/USDC', mint1: USDT, mint2: USDC, quoteIsUsd: true, pairClass: 'stable' },
];
const FETCH_TIMEOUT_MS = 15_000;
const LP_NOTIONAL_GRID = [100, 250, 500, 1_000, 2_500];
const LP_OPERATION_SCENARIOS = Object.freeze({
  open: 2,
  close: 2,
  rebalance: 4,
  openCloseRoundTrip: 4,
});
const LP_SOLANA_RPC_URL = process.env.GENESIS_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const LP_BASE_FEE_LAMPORTS = Math.max(0, Number(process.env.GENESIS_SOLANA_BASE_FEE_LAMPORTS || 5_000));
const LP_COMPUTE_UNIT_LIMIT = Math.max(1, Number(process.env.GENESIS_SOLANA_LP_CU_LIMIT || 1_000_000));
const LP_PRIORITY_FEE_PERCENTILE = Math.min(1, Math.max(0, Number(process.env.GENESIS_SOLANA_PRIORITY_FEE_PERCENTILE || 0.75)));
const LP_FORWARD_ENTRY_NOTIONAL_USD = Math.max(10, Number(process.env.GENESIS_SOLANA_LP_FORWARD_ENTRY_NOTIONAL_USD || 500));
const LP_MAX_FORWARD_BREAK_EVEN_DAYS = Math.max(0.01, Number(process.env.GENESIS_SOLANA_LP_MAX_FORWARD_BREAK_EVEN_DAYS || 1));

function n(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function quantile(values, p) {
  const clean = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = Math.min(clean.length - 1, Math.max(0, Math.ceil(p * clean.length) - 1));
  return clean[index];
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

async function fetchGlobalPriorityFeeEvidence() {
  const response = await fetch(LP_SOLANA_RPC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'GenesisHQ-SolanaLiquidityLab/1.0',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getRecentPrioritizationFees',
      params: [[]],
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`priority_fee_http_${response.status}`);
  const body = await response.json();
  if (!Array.isArray(body?.result)) throw new Error('priority_fee_unavailable');
  const microLamportsPerCu = quantile(
    body.result.map((row) => row?.prioritizationFee),
    LP_PRIORITY_FEE_PERCENTILE,
  );
  if (!Number.isFinite(microLamportsPerCu)) throw new Error('priority_fee_unavailable');
  return {
    source: 'solana_getRecentPrioritizationFees',
    localized: false,
    percentile: LP_PRIORITY_FEE_PERCENTILE,
    microLamportsPerCu,
    computeUnitLimit: LP_COMPUTE_UNIT_LIMIT,
    priorityFeeLamports: Math.ceil(microLamportsPerCu * LP_COMPUTE_UNIT_LIMIT / 1_000_000),
    rpcTier: 'FREE_ONLY',
  };
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
          price: firstNumber(token?.price, market?.priceUsd),
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
  for (const spec of RAYDIUM_PAIRS) {
    try {
      const url = new URL('https://api-v3.raydium.io/pools/info/mint');
      url.searchParams.set('mint1', spec.mint1);
      url.searchParams.set('mint2', spec.mint2);
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
        const officialRelativePrice = firstNumber(pool.price);
        const officialRelativeStress = firstNumber(day.priceStressPct);
        const price = firstNumber(
          officialRelativePrice,
          spec.quoteIsUsd ? market?.priceUsd : null,
        );
        const priceChange24hPct = firstNumber(
          officialRelativeStress,
          spec.quoteIsUsd ? market?.priceChange24hPct : null,
        );

        results.push({
          venue: 'RAYDIUM_CLMM',
          poolAddress,
          symbol: spec.symbol,
          pair: spec.pair,
          pairClass: spec.pairClass,
          tvlUsd: firstNumber(pool.tvl, market?.liquidityUsd),
          fees24hUsd: day.fee,
          volume24hUsd: firstNumber(day.volume, market?.volume24hUsd),
          price,
          priceChange24hPct,
          officialSource: true,
          source: officialRelativeStress != null
            ? 'raydium_api_v3_official_relative_price_range'
            : (spec.quoteIsUsd ? 'raydium_api_v3+dexscreener_volatility' : 'raydium_api_v3_relative_price_only'),
          sourceEvidence: {
            raydium: true,
            dexscreener: Boolean(market),
            officialRelativePrice: officialRelativePrice != null,
            officialRelativeStress: officialRelativeStress != null,
          },
        });
      }
    } catch {
      // Per-pair failure must not kill the research run.
    }
  }
  return results;
}

function buildOperationalCostEvidence({ baseFeeLamports, priorityEvidence, solUsd }) {
  const priorityFeeLamports = Number(priorityEvidence?.priorityFeeLamports);
  if (!Number.isFinite(priorityFeeLamports) || !(Number(solUsd) > 0)) {
    return {
      available: false,
      reason: !Number.isFinite(priorityFeeLamports) ? 'priority_fee_unavailable' : 'sol_usd_unavailable',
      baseFeeLamports,
      priorityFeeLamports: Number.isFinite(priorityFeeLamports) ? priorityFeeLamports : null,
      solUsd: Number.isFinite(Number(solUsd)) ? Number(solUsd) : null,
      localized: priorityEvidence?.localized === true,
      calibrationOnly: true,
    };
  }
  const scenarios = {};
  for (const [name, txCount] of Object.entries(LP_OPERATION_SCENARIOS)) {
    scenarios[name] = LP_NOTIONAL_GRID.map((notionalUsd) => ({
      notionalUsd,
      txCount,
      ...solanaOperationCostBps({
        baseFeeLamports,
        priorityFeeLamports,
        solUsd,
        txCount,
        notionalUsd,
      }),
    }));
  }
  return {
    available: true,
    source: priorityEvidence?.source ?? 'solana_getRecentPrioritizationFees',
    localized: priorityEvidence?.localized === true,
    percentile: priorityEvidence?.percentile ?? null,
    microLamportsPerCu: priorityEvidence?.microLamportsPerCu ?? null,
    computeUnitLimit: priorityEvidence?.computeUnitLimit ?? null,
    baseFeeLamports,
    priorityFeeLamports,
    solUsd,
    notionalGridUsd: LP_NOTIONAL_GRID,
    scenarios,
    calibrationOnly: true,
    changesPromotionGate: false,
  };
}

function annotateMeasuredCostForwardEntries(candidates, operationalCostEvidence) {
  const roundTrips = operationalCostEvidence?.scenarios?.openCloseRoundTrip;
  if (!operationalCostEvidence?.available || !Array.isArray(roundTrips) || !roundTrips.length) {
    return candidates.map((candidate) => ({
      ...candidate,
      forwardEntryPass: false,
      forwardEntryReason: 'MEASURED_OPERATION_COST_UNAVAILABLE',
      forwardEntryNotionalUsd: null,
      measuredRoundTripCostBps: null,
      measuredBreakEvenHoldDays: null,
      measuredPreOperationalNetBpsPerDay: null,
    }));
  }

  const cost = [...roundTrips].sort((a, b) =>
    Math.abs(Number(a.notionalUsd) - LP_FORWARD_ENTRY_NOTIONAL_USD) -
    Math.abs(Number(b.notionalUsd) - LP_FORWARD_ENTRY_NOTIONAL_USD)
  )[0];

  return candidates.map((candidate) => {
    const gate = measuredCostForwardEntry({
      candidate,
      roundTripCostBps: cost?.bps,
      maxBreakEvenHoldDays: LP_MAX_FORWARD_BREAK_EVEN_DAYS,
    });
    return {
      ...candidate,
      forwardEntryPass: gate.pass === true,
      forwardEntryReason: gate.reason,
      forwardEntryNotionalUsd: cost?.notionalUsd ?? null,
      measuredRoundTripCostBps: gate.roundTripCostBps,
      measuredBreakEvenHoldDays: gate.breakEvenHoldDays,
      measuredPreOperationalNetBpsPerDay: gate.preOperationalNetBpsPerDay,
    };
  });
}

function buildCostCalibratedResearch(candidates, operationalCostEvidence) {
  const roundTrips = operationalCostEvidence?.scenarios?.openCloseRoundTrip;
  if (!operationalCostEvidence?.available || !Array.isArray(roundTrips)) return [];
  return candidates
    .filter(historyEligible)
    .map((candidate) => {
      const breakEvenByNotional = roundTrips.map((cost) => {
        const result = lpBreakEvenHoldDays({
          capturedFeeYieldBps: candidate.capturedFeeYieldBps,
          ilStressBps: candidate.ilStressBps,
          rebalanceReserveBps: candidate.rebalanceReserveBps,
          roundTripCostBps: cost.bps,
        });
        return {
          notionalUsd: cost.notionalUsd,
          roundTripCostBps: cost.bps,
          preOperationalNetBpsPerDay: result?.preOperationalNetBpsPerDay ?? null,
          breakEvenHoldDays: result?.breakEvenHoldDays ?? null,
        };
      });
      return {
        venue: candidate.venue,
        poolAddress: candidate.poolAddress,
        pair: candidate.pair,
        pairClass: candidate.pairClass ?? null,
        tvlUsd: candidate.tvlUsd,
        volume24hUsd: candidate.volume24hUsd,
        dailyFeeYieldBps: candidate.dailyFeeYieldBps,
        capturedFeeYieldBps: candidate.capturedFeeYieldBps,
        ilStressBps: candidate.ilStressBps,
        rebalanceReserveBps: candidate.rebalanceReserveBps,
        legacyOperationalReserveBps: candidate.operationalReserveBps,
        legacyExpectedNetStressBps: candidate.expectedNetStressBps,
        breakEvenByNotional,
        calibrationOnly: true,
        changesPromotionGate: false,
      };
    })
    .filter((candidate) => candidate.breakEvenByNotional.some((x) => x.breakEvenHoldDays != null))
    .sort((a, b) => {
      const a500 = a.breakEvenByNotional.find((x) => x.notionalUsd === 500)?.breakEvenHoldDays ?? Infinity;
      const b500 = b.breakEvenByNotional.find((x) => x.notionalUsd === 500)?.breakEvenHoldDays ?? Infinity;
      return a500 - b500;
    })
    .slice(0, 20);
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
    price: c.price ?? c.priceUsd,
    dailyFeeYieldBps: c.dailyFeeYieldBps,
    expectedNetStressBps: c.expectedNetStressBps,
    legacyScreenPass: c.screenPass === true,
    screenPass: c.forwardEntryPass === true,
    forwardEntryPass: c.forwardEntryPass === true,
    forwardEntryReason: c.forwardEntryReason ?? null,
    forwardEntryNotionalUsd: c.forwardEntryNotionalUsd ?? null,
    measuredRoundTripCostBps: c.measuredRoundTripCostBps ?? null,
    measuredBreakEvenHoldDays: c.measuredBreakEvenHoldDays ?? null,
    measuredPreOperationalNetBpsPerDay: c.measuredPreOperationalNetBpsPerDay ?? null,
    officialSource: c.officialSource,
  };
}

function historyEligible(c) {
  const checks = c?.checks ?? {};
  return checks.officialSource === true &&
    checks.tvl === true &&
    checks.volume === true &&
    checks.fees === true &&
    checks.price === true &&
    checks.volatilityEvidence === true;
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
      if (!shouldScoreLiquidityForwardWindow(prev, curr)) continue;
      const window = forwardLiquidityWindow(prev, curr, elapsedHours);
      if (window) windows.push(window);
    }
  }
  return windows;
}

async function main() {
  const observedAt = new Date().toISOString();
  const [meteoraResult, raydiumResult, priorityFeeResult] = await Promise.allSettled([
    fetchMeteoraCandidates(),
    fetchRaydiumCandidates(),
    fetchGlobalPriorityFeeEvidence(),
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

  const solReference = candidates.find((x) => x.venue === 'RAYDIUM_CLMM' && x.pair === 'SOL/USDC' && Number(x.price ?? x.priceUsd) > 0);
  const operationalCostEvidence = buildOperationalCostEvidence({
    baseFeeLamports: LP_BASE_FEE_LAMPORTS,
    priorityEvidence: priorityFeeResult.status === 'fulfilled' ? priorityFeeResult.value : null,
    solUsd: solReference?.price ?? solReference?.priceUsd ?? null,
  });

  const measuredCandidates = annotateMeasuredCostForwardEntries(candidates, operationalCostEvidence)
    .sort((a, b) =>
      Number(b.forwardEntryPass) - Number(a.forwardEntryPass) ||
      (b.measuredPreOperationalNetBpsPerDay ?? -Infinity) - (a.measuredPreOperationalNetBpsPerDay ?? -Infinity) ||
      (b.expectedNetStressBps ?? -Infinity) - (a.expectedNetStressBps ?? -Infinity)
    );
  const costCalibratedResearch = buildCostCalibratedResearch(measuredCandidates, operationalCostEvidence);

  const oldHistory = await readHistory();
  const history = [...oldHistory, {
    generatedAt: observedAt,
    // Preserve deterioration after entry: store every structurally valid pool,
    // not only current winners. A forward window is opened only from a prior
    // screenPass=true observation and is still scored if the pool later fails.
    candidates: measuredCandidates.filter(historyEligible).slice(0, 80).map(compactCandidate),
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
      raydiumPairUniverse: RAYDIUM_PAIRS.map((x) => ({ pair: x.pair, pairClass: x.pairClass })),
      volatilityContext: 'Raydium official 24h priceMin/priceMax when available; DexScreener fallback; Meteora uses DexScreener volatility context',
      feeCaptureHaircut: DEFAULT_LIQUIDITY_POLICY.feeCaptureHaircut,
      ilReserveMultiplier: DEFAULT_LIQUIDITY_POLICY.ilReserveMultiplier,
      rangeHalfWidthPct: DEFAULT_LIQUIDITY_POLICY.rangeHalfWidthPct,
      rewardsIncluded: false,
      operationalCostCalibration: 'measured global Solana priority fee + configured base fee; measured cost may open forward-research observation but cannot by itself promote PAPER capital',
      forwardEntryGate: { notionalUsd: LP_FORWARD_ENTRY_NOTIONAL_USD, maxBreakEvenHoldDays: LP_MAX_FORWARD_BREAK_EVEN_DAYS },
      forwardProxy: 'consecutive scheduled snapshots; entries require measured-cost forward gate pass; every hypothetical entry/exit window pays the measured round-trip network cost; exits are scored even after deterioration; no claimed live LP fills',
      promotion: 'PAPER sleeve only after sufficient positive forward proxy evidence; LIVE remains locked',
    },
    sourceHealth: {
      meteora: meteoraResult.status === 'fulfilled',
      raydium: raydiumResult.status === 'fulfilled',
      meteoraError: meteoraResult.status === 'rejected' ? String(meteoraResult.reason) : null,
      raydiumError: raydiumResult.status === 'rejected' ? String(raydiumResult.reason) : null,
      priorityFee: priorityFeeResult.status === 'fulfilled',
      priorityFeeError: priorityFeeResult.status === 'rejected' ? String(priorityFeeResult.reason) : null,
    },
    operationalCostEvidence,
    costCalibratedResearch,
    candidateCount: measuredCandidates.length,
    screenPassCount: measuredCandidates.filter((x) => x.screenPass).length,
    forwardEntryPassCount: measuredCandidates.filter((x) => x.forwardEntryPass).length,
    best: measuredCandidates.find((x) => x.screenPass) ?? measuredCandidates[0] ?? null,
    bestMeasuredCostCandidate: measuredCandidates.find((x) => x.forwardEntryPass) ?? null,
    topCandidates: measuredCandidates.slice(0, 12),
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
      measuredCostForwardEntryCannotPromotePaperAlone: true,
      paperPromotionStillRequiresForwardEvidence: true,
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
    forwardEntryPass: output.forwardEntryPassCount,
    forwardWindows: output.forwardWindowCount,
    top: output.best ? {
      venue: output.best.venue,
      pair: output.best.pair,
      tvlUsd: output.best.tvlUsd,
      fees24hUsd: output.best.fees24hUsd,
      dailyFeeYieldBps: output.best.dailyFeeYieldBps,
      expectedNetStressBps: output.best.expectedNetStressBps,
    } : null,
    bestMeasuredCostCandidate: output.bestMeasuredCostCandidate ? {
      venue: output.bestMeasuredCostCandidate.venue,
      pair: output.bestMeasuredCostCandidate.pair,
      measuredPreOperationalNetBpsPerDay: output.bestMeasuredCostCandidate.measuredPreOperationalNetBpsPerDay,
      measuredBreakEvenHoldDays: output.bestMeasuredCostCandidate.measuredBreakEvenHoldDays,
      forwardEntryNotionalUsd: output.bestMeasuredCostCandidate.forwardEntryNotionalUsd,
    } : null,
    sleeve: {
      samples: sleeve.samples,
      expectancyBps: sleeve.expectancyBps,
      eligible: sleeve.paperCapitalEligible,
    },
    sourceHealth: output.sourceHealth,
    operationalCostEvidence: output.operationalCostEvidence,
    costCalibratedTop: output.costCalibratedResearch.slice(0, 5),
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
