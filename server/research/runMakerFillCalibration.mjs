// RESEARCH_ONLY maker fill calibration report runner.
// Reads durable queue-depletion observations and writes a machine-readable report.

import fs from 'node:fs';
import path from 'node:path';
import {
  MAKER_FILL_CALIBRATION_VERSION,
  calibrateMakerFillProbability,
} from '../genesis/makerFillCalibration.mjs';

export function readMakerFillObservationJsonl(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap(line => {
      try { return [JSON.parse(line)]; }
      catch { return []; }
    });
}

export function runMakerFillCalibration(input, out) {
  const observations = readMakerFillObservationJsonl(input);
  const report = {
    ...calibrateMakerFillProbability(observations),
    generatedAt: new Date().toISOString(),
    source: {
      input,
      observationContract: 'maker_queue_depletion_tape_v1',
    },
    boundaries: {
      executionAuthority: false,
      signsTransactions: false,
      broadcastsTransactions: false,
      liveLocked: true,
      notForLiveScoring: true,
    },
  };
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

if (process.argv[1]?.endsWith('runMakerFillCalibration.mjs')) {
  const args = process.argv.slice(2);
  const input = args.find(arg => !arg.startsWith('--'));
  const oi = args.indexOf('--out');
  const out = oi >= 0 ? args[oi + 1] : undefined;
  if (!input) {
    console.error('usage: node runMakerFillCalibration.mjs <maker-observations.jsonl> [--out report.json]');
    process.exitCode = 2;
  } else {
    const report = runMakerFillCalibration(input, out);
    console.log(JSON.stringify({
      version: MAKER_FILL_CALIBRATION_VERSION,
      rawObservationCount: report.rawObservationCount,
      validObservationCount: report.validObservationCount,
      calibratedCohortCount: report.calibratedCohortCount,
    }));
  }
}
