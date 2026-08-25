// server/genesis/__tests__/feeAccountant.test.mjs
// Fee math: taker percent on cost, BUY adds fee / SELL subtracts fee.

import { describe, it, expect } from 'vitest';
import { computeFee, netProceeds } from '../feeAccountant.mjs';

const SCHEMA = { makerPercent: 0.0001, takerPercent: 0.001, addedToCost: true };

describe('feeAccountant', () => {
  it('computeFee: taker 0.001 on cost 10000 -> 10', () => {
    const fee = computeFee({ schema: SCHEMA, isMaker: false, cost: 10_000 });
    expect(fee).toBeCloseTo(10, 9);
  });

  it('computeFee: maker tier uses makerPercent', () => {
    const fee = computeFee({ schema: SCHEMA, isMaker: true, cost: 10_000 });
    expect(fee).toBeCloseTo(1, 9);
  });

  it('netProceeds: BUY adds the fee on top of cost (addedToCost)', () => {
    const out = netProceeds({ side: 'BUY', cost: 10_000, fee: 10, schema: SCHEMA });
    expect(out).toBeCloseTo(10_010, 9);
  });

  it('netProceeds: SELL subtracts the fee from proceeds', () => {
    const out = netProceeds({ side: 'SELL', cost: 10_000, fee: 10, schema: SCHEMA });
    expect(out).toBeCloseTo(9_990, 9);
  });
});
