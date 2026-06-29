import { describe, it, expect, vi, afterEach } from 'vitest';

import { copyToClipboard } from '../../src/utils/clipboard';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when clipboard.writeText succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const result = await copyToClipboard('hello world');
    expect(writeText).toHaveBeenCalledWith('hello world');
    expect(result).toBe(true);
  });

  it('returns false when clipboard.writeText throws', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('Permission denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const result = await copyToClipboard('hello world');
    expect(result).toBe(false);
  });
});
