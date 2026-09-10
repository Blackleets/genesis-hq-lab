import { describe, expect, it } from 'vitest';
import {
  ATR_PERIOD,
  ECONOMICS_GATE,
  EXIT_MODEL,
  TARGET_COST_MULTIPLE,
  adaptiveExitGeometry,
  atrPctAt,
  candidateGrid,
  candidateId,
  conservativeCostPct,
} from '../../supabase/functions/_shared/quant-challenger-core.mjs';

function flatRows({ high = 101, low = 99, close = 100, count = 30 } = {}) {
  return Array.from({ length: count }, (_, index) => [index * 60_000, 100, high, low, close, 1, (index + 1) * 60_000 - 1, 1_000_000]);
}

describe('quant challenger v2 core', () => {
  it('uses trailing ATR only and normalizes it by the signal close', () => {
    const rows = flatRows();
    expect(ATR_PERIOD).toBe(14);
    expect(atrPctAt(rows, 14)).toBeCloseTo(0.02, 8);
    expect(atrPctAt(rows, 13)).toBeNull();
  });

  it('builds an ATR-multiplier grid instead of fixed 4/8/12 percent exits', () => {
    const grid = candidateGrid(20, 2);
    expect(grid).toHaveLength(40);
    expect(new Set(grid.map((item) => item.targetAtr))).toEqual(new Set([1, 1.5, 2]));
    expect(grid.some((item) => Object.hasOwn(item, 'targetPct'))).toBe(false);
    expect(candidateId('short_micro', grid[0])).toContain('ta');
  });

  it('prices conservative round-trip friction before admitting a signal', () => {
    const cost = conservativeCostPct(0.0001, 2);
    expect(cost).toBeCloseTo(0.001025, 8);
    expect(TARGET_COST_MULTIPLE).toBe(2);
    expect(ECONOMICS_GATE).toContain('2x');
  });

  it('admits ATR exits whose gross target clears conservative friction by 2x', () => {
    const rows = flatRows();
    const geometry = adaptiveExitGeometry(rows, 14, { period: 20, targetAtr: 1.5, stopAtr: 0.75, timeoutHours: 2 }, 0.0001);
    expect(EXIT_MODEL).toBe('atr14_adaptive_v1');
    expect(geometry.valid).toBe(true);
    expect(geometry.targetPct).toBeCloseTo(0.03, 8);
    expect(geometry.stopPct).toBeCloseTo(0.015, 8);
    expect(geometry.targetCostRatio).toBeGreaterThan(2);
    expect(geometry.economicsPass).toBe(true);
  });

  it('rejects tiny-volatility signals when the target cannot pay friction', () => {
    const rows = flatRows({ high: 100.01, low: 99.99 });
    const geometry = adaptiveExitGeometry(rows, 14, { period: 20, targetAtr: 1, stopAtr: 0.75, timeoutHours: 2 }, 0.0001);
    expect(geometry.valid).toBe(true);
    expect(geometry.targetPct).toBeCloseTo(0.0005, 8);
    expect(geometry.targetCostRatio).toBeLessThan(2);
    expect(geometry.economicsPass).toBe(false);
  });
});
