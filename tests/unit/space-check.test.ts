import { describe, expect, it } from 'vitest';

import {
  SPACE_TEMPORARY_BYTES,
  evaluateSpace,
  requiredFreeBytes,
} from '../../src/local-models/space-check';

const MIB = 1024 * 1024;

describe('requiredFreeBytes', () => {
  it('applies the 25% margin plus the temporaries constant', () => {
    const downloadBytes = 200 * MIB;
    // 200 MiB × 1.25 + temporaries
    expect(requiredFreeBytes(downloadBytes)).toBe(250 * MIB + SPACE_TEMPORARY_BYTES);
  });

  it('rounds the margin up to whole bytes', () => {
    expect(requiredFreeBytes(101)).toBe(Math.ceil(101 * 1.25) + SPACE_TEMPORARY_BYTES);
  });
});

describe('evaluateSpace', () => {
  it('passes when free space covers model + margin + temporaries', () => {
    const downloadBytes = 100 * MIB;
    const needed = requiredFreeBytes(downloadBytes);
    const outcome = evaluateSpace({
      downloadBytes,
      usageBytes: 500 * MIB,
      quotaBytes: 500 * MIB + needed,
    });
    expect(outcome).toEqual({ verdict: 'ok' });
  });

  it('warns as insufficient exactly below the requirement', () => {
    const downloadBytes = 100 * MIB;
    const needed = requiredFreeBytes(downloadBytes);
    const outcome = evaluateSpace({
      downloadBytes,
      usageBytes: 500 * MIB,
      quotaBytes: 500 * MIB + needed - 1,
    });
    expect(outcome).toEqual({
      verdict: 'insufficient',
      neededBytes: needed,
      availableBytes: needed - 1,
    });
  });

  it('never reports negative available bytes', () => {
    const outcome = evaluateSpace({
      downloadBytes: MIB,
      usageBytes: 900 * MIB,
      quotaBytes: 100 * MIB,
    });
    expect(outcome).toEqual({
      verdict: 'insufficient',
      neededBytes: requiredFreeBytes(MIB),
      availableBytes: 0,
    });
  });

  it('degrades to unreliable when the estimate is missing', () => {
    expect(evaluateSpace({ downloadBytes: MIB, usageBytes: null, quotaBytes: null })).toEqual({
      verdict: 'unreliable',
    });
    expect(evaluateSpace({ downloadBytes: MIB, usageBytes: 10, quotaBytes: null })).toEqual({
      verdict: 'unreliable',
    });
    expect(evaluateSpace({ downloadBytes: MIB, usageBytes: null, quotaBytes: 10 })).toEqual({
      verdict: 'unreliable',
    });
  });

  it('treats nonsensical estimates as unreliable', () => {
    expect(evaluateSpace({ downloadBytes: MIB, usageBytes: -1, quotaBytes: 10 * MIB })).toEqual({
      verdict: 'unreliable',
    });
    expect(evaluateSpace({ downloadBytes: MIB, usageBytes: 1, quotaBytes: -5 })).toEqual({
      verdict: 'unreliable',
    });
  });
});
