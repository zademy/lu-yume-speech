import { describe, expect, it } from 'vitest';

import { memoryTierGuard } from '../../src/local-models/memory-guard';

describe('memoryTierGuard', () => {
  it('stays silent when the device reports no RAM (unreliable signal)', () => {
    expect(memoryTierGuard('light', null)).toEqual({ level: 'ok' });
    expect(memoryTierGuard('high', null)).toEqual({ level: 'ok' });
    expect(memoryTierGuard('very-high', null)).toEqual({ level: 'ok' });
  });

  it('stays silent on nonsensical reports', () => {
    expect(memoryTierGuard('high', 0)).toEqual({ level: 'ok' });
    expect(memoryTierGuard('high', Number.NaN)).toEqual({ level: 'ok' });
    expect(memoryTierGuard('high', -4)).toEqual({ level: 'ok' });
  });

  it('passes when reported RAM meets the tier minimum', () => {
    expect(memoryTierGuard('light', 1)).toEqual({ level: 'ok' });
    expect(memoryTierGuard('medium', 2)).toEqual({ level: 'ok' });
    expect(memoryTierGuard('high', 4)).toEqual({ level: 'ok' });
    expect(memoryTierGuard('very-high', 8)).toEqual({ level: 'ok' });
  });

  it('warns below the tier minimum', () => {
    expect(memoryTierGuard('medium', 1.5)).toEqual({ level: 'warn', minGb: 2 });
    expect(memoryTierGuard('high', 2)).toEqual({ level: 'warn', minGb: 4 });
    expect(memoryTierGuard('very-high', 4)).toEqual({ level: 'warn', minGb: 6 });
  });

  it('blocks only the extreme mismatch: very-high on ≤2 GB', () => {
    expect(memoryTierGuard('very-high', 2)).toEqual({ level: 'block', minGb: 6 });
    expect(memoryTierGuard('very-high', 1)).toEqual({ level: 'block', minGb: 6 });
    // Every other tier on tiny devices still only warns.
    expect(memoryTierGuard('high', 1)).toEqual({ level: 'warn', minGb: 4 });
  });
});
