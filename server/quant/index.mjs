// server/quant/index.mjs — Quant Lab public entry point.
// Re-exports the key APIs used by server/index.mjs route handlers.

export { getStrategyRegistry, getPromotedStrategies } from './alpha/strategyRegistry.mjs';
export { runSystemValidation, validateStrategyProfile } from './validation/validationGate.mjs';
export { computeAllocation } from './portfolio/allocationEngine.mjs';
export { getQuantState } from './quantState.mjs';
export { generateQuantReport } from './quantReport.mjs';
export { getWfCache, isWfCacheStale } from './wfCache.mjs';
export { executeWalkForward, isWfRunning } from './runWalkForward.mjs';
