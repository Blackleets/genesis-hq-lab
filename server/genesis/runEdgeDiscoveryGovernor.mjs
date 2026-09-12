import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { governHypothesisQueue } from './edgeDiscoveryGovernor.mjs';

const arg = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback;
};

async function readJson(path, fallback = null) {
  if (!path) return fallback;
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function main() {
  const edgePath = arg('--edge');
  const rawPath = arg('--raw');
  const adaptivePath = arg('--adaptive');
  const auditPath = arg('--audit');
  const forwardPath = arg('--forward');
  const deepLedgerPath = arg('--deep-ledger');
  const outPath = arg('--out', 'quant-evidence/edge-hypotheses-latest.json');
  const queueHistoryPath = arg('--queue-history', 'quant-evidence/edge-hypotheses-history.jsonl');
  const reportPath = arg('--report', 'quant-evidence/edge-discovery-governor-latest.json');
  const historyPath = arg('--history', 'quant-evidence/edge-discovery-governor-history.jsonl');

  if (!edgePath || !rawPath) throw new Error('edge_and_raw_hypotheses_required');

  const [edge, rawHypotheses, adaptive, audit, forward, deepLedger] = await Promise.all([
    readJson(edgePath),
    readJson(rawPath),
    readJson(adaptivePath),
    readJson(auditPath),
    readJson(forwardPath),
    readJson(deepLedgerPath),
  ]);

  if (!edge || !rawHypotheses) throw new Error('edge_discovery_source_missing');

  const { governedHypotheses, report } = governHypothesisQueue({
    edge,
    rawHypotheses,
    adaptive,
    audit,
    forward,
    deepLedger,
  });

  await mkdir(dirname(outPath), { recursive: true });
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(governedHypotheses, null, 2)}\n`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await appendFile(queueHistoryPath, `${JSON.stringify(governedHypotheses)}\n`);
  await appendFile(historyPath, `${JSON.stringify(report)}\n`);

  console.log(JSON.stringify({
    ok: true,
    discoveryStatus: report.discoveryStatus,
    fastResearchVerdict: report.fastResearch.verdict,
    deepResearchVerdict: report.deepResearch.verdict,
    forwardProven: report.forward.provenCount,
    rawQueueSize: report.hypothesisGovernance.rawQueueSize,
    governedQueueSize: report.hypothesisGovernance.governedQueueSize,
    contradictions: report.contradictions.map((item) => item.type),
    executionAuthority: false,
    liveOrders: false,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
