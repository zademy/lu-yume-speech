import { describe, expect, it } from 'vitest';

import {
  applyCustomWords,
  filterTranscriptionOutput,
  fillerWordsForLanguage,
  postProcessText,
} from '../../src/utils/text-postprocess';

describe('applyCustomWords', () => {
  it('passes text through unchanged when the list is empty', () => {
    expect(applyCustomWords('hello world', [])).toBe('hello world');
  });

  it('corrects exact matches to the stored casing', () => {
    expect(applyCustomWords('hello world', ['Hello', 'World'])).toBe('Hello World');
  });

  it('corrects fuzzy misspellings', () => {
    expect(applyCustomWords('helo wrold', ['hello', 'world'], 0.5)).toBe('hello world');
  });

  it('joins split multi-word tokens (2-gram)', () => {
    const out = applyCustomWords('il cui nome è Charge B, che permette', ['ChargeBee'], 0.5);
    expect(out).toContain('ChargeBee,');
    expect(out).not.toContain('Charge B');
  });

  it('joins split multi-word tokens (3-gram)', () => {
    const out = applyCustomWords('use Chat G P T for this', ['ChatGPT'], 0.5);
    expect(out).toContain('ChatGPT');
  });

  it('prefers the longest matching n-gram', () => {
    expect(applyCustomWords('Open AI GPT model', ['OpenAI', 'GPT'], 0.5)).toBe('OpenAI GPT model');
  });

  it('preserves ALL-CAPS casing', () => {
    const out = applyCustomWords('CHARGE B is great', ['ChargeBee'], 0.5);
    expect(out).toContain('CHARGEBEE');
  });

  it('preserves Title-case casing (first char capped, rest of replacement kept)', () => {
    const out = applyCustomWords('Charge b is great', ['ChargeBee'], 0.5);
    expect(out).toContain('ChargeBee');
  });

  it('matches custom words that themselves contain spaces', () => {
    const out = applyCustomWords('using Mac Book Pro', ['MacBook Pro'], 0.5);
    expect(out).toContain('MacBook');
  });

  it('does not double trailing digits', () => {
    const out = applyCustomWords('use GPT4 for this', ['GPT-4'], 0.5);
    expect(out).not.toContain('GPT-44');
  });

  it('preserves surrounding punctuation', () => {
    const out = applyCustomWords('...hello world!', ['hello', 'world'], 0.5);
    expect(out).toContain('...');
    expect(out).toContain('!');
  });
});

describe('fillerWordsForLanguage', () => {
  it('includes "um" for English', () => {
    expect(fillerWordsForLanguage('en')).toContain('um');
  });

  it('excludes "um" for Portuguese (it means "a/an")', () => {
    expect(fillerWordsForLanguage('pt')).not.toContain('um');
  });

  it('excludes "ha" for Spanish (it means "has")', () => {
    expect(fillerWordsForLanguage('es')).not.toContain('ha');
  });

  it('normalizes region codes (pt-BR → pt)', () => {
    expect(fillerWordsForLanguage('pt-BR')).not.toContain('um');
  });

  it('falls back conservatively for unknown languages and keeps "um"', () => {
    expect(fillerWordsForLanguage('xx')).not.toContain('um');
  });
});

describe('filterTranscriptionOutput', () => {
  it('removes English filler words', () => {
    expect(
      filterTranscriptionOutput('So uhm I was thinking uh about this', {
        language: 'en',
        customFillerWords: null,
      }),
    ).toBe('So I was thinking about this');
  });

  it('is case-insensitive', () => {
    expect(
      filterTranscriptionOutput('UHM this is UH a test', {
        language: 'en',
        customFillerWords: null,
      }),
    ).toBe('this is a test');
  });

  it('drops a trailing comma or period on filler words', () => {
    expect(
      filterTranscriptionOutput("Well, uhm, I think, uh. that's right", {
        language: 'en',
        customFillerWords: null,
      }),
    ).toBe("Well, I think, that's right");
  });

  it('normalizes repeated whitespace and trims', () => {
    expect(
      filterTranscriptionOutput('  Hello    world   test  ', {
        language: 'en',
        customFillerWords: null,
      }),
    ).toBe('Hello world test');
  });

  it('preserves clean normal text', () => {
    expect(
      filterTranscriptionOutput('This is a completely normal sentence.', {
        language: 'en',
        customFillerWords: null,
      }),
    ).toBe('This is a completely normal sentence.');
  });

  it('preserves "um" in Portuguese', () => {
    expect(
      filterTranscriptionOutput('um gato bonito', { language: 'pt', customFillerWords: null }),
    ).toBe('um gato bonito');
  });

  it('preserves "ha" in Spanish', () => {
    expect(
      filterTranscriptionOutput('ha sido un buen día', { language: 'es', customFillerWords: null }),
    ).toBe('ha sido un buen día');
  });

  it('collapses 3+ repeated short-word stutters', () => {
    expect(
      filterTranscriptionOutput('I I I I think so so so so', {
        language: 'en',
        customFillerWords: null,
      }),
    ).toBe('I think so');
  });

  it('collapses long-word stutters preserving the head', () => {
    expect(
      filterTranscriptionOutput('Check data doc doc doc doc documentation.', {
        language: 'en',
        customFillerWords: null,
      }),
    ).toBe('Check data doc documentation.');
  });

  it('leaves pairs of repetitions untouched', () => {
    expect(
      filterTranscriptionOutput('no no is fine', { language: 'en', customFillerWords: null }),
    ).toBe('no no is fine');
  });

  it('lets a custom filler list override the language defaults', () => {
    expect(
      filterTranscriptionOutput('okay so I think right this works', {
        language: 'en',
        customFillerWords: ['okay', 'right'],
      }),
    ).toBe('so I think this works');
  });

  it('disables filler filtering when the custom list is empty', () => {
    expect(
      filterTranscriptionOutput('So uhm I was thinking uh about this', {
        language: 'en',
        customFillerWords: [],
      }),
    ).toBe('So uhm I was thinking uh about this');
  });
});

describe('postProcessText', () => {
  it('returns empty input unchanged', () => {
    expect(
      postProcessText(
        '',
        { customWords: [], wordCorrectionThreshold: 0.5, customFillerWords: null },
        'en',
      ),
    ).toBe('');
  });

  it('chains custom-word correction then filler filtering', () => {
    const out = postProcessText(
      'uh I use Chat G P T helo',
      { customWords: ['ChatGPT', 'hello'], wordCorrectionThreshold: 0.5, customFillerWords: null },
      'en',
    );
    expect(out).toContain('ChatGPT');
    expect(out).not.toContain('helo');
    expect(out).not.toContain('uh');
  });
});
