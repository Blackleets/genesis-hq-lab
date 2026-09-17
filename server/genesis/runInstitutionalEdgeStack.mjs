import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { allocatePaperCapital } from '../../src/core/institutionalEdgeAllocator.mjs';
import { chooseExecutionMode } from '../../src/core/institutionalSmartExecution.mjs';

const VERSION = 'institutional_edge_stack_v4_solana_liquidity';
const MM_PATH = process.env.GENESIS_MM_EVIDENCE || 'quant-evidence/market-making-lab-latest.json';
const STAT_PATH = process.env.GENESIS_STATARB_EVIDENCE || 'quant-evidence/stat-arb-lab-latest.json';
const FUNDING_PATH = process.env.GENESIS_FUNDING_EVIDENCE || 'quant-evidence/funding-carry-lab-latest.json';
const LIQUIDITY_PATH = process.env.GENESIS_SOLANA_LIQUIDITY_EVIDENCE || 'quant-evidence/solana-liquidity-lab-latest.json';
const EDGE_PATH = process.env.GENESIS_EDGE_FACTORY_EVIDENCE || 'quant-evidence/edge-factory-latest.json';
const ARB_PATH = process.env.GENESIS_ARB_EVIDENCE || 'quant-evidence/solana-arbitrage-evidence-latest.json';
const OUT = process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out') + 1] : 'quant-evidence/institutional-edge-stack-latest.json';
const PAPER_CAPITAL = Number(process.env.GENESIS_INSTITUTIONAL_PAPER_CAPITAL_USD || 10_000);

async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

function edgeFactorySleeve(snapshot) {
  const results = Array.isArray(snapshot?.results) ? snapshot.results : [];
  const candidates = results.filter((x) => x?.status === 'PAPER_CANDIDATE' && x?.holdout);
  candidates.sort((a, b) => (Number(b.holdout?.expectancyBps) || -Infinity) - (Number(a.holdout?.expectancyBps) || -Infinity));
  const best = candidates[0];
  if (!best) return { sleeveKey: 'SYSTEMATIC_EDGE_FACTORY', engineVersion: snapshot?.version ?? 'edge_factory_unknown', samples: 0, expectancyBps: null, profitFactor: null, tStat: null, maxDrawdownPct: null, evidenceQuality: 0, paperCapitalEligible: false };
  return {
    sleeveKey: 'SYSTEMATIC_EDGE_FACTORY', engineVersion: snapshot.version ?? null,
    samples: best.holdout?.trades ?? 0, expectancyBps: best.holdout?.expectancyBps ?? null,
    profitFactor: best.holdout?.profitFactor ?? null, tStat: best.holdout?.tStat ?? null,
    maxDrawdownPct: best.holdout?.maxDrawdownPct ?? null, evidenceQuality: best.walkForward?.pass ? 0.80 : 0.60,
    paperCapitalEligible: best.walkForward?.pass === true,
    hypothesisKey: best.hypothesisKey ?? null, variantKey: best.variantKey ?? null,
  };
}

function arbSleeve(snapshot) {
  if (snapshot?.sleeve) return { sleeveKey: 'SOLANA_ARBITRAGE', ...snapshot.sleeve };
  const m = snapshot?.metrics ?? snapshot?.summary ?? null;
  if (!m) return { sleeveKey: 'SOLANA_ARBITRAGE', engineVersion: 'edge_discovery_paper_v2', samples: 0, expectancyBps: null, profitFactor: null, tStat: null, maxDrawdownPct: null, evidenceQuality: 0, paperCapitalEligible: false };
  return {
    sleeveKey: 'SOLANA_ARBITRAGE', engineVersion: snapshot.engineVersion ?? 'edge_discovery_paper_v2',
    samples: m.samples ?? m.captures ?? m.trades ?? 0, expectancyBps: m.expectancyBps ?? null,
    profitFactor: m.profitFactor ?? null, tStat: m.tStat ?? null, maxDrawdownPct: m.maxDrawdownPct ?? null,
    evidenceQuality: m.evidenceQuality ?? 0.5, paperCapitalEligible: m.paperCapitalEligible === true,
  };
}

function buildExecutionBrain(mm, arb) {
  const makerBest = mm?.best ?? null;
  const makerMethod = mm?.methodology ?? {};
  const arbBest = arb?.best ?? arb?.latest ?? arb?.event ?? null;
  const arbMetrics = arb?.metrics ?? arb?.summary ?? {};
  const maker = makerBest ? {
    spreadCaptureBps: makerBest.averageSpreadBps,
    fillProbability: makerBest.fillProbability,
    makerFeeBps: Number.isFinite(Number(makerMethod.makerFeeBpsPerSide)) ? 2 * Number(makerMethod.makerFeeBpsPerSide) : null,
    adverseSelectionBps: makerBest.averageAdverseSelectionBps,
    inventoryRiskBps: makerMethod.inventoryReserveBps,
    evidenceQuality: makerBest.evidenceQuality,
  } : {};
  const takerAlphaBps = arbBest?.netEdgeBps ?? arbBest?.expectedNetEdgeBps ?? arbMetrics?.expectancyBps ?? null;
  const takerCosts = arbBest?.estimatedCosts ?? arbBest?.costs ?? {};
  const taker = {
    alphaBps: takerAlphaBps,
    takerFeeBps: takerCosts?.takerFeeBps ?? null,
    slippageBps: takerCosts?.slippageBps ?? takerCosts?.slippageReserveBps ?? null,
    latencyBps: takerCosts?.latencyBps ?? takerCosts?.latencyDegradationBps ?? null,
    adverseSelectionBps: takerCosts?.adverseSelectionBps ?? null,
    evidenceQuality: arbMetrics?.evidenceQuality ?? arbBest?.evidenceQuality ?? null,
  };
  return chooseExecutionMode({ maker, taker }, { minExpectedNetBps: 0 });
}

async function main() {
  const [mm, stat, funding, liquidity, edge, arb] = await Promise.all([
    readJson(MM_PATH),
    readJson(STAT_PATH),
    readJson(FUNDING_PATH),
    readJson(LIQUIDITY_PATH),
    readJson(EDGE_PATH),
    readJson(ARB_PATH),
  ]);
  const sleeves = [
    mm?.sleeve ? { ...mm.sleeve, sleeveKey: 'MARKET_MAKING' } : { sleeveKey: 'MARKET_MAKING', samples: 0, evidenceQuality: 0, paperCapitalEligible: false },
    stat?.sleeve ? { ...stat.sleeve, sleeveKey: 'STAT_ARB' } : { sleeveKey: 'STAT_ARB', samples: 0, evidenceQuality: 0, paperCapitalEligible: false },
    funding?.sleeve ? { ...funding.sleeve, sleeveKey: 'FUNDING_CARRY' } : { sleeveKey: 'FUNDING_CARRY', samples: 0, evidenceQuality: 0, paperCapitalEligible: false },
    liquidity?.sleeve ? { ...liquidity.sleeve, sleeveKey: 'SOLANA_LIQUIDITY' } : { sleeveKey: 'SOLANA_LIQUIDITY', samples: 0, evidenceQuality: 0, paperCapitalEligible: false },
    edgeFactorySleeve(edge),
    arbSleeve(arb),
  ];
  const allocation = allocatePaperCapital(sleeves, { totalPaperCapitalUsd: PAPER_CAPITAL });
  const executionBrain = buildExecutionBrain(mm, arb);
  const output = {
    ok: true, version: VERSION, generatedAt: new Date().toISOString(), mode: 'PAPER_ONLY',
    executionAuthority: false, liveLocked: true, liveOrders: false,
    thesis: 'Independent institutional sleeves compete for paper capital; CASH and WAIT are valid winners when evidence is weak.',
    evidence: {
      marketMaking: Boolean(mm),
      statArb: Boolean(stat),
      fundingCarry: Boolean(funding),
      solanaLiquidity: Boolean(liquidity),
      systematicEdgeFactory: Boolean(edge),
      solanaArbitrage: Boolean(arb),
    },
    sleeves,
    allocation,
    executionBrain,
    nextResearchPriority: allocation.qualifiedSleeves === 0
      ? 'NO_EDGE_PROVEN_KEEP_CASH_AND_GATHER_EVIDENCE'
      : allocation.allocations.filter((x) => x.qualified).sort((a, b) => b.robustScore - a.robustScore)[0]?.sleeveKey ?? 'UNKNOWN',
    invariants: { paperOnly: true, signsTransactions: false, broadcastsTransactions: false, unlocksLive: false, forcesTrading: false },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({
    version: VERSION,
    qualifiedSleeves: allocation.qualifiedSleeves,
    cashWeight: allocation.cashReserve.paperWeight,
    leader: output.nextResearchPriority,
    executionAction: executionBrain.action,
    solanaLiquidity: sleeves.find((x) => x.sleeveKey === 'SOLANA_LIQUIDITY'),
  }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
