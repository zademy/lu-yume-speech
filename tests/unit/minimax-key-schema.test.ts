import { describe, it, expect } from 'vitest';
import { minimaxKeySchema } from '../../src/platform/minimax-key.schema';

describe('minimaxKeySchema', () => {
  it('accepts a key of at least 8 characters with any format', () => {
    expect(minimaxKeySchema.safeParse('sk-cp-example-key-1234').success).toBe(true);
    expect(minimaxKeySchema.safeParse('!@#$%^&*()x').success).toBe(true);
  });

  it('rejects empty or too-short keys', () => {
    expect(minimaxKeySchema.safeParse('').success).toBe(false);
    expect(minimaxKeySchema.safeParse('short').success).toBe(false);
    expect(minimaxKeySchema.safeParse('   ').success).toBe(false);
  });

  it('reports a Spanish error message', () => {
    const result = minimaxKeySchema.safeParse('x');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('8 caracteres');
    }
  });
});
