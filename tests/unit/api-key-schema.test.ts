import { describe, it, expect } from 'vitest';
import { apiKeySchema } from '../../src/platform/api-key.schema';

describe('apiKeySchema', () => {
  it('accepts valid gsk_ key format', () => {
    expect(apiKeySchema.safeParse('gsk_' + 'a'.repeat(40)).success).toBe(true);
  });

  it('rejects empty string', () => {
    expect(apiKeySchema.safeParse('').success).toBe(false);
  });

  it('rejects key without gsk_ prefix', () => {
    expect(apiKeySchema.safeParse('abc_' + 'a'.repeat(40)).success).toBe(false);
  });

  it('rejects key that is too short', () => {
    expect(apiKeySchema.safeParse('gsk_short').success).toBe(false);
  });
});
