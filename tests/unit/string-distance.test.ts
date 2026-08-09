import { describe, expect, it } from 'vitest';

import { levenshtein, soundex, soundexMatch } from '../../src/utils/string-distance';

describe('levenshtein', () => {
  it('is zero for identical strings', () => {
    expect(levenshtein('hello', 'hello')).toBe(0);
  });

  it('equals the other length when one side is empty', () => {
    expect(levenshtein('', 'abc')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
  });

  it('counts single edits', () => {
    expect(levenshtein('helo', 'hello')).toBe(1); // insertion
    expect(levenshtein('hello', 'helloo')).toBe(1); // insertion
    expect(levenshtein('kitten', 'sitting')).toBe(3);
  });

  it('is symmetric', () => {
    expect(levenshtein('flaw', 'lawn')).toBe(levenshtein('lawn', 'flaw'));
  });
});

describe('soundex', () => {
  it('returns 0000 for empty or non-alpha input', () => {
    expect(soundex('')).toBe('0000');
    expect(soundex('123')).toBe('0000');
  });

  it('codes classic examples correctly', () => {
    expect(soundex('Robert')).toBe('R163');
    expect(soundex('Rupert')).toBe('R163');
    expect(soundex('Ashcraft')).toBe('A261');
  });

  it('matches phonetically similar words', () => {
    expect(soundexMatch('Robert', 'Rupert')).toBe(true);
  });

  it('distinguishes phonetically different words', () => {
    expect(soundexMatch('hello', 'world')).toBe(false);
  });
});
