import assert from 'node:assert/strict';
import { describe, it, before } from 'node:test';

// Import with the engine disabled so the cycle never reaches the network/DB during tests.
process.env.BREAKOUT_ENGINE_ENABLED = 'false';

let runBreakoutCycle, breakoutEngineConfig;
before(async () => {
  ({ runBreakoutCycle, breakoutEngineConfig } = await import('../strategies/breakoutEngine.mjs'));
});

describe('breakoutEngine', () => {
  it('exposes the validated breakout config', () => {
    const c = breakoutEngineConfig();
    assert.equal(c.tradeType, 'breakout_v1');
    assert.equal(c.breakoutPeriod, 55);
    assert.equal(c.regimeSmaPeriod, 200);
    assert.equal(c.tpPct, 0.08);
    assert.equal(c.slPct, 0.03);
    assert.ok(c.pairs.includes('BTCUSDT'));
  });

  it('does nothing and never executes when disabled', async () => {
    const r = await runBreakoutCycle();
    assert.equal(r.executed, 0);
    assert.equal(r.scanned, 0);
    assert.equal(r.blocked, false);
  });
});
