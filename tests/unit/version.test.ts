import { describe, it, expect } from 'vitest';

import { APP_VERSION } from '../../src/version';

describe('version', () => {
  it('resolves to a non-empty string', () => {
    expect(typeof APP_VERSION).toBe('string');
    expect(APP_VERSION.length).toBeGreaterThan(0);
  });
});
