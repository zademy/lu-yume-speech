import { describe, it, expect } from 'vitest';
import { timeAgo } from '../../src/utils/time-ago';

const NOW = 1_700_000_000_000;

describe('timeAgo (es)', () => {
  it('returns "ahora" for < 60s', () => {
    expect(timeAgo(NOW, NOW + 5_000)).toBe('ahora');
  });

  it('returns minutes for < 60m', () => {
    expect(timeAgo(NOW, NOW + 5 * 60_000)).toBe('hace 5 min');
  });

  it('returns hours for < 24h', () => {
    expect(timeAgo(NOW, NOW + 2 * 3_600_000)).toBe('hace 2 h');
  });

  it('returns "ayer" for exactly 1 day', () => {
    expect(timeAgo(NOW, NOW + 86_400_000)).toBe('ayer');
  });

  it('returns days for < 7d', () => {
    expect(timeAgo(NOW, NOW + 3 * 86_400_000)).toBe('hace 3 días');
  });

  it('returns formatted date for >= 7d', () => {
    const result = timeAgo(NOW, NOW + 10 * 86_400_000);
    expect(result).toMatch(/^\d+ \w{3}$/);
  });
});
