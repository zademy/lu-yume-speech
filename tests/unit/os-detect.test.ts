import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('os-detect', () => {
  let detectOS: typeof import('../../src/utils/os-detect').detectOS;

  beforeEach(async () => {
    vi.resetModules();
    ({ detectOS } = await import('../../src/utils/os-detect'));
  });

  const setUA = (ua: string) => {
    Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
  };

  it('detects macOS and returns ⌥ modifier', () => {
    setUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15');
    const result = detectOS();
    expect(result.isMac).toBe(true);
    expect(result.modifierLabel).toBe('⌥');
  });

  it('detects non-Mac (Windows) and returns Ctrl modifier', () => {
    setUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    const result = detectOS();
    expect(result.isMac).toBe(false);
    expect(result.modifierLabel).toBe('Ctrl');
  });

  it('detects non-Mac (Linux)', () => {
    setUA('Mozilla/5.0 (X11; Linux x86_64)');
    expect(detectOS().isMac).toBe(false);
  });

  it('caches the result (same reference on second call)', () => {
    setUA('Mozilla/5.0 (Macintosh)');
    const first = detectOS();
    setUA('Mozilla/5.0 (Windows NT 10.0)');
    const second = detectOS();
    expect(second).toBe(first);
  });
});
