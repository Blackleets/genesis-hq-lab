import fs from 'node:fs';

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function fmt(value, digits = 4) {
  const n = finite(value);
  if (n === null) return 'n/a';
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(digits).replace(/\.?0+$/, '');
}

function yesNo(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'n/a';
}

export function buildPublicResearchSummary({
  stack = {},
  marketMaking = {},
  statArb = {},
  fundingCarry = {},
  solanaLiquidity = {},
} = {}) {
  const action = stack?.executionBrain?.action ?? 'UNKNOWN';
  const qualified = finite(stack?.allocation?.qualifiedSleeves) ?? 0;
  const cashWeight = finite(stack?.allocation?.cashReserve?.paperWeight);
  const priority = stack?.nextResearchPriority ?? 'n/a';

  const maker = marketMaking?.best ?? {};
  const statBest = statArb?.best ?? {};
  const fundingBest = fundingCarry?.best ?? {};
  const liquiditySleeve =
    stack?.sleeves?.find?.((x) => x?.sleeveKey === 'SOLANA_LIQUIDITY') ??
    solanaLiquidity?.sleeve ??
    {};

  const laneRows = [
    [
      'Market making',
      marketMaking?.version ?? 'n/a',
      fmt(maker?.samples, 0),
      fmt(maker?.expectancyBps),
      fmt(maker?.profitFactor),
      yesNo(maker?.eligibleForPaperAllocation),
      maker?.evidenceStatus ?? 'n/a',
    ],
    [
      'Stat arb',
      statArb?.version ?? 'n/a',
      fmt(statBest?.oosTrades ?? statBest?.holdout?.trades, 0),
      fmt(statBest?.holdout?.expectancyBps),
      fmt(statBest?.holdout?.profitFactor),
      yesNo(statBest?.passedOos),
      'OOS passes: ' + fmt(statArb?.oosPassCount, 0),
    ],
    [
      'Funding carry',
      fundingCarry?.version ?? 'n/a',
      fmt(fundingBest?.oosTrades ?? fundingBest?.holdout?.trades, 0),
      fmt(fundingBest?.holdout?.expectancyBps),
      fmt(fundingBest?.holdout?.profitFactor),
      yesNo(fundingBest?.passedOos),
      'OOS passes: ' + fmt(fundingCarry?.oosPassCount, 0),
    ],
    [
      'Solana liquidity',
      liquiditySleeve?.engineVersion ?? solanaLiquidity?.version ?? 'n/a',
      fmt(liquiditySleeve?.samples, 0),
      fmt(liquiditySleeve?.expectancyBps),
      fmt(liquiditySleeve?.profitFactor),
      yesNo(liquiditySleeve?.paperCapitalEligible),
      liquiditySleeve?.liveEligible === false ? 'live ineligible' : 'research evidence',
    ],
  ];

  const lines = [
    '# Genesis research status',
    '',
    'Generated: ' + (stack?.generatedAt ?? new Date().toISOString()),
    '',
    '> Research / paper evidence only. This is **not live PnL** and is **not a profitability claim**.',
    '',
    '## Portfolio decision',
    '',
    '| Field | Value |',
    '|---|---|',
    '| Safety | ' + (stack?.liveLocked === true ? '🔒 LIVE_LOCKED' : '⚠️ verify') + ' |',
    '| Execution authority | ' + (stack?.executionAuthority === false ? 'none' : '⚠️ verify') + ' |',
    '| Qualified sleeves | ' + fmt(qualified, 0) + ' |',
    '| Paper cash reserve | ' + (cashWeight === null ? 'n/a' : fmt(cashWeight * 100, 2) + '%') + ' |',
    '| Current action | **' + action + '** |',
    '| Next research priority | ' + priority + ' |',
    '',
    '## Research lanes',
    '',
    '| Lane | Engine | Samples | Net expectancy (bps) | Profit factor | Passed / eligible | Evidence state |',
    '|---|---|---:|---:|---:|---|---|',
    ...laneRows.map((row) => '| ' + row.join(' | ') + ' |'),
    '',
    '## Interpretation',
    '',
    qualified > 0
      ? 'At least one paper/research sleeve passed the current allocator gates. That is **not** equivalent to live-capital approval.'
      : 'No sleeve passed the current allocator gates. Genesis remains in evidence-gathering mode and keeps paper capital in cash.',
    '',
    'Smart-execution action: **' + action + '**.',
    '',
    'Artifacts attached to this workflow contain the machine-readable reports used for this summary.',
    '',
  ];

  return lines.join('\n');
}

export function loadResearchReports(baseDir = 'quant-evidence') {
  const read = (name) => {
    try {
      return JSON.parse(fs.readFileSync(baseDir + '/' + name, 'utf8'));
    } catch {
      return {};
    }
  };

  return {
    stack: read('institutional-edge-stack-latest.json'),
    marketMaking: read('market-making-lab-latest.json'),
    statArb: read('stat-arb-lab-latest.json'),
    fundingCarry: read('funding-carry-lab-latest.json'),
    solanaLiquidity: read('solana-liquidity-lab-latest.json'),
  };
}

export function writeGithubStepSummary({
  baseDir = 'quant-evidence',
  summaryPath = process.env.GITHUB_STEP_SUMMARY,
} = {}) {
  if (!summaryPath) throw new Error('GITHUB_STEP_SUMMARY is not set');
  const reports = loadResearchReports(baseDir);
  const markdown = buildPublicResearchSummary(reports);
  fs.appendFileSync(summaryPath, markdown + '\n');

  const compact = {
    publicResearchSummary: true,
    qualifiedSleeves: reports.stack?.allocation?.qualifiedSleeves ?? null,
    cashWeight: reports.stack?.allocation?.cashReserve?.paperWeight ?? null,
    action: reports.stack?.executionBrain?.action ?? 'UNKNOWN',
    priority: reports.stack?.nextResearchPriority ?? null,
    makerVersion: reports.marketMaking?.version ?? null,
    makerSamples: reports.marketMaking?.best?.samples ?? null,
    makerExpectancyBps: reports.marketMaking?.best?.expectancyBps ?? null,
    fundingVersion: reports.fundingCarry?.version ?? null,
    fundingOosPassCount: reports.fundingCarry?.oosPassCount ?? null,
  };
  console.log(JSON.stringify(compact));
  return { markdown, compact };
}

if (process.argv[1]?.endsWith('publicResearchRunSummary.mjs')) {
  writeGithubStepSummary();
}
