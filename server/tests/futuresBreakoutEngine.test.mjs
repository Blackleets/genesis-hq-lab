import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

process.env.FUTURES_BREAKOUT_SHORT_ENABLED = 'false';
process.env.FUTURES_BREAKOUT_LONG_ENABLED = 'false';

let runFuturesBreakoutCycle, futuresBreakoutEngineConfig;
before(async () => {
  ({ runFuturesBreakoutCycle, futuresBreakoutEngineConfig } = await import('../strategies/futuresBreakoutEngine.mjs'));
});

describe('futuresBreakoutEngine', () => {
  it('exposes short-core and long-probe profiles', () => {
    const config = futuresBreakoutEngineConfig();
    const ids = config.profiles.map((profile) => profile.id);
    assert.ok(ids.includes('short_core'));
    assert.ok(ids.includes('long_probe'));
    assert.equal(config.breakoutPeriod, 55);
    assert.equal(config.regimeSmaPeriod, 200);
  });

  it('family master switches disable every profile on that side', () => {
    const config = futuresBreakoutEngineConfig();
    // SHORT_ENABLED=false + LONG_ENABLED=false must gate ALL profiles,
    // including sub-profiles with their own flags (micro / alt).
    for (const profile of config.profiles) {
      assert.equal(profile.enabled, false, `profile ${profile.id} must be disabled by its family master switch`);
    }
  });

  it('does nothing and never executes when both families are disabled', async () => {
    const result = await runFuturesBreakoutCycle();
    assert.equal(result.executed, 0);
    assert.equal(result.scanned, 0);
    assert.equal(result.blocked, false);
    assert.equal(result.profiles.length, futuresBreakoutEngineConfig().profiles.length);
  });
});
