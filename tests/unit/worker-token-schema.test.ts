import { describe, it, expect } from 'vitest';
import { workerTokenSchema } from '../../src/platform/worker-token.schema';

describe('workerTokenSchema', () => {
  it('accepts a token of at least 8 characters with any format', () => {
    expect(workerTokenSchema.safeParse('abc-12345').success).toBe(true);
    expect(workerTokenSchema.safeParse('!@#$%^&*()x').success).toBe(true);
  });

  it('rejects empty or too-short tokens', () => {
    expect(workerTokenSchema.safeParse('').success).toBe(false);
    expect(workerTokenSchema.safeParse('short').success).toBe(false);
    expect(workerTokenSchema.safeParse('   ').success).toBe(false);
  });

  it('reports a Spanish error message', () => {
    const result = workerTokenSchema.safeParse('x');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('8 caracteres');
    }
  });
});
