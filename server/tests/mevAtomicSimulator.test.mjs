import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATOMIC_SIMULATION_VERSION,
  SIMULATION_EXECUTION_AUTHORITY,
  VENUE_CODES,
  applyAtomicSimulationEvidence,
  buildAtomicSimulationRequest,
  getAtomicSimulatorConfig,
  simulateAtomicArbitrage,
  validateAtomicSimulationRequest,
} from '../genesis/mevAtomicSimulator.mjs';

const USDC = '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const EXECUTOR = '0x1111111111111111111111111111111111111111';
const SENDER = '0x2222222222222222222222222222222222222222';

function request(overrides = {}) {
  return {
    tokenIn: USDC,
    tokenMid: WETH,
    amountIn: 1_000_000_000n,
    buyVenue: VENUE_CODES.UNISWAP_V3,
    buyFee: 500,
    sellVenue: VENUE_CODES.SUSHISWAP_V2,
    sellFee: 0,
    minFinalAmount: 1_001_000_000n,
    deadline: 2_000_000_000n,
    ...overrides,
  };
}

test('atomic simulator is structurally read-only', () => {
  assert.equal(SIMULATION_EXECUTION_AUTHORITY, false);
  assert.equal(ATOMIC_SIMULATION_VERSION, 'atomic_sim_v1');
});

test('executor configuration never invents an address', () => {
  const cfg = getAtomicSimulatorConfig({});
  assert.equal(cfg.executorConfigured, false);
  assert.equal(cfg.executorAddress, null);
});

test('request builder derives conservative minimum final amount', () => {
  const built = buildAtomicSimulationRequest({
    tokenIn: USDC,
    tokenMid: WETH,
    amountIn: 1_000_000_000n,
    buyVenue: VENUE_CODES.UNISWAP_V3,
    buyFee: 500,
    sellVenue: VENUE_CODES.SUSHISWAP_V2,
    sellFee: 0,
    quotedFinalAmount: 1_010_000_000n,
    slippageReserveBps: 20,
    nowSeconds: 1_900_000_000,
    ttlSeconds: 60,
  });
  assert.equal(built.minFinalAmount, 1_007_980_000n);
  assert.equal(built.deadline, 1_900_000_060n);
  assert.equal(validateAtomicSimulationRequest(built).ok, true);
});

test('arbitrary venue codes and invalid fee tiers fail closed', () => {
  assert.equal(validateAtomicSimulationRequest(request({ buyVenue: 99 })).ok, false);
  assert.equal(validateAtomicSimulationRequest(request({ buyFee: 777 })).ok, false);
  assert.equal(validateAtomicSimulationRequest(request({ sellFee: 3000 })).ok, false);
});

test('missing executor does not attempt simulation', async () => {
  let called = false;
  const fakeClient = {
    async simulateContract() { called = true; return { result: 1_010_000_000n }; },
    async estimateContractGas() { called = true; return 300_000n; },
  };
  const result = await simulateAtomicArbitrage({
    client: fakeClient,
    blockNumber: 123n,
    request: request(),
    config: getAtomicSimulatorConfig({}),
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'executor_not_configured');
  assert.equal(called, false);
});

test('successful eth_call simulation emits deterministic proof and measured gas', async () => {
  const fakeClient = {
    async simulateContract(args) {
      assert.equal(args.address, EXECUTOR);
      assert.equal(args.functionName, 'simulateArbitrage');
      assert.equal(args.blockNumber, 123456n);
      assert.equal(args.account, SENDER);
      return { result: 1_012_000_000n };
    },
    async estimateContractGas() {
      return 320_000n;
    },
  };
  const config = getAtomicSimulatorConfig({
    GENESIS_MEV_EXECUTOR_ADDRESS: EXECUTOR,
    GENESIS_MEV_SIMULATION_FROM: SENDER,
    GENESIS_MEV_MAX_SIM_GAS_UNITS: '600000',
  });
  const first = await simulateAtomicArbitrage({
    client: fakeClient,
    blockNumber: 123456n,
    routeId: 'uni500->sushi',
    request: request(),
    config,
  });
  const second = await simulateAtomicArbitrage({
    client: fakeClient,
    blockNumber: 123456n,
    routeId: 'uni500->sushi',
    request: request(),
    config,
  });
  assert.equal(first.ok, true);
  assert.equal(first.atomic, true);
  assert.equal(first.simulationSuccess, true);
  assert.equal(first.gasUnits, 320_000n);
  assert.equal(first.finalAmountOut, 1_012_000_000n);
  assert.equal(first.proof, second.proof);
  assert.equal(first.proof.length, 64);
});

test('revert remains filtered and never upgrades atomic evidence', async () => {
  const fakeClient = {
    async simulateContract() { throw new Error('execution reverted: insufficient profit'); },
    async estimateContractGas() { throw new Error('must not reach'); },
  };
  const simulation = await simulateAtomicArbitrage({
    client: fakeClient,
    blockNumber: 999n,
    request: request(),
    config: getAtomicSimulatorConfig({ GENESIS_MEV_EXECUTOR_ADDRESS: EXECUTOR }),
  });
  assert.equal(simulation.ok, false);
  assert.equal(simulation.atomic, false);
  assert.equal(simulation.reason, 'atomic_simulation_reverted');

  const enriched = applyAtomicSimulationEvidence({
    opportunity: { atomic: false, simulationSuccess: false, evidence: {} },
    simulation,
    gasPriceWei: 10_000_000_000n,
    ethUsd: 2000,
  });
  assert.equal(enriched.atomic, false);
  assert.equal(enriched.simulationSuccess, false);
  assert.equal(enriched.evidence.exactAtomicSimulation, false);
});

test('successful simulation replaces modeled gas/output with measured evidence', () => {
  const enriched = applyAtomicSimulationEvidence({
    opportunity: {
      sellAmountOut: 1010,
      gasCostUsd: 20,
      atomic: false,
      simulationSuccess: false,
      evidence: { source: 'same_block_quote' },
    },
    simulation: {
      ok: true,
      atomic: true,
      simulationSuccess: true,
      executorAddress: EXECUTOR,
      blockNumber: '123',
      finalAmountOut: 1_012_000_000n,
      gasUnits: 300_000n,
      proof: 'abc123',
    },
    gasPriceWei: 10_000_000_000n,
    ethUsd: 2000,
    outputTokenDecimals: 6,
  });
  assert.equal(enriched.atomic, true);
  assert.equal(enriched.simulationSuccess, true);
  assert.equal(enriched.sellAmountOut, 1012);
  assert.equal(enriched.gasCostUsd, 6);
  assert.equal(enriched.evidence.simulationProof, 'abc123');
  assert.equal(enriched.evidence.exactAtomicSimulation, true);
});
