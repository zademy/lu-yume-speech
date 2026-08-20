import { describe, expect, it } from 'vitest';

import { normalizeTranscript, wordErrorRate } from '../../src/utils/benchmark/wer';
import { derivePrecision, deriveSpeed } from '../../src/utils/benchmark/thresholds';

describe('normalizeTranscript', () => {
  it('lowercases and strips punctuation into words', () => {
    expect(normalizeTranscript('¡Hola, Mundo! — el informe (v2): listo.')).toEqual([
      'hola',
      'mundo',
      'el',
      'informe',
      'v2',
      'listo',
    ]);
  });

  it('collapses whitespace and ignores empty input', () => {
    expect(normalizeTranscript('   ')).toEqual([]);
    expect(normalizeTranscript('a\t\nb')).toEqual(['a', 'b']);
  });
});

describe('wordErrorRate', () => {
  it('is 0 for an exact match modulo case and punctuation', () => {
    expect(wordErrorRate('La reunión comienza.', 'la reunión comienza')).toBe(0);
  });

  it('counts substitutions', () => {
    // 1 substitution over 4 reference words.
    expect(wordErrorRate('la reunión de ventas', 'la reunión del presupuesto')).toBeCloseTo(2 / 4);
  });

  it('counts deletions and insertions', () => {
    // ref 5 words, hyp drops one and adds one → 2/5.
    expect(wordErrorRate('el gato negro duerme mucho', 'el negro duerme mucho ya')).toBeCloseTo(
      2 / 5,
    );
  });

  it('is 1 when the hypothesis is empty', () => {
    expect(wordErrorRate('hola mundo', '')).toBe(1);
  });

  it('returns worst-case 1 on an empty reference instead of dividing by zero', () => {
    expect(wordErrorRate('', 'algo')).toBe(1);
  });
});

describe('label thresholds (public, documented)', () => {
  it('precision buckets at the documented WER cuts', () => {
    expect(derivePrecision(0.0)).toBe('high');
    expect(derivePrecision(0.08)).toBe('high');
    expect(derivePrecision(0.081)).toBe('medium');
    expect(derivePrecision(0.2)).toBe('medium');
    expect(derivePrecision(0.21)).toBe('basic');
  });

  it('speed buckets at the documented RTF cuts', () => {
    expect(deriveSpeed(0.3)).toBe('fast');
    expect(deriveSpeed(0.5)).toBe('fast');
    expect(deriveSpeed(0.9)).toBe('balanced');
    expect(deriveSpeed(1.5)).toBe('balanced');
    expect(deriveSpeed(2.0)).toBe('slow');
  });
});
