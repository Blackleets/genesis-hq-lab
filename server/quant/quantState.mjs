// quantState.mjs — lightweight snapshot of the full quant pipeline state.
// Reads from existing engines; never writes or executes.

import { getStrategyRegistry } from './alpha/strategyRegistry.mjs';
import { runSystemValidation } from './validation/validationGate.mjs';
import { computeAllocation } from './portfolio/allocationEngine.mjs';

/**
 * Return the current quant pipeline state.
 * All data comes from real engines — never invented.
 *
 * @returns {{ registry, validation, allocation, edgeVerdict, updatedAt }}
 */
export function getQuantState() {
  let registry   = null;
  let validation = null;
  let allocation = null;
  const errors   = {};

  try { registry   = getStrategyRegistry();  } catch (e) { errors.registry   = e.message; }
  try { validation = runSystemValidation();  } catch (e) { errors.validation  = e.message; }
  try { allocation = computeAllocation();    } catch (e) { errors.allocation  = e.message; }

  // Derive the headline edge verdict
  const edgeVerdict = deriveEdgeVerdict(validation, registry);

  return {
    registry,
    validation,
    allocation,
    edgeVerdict,
    errors: Object.keys(errors).length > 0 ? errors : null,
    updatedAt: new Date().toISOString(),
  };
}

function deriveEdgeVerdict(validation, registry) {
  if (!validation) return { answer: 'UNKNOWN', reason: 'Validation engine unavailable' };

  if (validation.status === 'SAFE_MODE') {
    return { answer: 'NO', reason: 'Safe mode active — no capital allocation permitted' };
  }
  if (validation.status === 'INSUFFICIENT_DATA') {
    const n = validation.metrics?.totalTrades ?? 0;
    return {
      answer: 'NO',
      reason: `Only ${n}/30 closed trades — insufficient data to assess edge`,
      missingTrades: Math.max(0, 30 - n),
    };
  }
  if (validation.status === 'REJECTED') {
    return {
      answer: 'NO',
      reason: validation.reasons.join(' | '),
      topBlocker: validation.reasons[0] ?? null,
    };
  }
  if (validation.status === 'APPROVED') {
    const promoted = validation.promotedStrategies ?? [];
    return {
      answer: 'YES',
      reason: `${promoted.length} strategy profile(s) validated`,
      promotedCount: promoted.length,
      metrics: {
        profitFactor: validation.metrics?.profitFactor,
        expectancy:   validation.metrics?.expectancy,
        winRate:      validation.metrics?.winRate,
      },
    };
  }
  return { answer: 'UNKNOWN', reason: 'Unexpected validation status' };
}
