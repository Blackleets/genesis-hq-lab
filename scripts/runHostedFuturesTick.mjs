#!/usr/bin/env node

import { restoreFromPg, isReplicationEnabled, replicateOnce, getDbMode } from '../server/persistence/dbReplicator.mjs';
import { runStartupReconciliation } from '../server/memory/reconciliationEngine.mjs';
import { triggerSlow } from '../server/trading/executionScheduler.mjs';
import { writeHostedRunnerHeartbeat } from '../server/trading/hostedRunnerHeartbeat.mjs';

process.env.FUTURES_ONLY_MODE = 'true';
process.env.PREDICTION_AGENT_ENABLED = 'false';
process.env.LEGACY_CRYPTO_LOOP_ENABLED = 'false';
process.env.SCALP_ENGINE_ENABLED = 'false';
process.env.SWING_ENGINE_ENABLED = 'false';
process.env.EVENT_ALPHA_ENABLED = 'false';
process.env.BREAKOUT_ENGINE_ENABLED = 'false';
process.env.FUTURES_BREAKOUT_SHORT_ENABLED = process.env.FUTURES_BREAKOUT_SHORT_ENABLED ?? 'true';

const SOURCE = process.env.HOSTED_RUNNER_SOURCE || 'github_actions';

async function main() {
  if (!isReplicationEnabled()) {
    console.log(`[hosted-futures] skip — replication disabled (mode=${getDbMode()}, DATABASE_URL missing)`);
    return;
  }

  console.log(`[hosted-futures] restore start (${SOURCE})`);
  const restored = await restoreFromPg({ force: true });
  console.log(`[hosted-futures] restore result: ${JSON.stringify(restored)}`);

  await runStartupReconciliation({ futuresOnly: true });
  const cycle = await triggerSlow();
  const replication = await replicateOnce();

  const summary = {
    scanned: Number(cycle?.scanned ?? 0),
    qualified: Number(cycle?.qualified ?? 0),
    executed: Number(cycle?.executed ?? 0),
    blocked: Boolean(cycle?.blocked),
    replicationOk: Boolean(replication?.ok),
    replicationSynced: Number(replication?.synced ?? 0),
  };

  writeHostedRunnerHeartbeat({
    source: SOURCE,
    claudeEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
    lastResult: summary,
  });

  const finalReplication = await replicateOnce();
  console.log(`[hosted-futures] cycle summary: ${JSON.stringify(summary)}`);
  console.log(`[hosted-futures] final replicate: ${JSON.stringify(finalReplication)}`);
}

main().catch(async (error) => {
  try {
    writeHostedRunnerHeartbeat({
      source: SOURCE,
      claudeEnabled: Boolean(process.env.ANTHROPIC_API_KEY),
      lastResult: { ok: false, error: error instanceof Error ? error.message : String(error) },
    });
    await replicateOnce();
  } catch { /* best effort */ }
  console.error('[hosted-futures] failed:', error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
