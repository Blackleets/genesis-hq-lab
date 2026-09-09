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

export function auditPositioningRows(rows = [], { expectedSchemaVersion = 4, maxGapMinutes = 60 } = {}) {
  const parsed = rows.filter(row => row && typeof row === 'object');
  const schemaCounts = {};
  for (const row of parsed) {
    const key = String(row.schemaVersion ?? 'missing');
    schemaCounts[key] = (schemaCounts[key] ?? 0) + 1;
  }

  const eligibleBase = parsed.filter(row =>
    row.mode === 'RESEARCH_ONLY'
    && row.provider === 'okx_public_market_data'
    && row.symbol === 'BTCUSDT'
    && row.schemaVersion === expectedSchemaVersion
    && Number.isFinite(capturedMs(row))
    && Number.isFinite(takerWindowMs(row))
    && takerWindowMs(row) > 0,
  ).sort((a, b) => capturedMs(a) - capturedMs(b));

  let duplicateCloseTimes = 0;
  let nonCausalSequence = 0;
  let overlappingWindows = 0;
  let excessiveGaps = 0;
  const closeTimes = new Set();

  for (let i = 0; i < eligibleBase.length; i += 1) {
    const row = eligibleBase[i];
    const closeTime = row?.price?.closeTime ?? null;
    if (closeTime && closeTimes.has(closeTime)) duplicateCloseTimes += 1;
    if (closeTime) closeTimes.add(closeTime);

    if (i === 0) continue;
    const prev = eligibleBase[i - 1];
    const elapsedMs = capturedMs(row) - capturedMs(prev);
    if (!(elapsedMs > 0)) nonCausalSequence += 1;
    const requiredMs = Math.max(takerWindowMs(prev), takerWindowMs(row));
    if (elapsedMs > 0 && elapsedMs < requiredMs) overlappingWindows += 1;
    if (elapsedMs > maxGapMinutes * 60_000) excessiveGaps += 1;
  }

  const independent = [];
  for (const row of eligibleBase) {
    const prior = independent.at(-1);
    if (!prior) {
      independent.push(row);
      continue;
    }
    const elapsedMs = capturedMs(row) - capturedMs(prior);
    const requiredMs = Math.max(takerWindowMs(prior), takerWindowMs(row));
    if (elapsedMs >= requiredMs && elapsedMs <= maxGapMinutes * 60_000) independent.push(row);
  }

  const rawCount = eligibleBase.length;
  const independentCount = independent.length;
  const effectiveRatio = rawCount > 0 ? independentCount / rawCount : 0;
  const qualityPass = rawCount > 0
    && duplicateCloseTimes === 0
    && nonCausalSequence === 0
    && overlappingWindows === 0
    && effectiveRatio >= 0.95;

  return {
    schemaVersion: 1,
    mode: 'RESEARCH_ONLY',
    researchUse: 'DATA_QUALITY_ONLY_NOT_FOR_RANKING',
    expectedSchemaVersion,
    rawRowCount: parsed.length,
    eligibleRowCount: rawCount,
    independentRowCount: independentCount,
    effectiveIndependentRatio: effectiveRatio,
    schemaCounts,
    defects: {
      duplicateCloseTimes,
      nonCausalSequence,
      overlappingWindows,
      excessiveGaps,
    },
    firstEligibleCapturedAt: eligibleBase[0]?.capturedAt ?? null,
    lastEligibleCapturedAt: eligibleBase.at(-1)?.capturedAt ?? null,
    qualityPass,
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
  if (!input) throw new Error('--input is required');
  const report = auditPositioningRows(readJsonl(input));
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(JSON.stringify(report, null, 2));
}
