import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { buildConnectorRegistry, VENUE_ENV, present, venueRequirements } from './hermesConnectorRegistry.mjs';

export const MODES = Object.freeze(['read_only', 'paper', 'testnet', 'live_locked', 'ready_for_external_cutover']);
const positive = value => typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

// Binds independent preflight evidence to this deployment, identity, account,
// strategy, risk limits AND credentials. A rotated key invalidates prior proof.
// Neither this digest nor any of these values are returned to the browser.
export function founderScope(env = {}) {
  const keys = ['GENESIS_OWNER_ADDRESS', 'GENESIS_EXECUTION_VENUE', 'GENESIS_ACCOUNT_ID',
    'GENESIS_STRATEGY_ID', 'GENESIS_STRATEGY_VERSION', 'GENESIS_REVISION',
    'GENESIS_MAX_DAILY_LOSS_USD', 'GENESIS_MAX_ORDER_NOTIONAL_USD',
    ...venueRequirements(env)];
  return createHash('sha256').update(JSON.stringify(keys.map(key => [key, env[key] ?? null]))).digest('hex');
}

function readEvidence(env, now) {
  // Evidence is issued by a separate operator-controlled preflight process.
  // This endpoint can only verify it; it cannot create approvals or proofs.
  try {
    const raw = env.GENESIS_PREFLIGHT_JSON;
    const key = env.GENESIS_PREFLIGHT_HMAC_KEY;
    const signature = env.GENESIS_PREFLIGHT_SIGNATURE;
    if (typeof raw !== 'string' || raw.length > 32_768 || typeof key !== 'string' || key.length < 32 || !/^[a-f0-9]{64}$/.test(signature ?? '')) return null;
    const expected = createHmac('sha256', key).update(raw).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, 'hex'))) return null;
    const proof = JSON.parse(raw);
    const issued = Date.parse(proof.issuedAt);
    const expires = Date.parse(proof.expiresAt);
    if (proof.version !== 1 || proof.scope !== founderScope(env) || !Number.isFinite(issued) || !Number.isFinite(expires)
      || issued > now || now - issued > 60_000 || expires <= now || expires - issued > 300_000) return null;
    return proof;
  } catch { return null; }
}

const AGENT_DEFINITIONS = [
  ['HERMES', 'Connector operations', 'Infrastructure', 'Validate feed freshness and connector permissions', ['market.read', 'readiness.read'], ['okx', 'binance', 'forex', 'prediction_markets', 'lp_farming']],
  ['ATLAS', 'Quant researcher', 'Research', 'Research futures scalping and funding/basis net of costs with out-of-sample evidence', ['research.read'], ['okx', 'binance']],
  ['ORACLE', 'Market regime analyst', 'Research', 'Classify volatility and Asia / London / New York sessions with DST-aware calendars', ['market.read'], ['okx', 'binance', 'forex']],
  ['SENTINEL', 'Risk governor', 'Control', 'Evaluate every founder gate; block cutover on missing or expired evidence', ['readiness.read', 'cutover.block'], ['execution_broker']],
  ['FORGE', 'Strategy challenger research', 'Research', 'Propose challengers; require leakage checks, cost models and walk-forward validation', ['research.read'], ['okx', 'binance']],
  ['AUDITOR', 'Economic reconciliation', 'Control', 'Use Truth Ledger v2 as source of truth for price P&L, funding, fees and MTM', ['ledger.read', 'audit.read'], ['execution_broker']],
  ['EXECUTION', 'Order preparation boundary', 'Execution', 'Remain locked until separately reviewed server-side execution and founder confirmation exist', ['readiness.read'], ['execution_broker']],
];

export function buildFounderSnapshot(env = {}, now = Date.now()) {
  const updatedAt = new Date(now).toISOString();
  const evidence = readEvidence(env, now);
  const gates = evidence?.gates ?? {};
  const maxDailyLoss = positive(env.GENESIS_MAX_DAILY_LOSS_USD);
  const maxOrderNotional = positive(env.GENESIS_MAX_ORDER_NOTIONAL_USD);
  const ownerVerified = /^0x[a-fA-F0-9]{40}$/.test(env.GENESIS_OWNER_ADDRESS ?? '') && gates.ownerVerified === true;
  const venue = Object.hasOwn(VENUE_ENV, env.GENESIS_EXECUTION_VENUE ?? '') ? env.GENESIS_EXECUTION_VENUE : null;
  const credentialsPresent = !!venue && present(env, 'GENESIS_ACCOUNT_ID') && VENUE_ENV[venue].every(key => present(env, key));
  const connectors = buildConnectorRegistry({ env, evidence, ownerVerified, now });
  const broker = connectors.find(c => c.id === 'execution_broker');
  const selected = connectors.find(c => c.id === (venue === 'oanda' ? 'forex' : venue));
  const check = (id, label, passed, reason) => ({ id, label, passed: passed === true, blocker: passed === true ? null : reason });
  const checks = [
    check('credentials', 'Server-side broker credentials', credentialsPresent, 'Selected broker/account credentials missing or unsupported venue'),
    check('owner', 'Owner wallet verified', ownerVerified, 'No current verified owner wallet proof'),
    check('kill_switch', 'Kill switch armed and tested', gates.killSwitchArmed === true && gates.killSwitchTested === true, 'Kill switch missing, disarmed or untested'),
    check('founder_pause', 'Founder emergency pause clear', env.GENESIS_FOUNDER_PAUSED === 'false' && gates.founderPauseClear === true, 'Founder pause is active or unknown'),
    check('daily_loss', 'Max daily loss (USD)', maxDailyLoss !== null, 'Define a positive finite max daily loss in USD'),
    check('order_notional', 'Max order notional (USD)', maxOrderNotional !== null, 'Define a positive finite max order notional in USD'),
    check('strategy', 'Versioned strategy approved', present(env, 'GENESIS_STRATEGY_ID') && present(env, 'GENESIS_STRATEGY_VERSION') && gates.strategyApproved === true, 'No approved versioned strategy with cost and out-of-sample evidence'),
    check('truth_ledger', 'Truth Ledger online and reconciled', gates.truthLedgerOnline === true && gates.ledgerReconciled === true, 'Truth Ledger health/reconciliation has no current proof'),
    check('audit_log', 'Durable audit log online', gates.auditLogOnline === true, 'Durable audit write/read verification missing'),
    check('broker_health', 'Broker/exchange authenticated health', broker.health === 'online' && selected?.health === 'online'
      && evidence?.connectors?.[selected?.id]?.mode === 'read_only'
      && evidence?.connectors?.execution_broker?.mode === 'read_only'
      && gates.brokerAuthenticated === true, 'Fresh authenticated selected-venue and execution-gateway checks missing (paper/testnet cannot qualify)'),
    check('execution_safety', 'Sandbox lifecycle and restart reconciliation', gates.executionSafetyVerified === true, 'Idempotency, ambiguous fills, limits and restart reconciliation not verified'),
    check('deployment', 'Current revision and signed preflight', present(env, 'GENESIS_REVISION') && !!evidence, 'Missing, expired, invalid or mismatched server-side preflight evidence'),
  ];
  const blockers = checks.filter(c => !c.passed).map(c => c.blocker);
  const readiness = blockers.length === 0 ? 'READY_FOR_EXTERNAL_CUTOVER' : 'BLOCKED';
  const agents = AGENT_DEFINITIONS.map(([id, role, desk, mission, permissions, connectedTo]) => {
    const isSentinel = id === 'SENTINEL';
    return { id, name: id, role, desk, mission, permissions, connectedTo,
      mode: id === 'EXECUTION' ? 'live_locked' : 'read_only',
      status: isSentinel ? (blockers.length ? 'blocking' : 'evaluated') : id === 'EXECUTION' ? 'locked' : 'not_running',
      currentTask: isSentinel ? 'Evaluate founder readiness for this request' : null,
      blockers: isSentinel || id === 'EXECUTION' ? [...blockers, ...(id === 'EXECUTION' ? ['External cutover only; no order submission in this slice'] : [])]
        : ['No operational runner heartbeat wired to this role'],
      metrics: { source: id === 'AUDITOR' ? 'Truth Ledger v2' : 'founder-readiness',
        evaluatedGates: isSentinel ? checks.length : null, blockedGates: isSentinel ? blockers.length : null,
        netPnl: null, completedTasks: null, lastHeartbeat: null },
      memory: { policy: 'No autonomous writes; keep only versioned evidence references', entries: 0 },
    };
  });
  return { ok: true, owner: { status: ownerVerified ? 'verified' : 'unverified', wallet: { status: ownerVerified ? 'verified' : 'unverified', custody: false } },
    mode: readiness === 'BLOCKED' ? 'live_locked' : 'ready_for_external_cutover', readiness, connectors, agents,
    risk: { currency: 'USD', maxDailyLoss, maxOrderNotional, killSwitchArmed: gates.killSwitchArmed === true,
      killSwitchTested: gates.killSwitchTested === true, founderPaused: env.GENESIS_FOUNDER_PAUSED !== 'false',
      strategyApproved: checks.find(c => c.id === 'strategy').passed },
    cutover: { status: readiness, checks, canExecute: false, requiresExternalOwnerConfirmation: true,
      evidenceExpiresAt: evidence ? new Date(Math.min(Date.parse(evidence.expiresAt), Date.parse(evidence.issuedAt) + 60_000,
        ...[broker.lastCheck, selected?.lastCheck].filter(Boolean).map(t => Date.parse(t) + 60_000))).toISOString() : null },
    blockers, updatedAt };
}
