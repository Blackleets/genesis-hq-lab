// RESEARCH_ONLY audit of durable positioning evidence quality.
// Never ranks strategies, opens holdout, or changes trading/risk gates.

import fs from 'node:fs';
import path from 'node:path';

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function capturedMs(row) {
  const ms = Date.parse(row?.capturedAt);
  return Number.isFinite(ms) ? ms : null;
}

function takerWindowMs(row) {
  return finite(row?.positioning?.takerWindowMs) ?? finite(row?.provenance?.takerWindowMs);
}

function defectCounts(rows, maxGapMinutes) {
  let duplicateCloseTimes = 0;
  let nonCausalSequence = 0;
  let overlappingWindows = 0;
  let excessiveGaps = 0;
  const closeTimes = new Set();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const closeTime = row?.price?.closeTime ?? null;
    if (closeTime && closeTimes.has(closeTime)) duplicateCloseTimes += 1;
    if (closeTime) closeTimes.add(closeTime);
    if (i === 0) continue;
    const prev = rows[i - 1];
    const elapsedMs = capturedMs(row) - capturedMs(prev);
    if (!(elapsedMs > 0)) nonCausalSequence += 1;
    const requiredMs = Math.max(takerWindowMs(prev), takerWindowMs(row));
    if (elapsedMs > 0 && elapsedMs < requiredMs) overlappingWindows += 1;
    if (elapsedMs > maxGapMinutes * 60_000) excessiveGaps += 1;
  }
  return { duplicateCloseTimes, nonCausalSequence, overlappingWindows, excessiveGaps };
}

export function auditPositioningRows(rows = [], {
  symbol = 'BTCUSDT',
  expectedSchemaVersion = 4,
  maxGapMinutes = 60,
  minIndependentRowsForPredeclaredStudy = 20,
} = {}) {
  const targetSymbol = String(symbol || '').toUpperCase();
  const parsed = rows.filter(row => row && typeof row === 'object');
  const schemaCounts = {};
  for (const row of parsed) {
    const key = String(row.schemaVersion ?? 'missing');
    schemaCounts[key] = (schemaCounts[key] ?? 0) + 1;
  }

  const eligibleBase = parsed.filter(row =>
    row.mode === 'RESEARCH_ONLY'
    && row.provider === 'okx_public_market_data'
    && row.symbol === targetSymbol
    && row.schemaVersion === expectedSchemaVersion
    && Number.isFinite(capturedMs(row))
    && Number.isFinite(takerWindowMs(row))
    && takerWindowMs(row) > 0,
  ).sort((a, b) => capturedMs(a) - capturedMs(b));

  const historicalDefects = defectCounts(eligibleBase, maxGapMinutes);
  let latestSegmentStart = 0;
  for (let i = 1; i < eligibleBase.length; i += 1) {
    const gapMs = capturedMs(eligibleBase[i]) - capturedMs(eligibleBase[i - 1]);
    if (gapMs > maxGapMinutes * 60_000) latestSegmentStart = i;
  }
  const cohort = eligibleBase.slice(latestSegmentStart);
  const defects = defectCounts(cohort, maxGapMinutes);

  const independent = [];
  for (const row of cohort) {
    const prior = independent.at(-1);
    if (!prior) {
      independent.push(row);
      continue;
    }
    const elapsedMs = capturedMs(row) - capturedMs(prior);
    const requiredMs = Math.max(takerWindowMs(prior), takerWindowMs(row));
    if (elapsedMs >= requiredMs && elapsedMs <= maxGapMinutes * 60_000) independent.push(row);
  }

  const rawCount = cohort.length;
  const independentCount = independent.length;
  const effectiveRatio = rawCount > 0 ? independentCount / rawCount : 0;
  const qualityPass = rawCount > 0
    && defects.duplicateCloseTimes === 0
    && defects.nonCausalSequence === 0
    && defects.overlappingWindows === 0
    && defects.excessiveGaps === 0
    && effectiveRatio >= 0.95;

  const minimumRows = Math.max(1, Math.floor(Number(minIndependentRowsForPredeclaredStudy) || 20));
  const remainingIndependentRows = Math.max(0, minimumRows - independentCount);
  const readyForPredeclaredStudy = qualityPass && independentCount >= minimumRows;

  return {
    schemaVersion: 4,
    mode: 'RESEARCH_ONLY',
    researchUse: 'DATA_QUALITY_ONLY_NOT_FOR_RANKING',
    symbol: targetSymbol,
    expectedSchemaVersion,
    maxGapMinutes,
    rawRowCount: parsed.length,
    historicalEligibleRowCount: eligibleBase.length,
    eligibleRowCount: rawCount,
    independentRowCount: independentCount,
    effectiveIndependentRatio: effectiveRatio,
    schemaCounts,
    defects,
    historicalDefects,
    cohortResetCount: historicalDefects.excessiveGaps,
    cohortPolicy: 'LATEST_CONTIGUOUS_SEGMENT_AFTER_EXCESSIVE_GAP',
    firstEligibleCapturedAt: cohort[0]?.capturedAt ?? null,
    lastEligibleCapturedAt: cohort.at(-1)?.capturedAt ?? null,
    qualityPass,
    readiness: {
      purpose: 'MINIMUM_COHORT_SIZE_TO_BEGIN_PREDECLARED_STUDY_NOT_A_TRADING_GATE',
      minimumIndependentRows: minimumRows,
      remainingIndependentRows,
      readyForPredeclaredStudy,
      holdoutStillSealed: true,
      rankingAllowed: false,
    },
    boundaries: {
      holdoutUsedForRanking: false,
      liveTradingEnabled: false,
      realOrdersPlaced: false,
      changesRiskGates: false,
    },
  };
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

if (process.argv[1]?.endsWith('positioningDataQualityAudit.mjs')) {
  const args = process.argv.slice(2);
  const valueAfter = flag => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const input = valueAfter('--input');
  const out = valueAfter('--out');
  const symbol = valueAfter('--symbol') || 'BTCUSDT';
  if (!input) throw new Error('--input is required');
  const report = auditPositioningRows(readJsonl(input), { symbol });
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}
