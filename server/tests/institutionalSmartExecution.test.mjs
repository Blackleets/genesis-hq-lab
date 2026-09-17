import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseExecutionMode } from '../../src/core/institutionalSmartExecution.mjs';

test('WAIT wins when no execution mode clears net edge', () => {
  const result = chooseExecutionMode({
    maker: { spreadCaptureBps: 2, fillProbability: 0.5, makerFeeBps: 1, adverseSelectionBps: 3, inventoryRiskBps: 1, evidenceQuality: 0.9 },
    taker: { alphaBps: 4, takerFeeBps: 2, slippageBps: 2, latencyBps: 1, adverseSelectionBps: 1, evidenceQuality: 0.9 },
  });
  assert.equal(result.action, 'WAIT');
  assert.equal(result.executionAuthority, false);
  assert.equal(result.liveLocked, true);
});

test('MAKE wins when fill-adjusted maker economics are strongest', () => {
  const result = chooseExecutionMode({
    maker: { spreadCaptureBps: 15, fillProbability: 0.8, makerFeeBps: 1, adverseSelectionBps: 2, inventoryRiskBps: 1, evidenceQuality: 0.9 },
    taker: { alphaBps: 8, takerFeeBps: 2, slippageBps: 2, latencyBps: 1, adverseSelectionBps: 1, evidenceQuality: 0.9 },
  });
  assert.equal(result.action, 'MAKE');
  assert.ok(result.expectedNetBps > 0);
});

test('TAKE wins only after all explicit costs', () => {
  const result = chooseExecutionMode({
    maker: { spreadCaptureBps: 4, fillProbability: 0.2, makerFeeBps: 1, adverseSelectionBps: 2, inventoryRiskBps: 1, evidenceQuality: 0.9 },
    taker: { alphaBps: 14, takerFeeBps: 2, slippageBps: 2, latencyBps: 1, adverseSelectionBps: 1, evidenceQuality: 0.9 },
  });
  assert.equal(result.action, 'TAKE');
  assert.equal(result.expectedNetBps, 8);
  assert.equal(result.signsTransactions, false);
  assert.equal(result.broadcastsTransactions, false);
});

test('weak evidence forces WAIT even when nominal edge is huge', () => {
  const result = chooseExecutionMode({
    maker: { spreadCaptureBps: 100, fillProbability: 1, makerFeeBps: 0, adverseSelectionBps: 0, inventoryRiskBps: 0, evidenceQuality: 0.2 },
    taker: { alphaBps: 100, takerFeeBps: 0, slippageBps: 0, latencyBps: 0, adverseSelectionBps: 0, evidenceQuality: 0.2 },
  });
  assert.equal(result.action, 'WAIT');
});
