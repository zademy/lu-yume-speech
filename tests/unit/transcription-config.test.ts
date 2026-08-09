import { describe, expect, it } from 'vitest';

import { buildPrompt, toPostProcessConfig } from '../../src/utils/transcription-config';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { AppSettings } from '../../src/types';

const baseSettings: AppSettings = { ...DEFAULT_SETTINGS };

describe('buildPrompt', () => {
  it('returns undefined when there is nothing to send', () => {
    expect(buildPrompt([])).toBeUndefined();
    expect(buildPrompt([], '   ')).toBeUndefined();
    expect(buildPrompt(['   ', ''])).toBeUndefined();
  });

  it('joins custom words with a comma+space', () => {
    expect(buildPrompt(['ChargeBee', 'ChatGPT'])).toBe('ChargeBee, ChatGPT');
  });

  it('uses the manual prompt alone when no custom words are set', () => {
    expect(buildPrompt([], 'Previous transcript context.')).toBe('Previous transcript context.');
  });

  it('prepends manual context before the vocabulary', () => {
    expect(buildPrompt(['OpenAI'], 'The meeting notes')).toBe('The meeting notes OpenAI');
  });

  it('trims whitespace from every piece', () => {
    expect(buildPrompt(['  spaced  ', 'words'], '  ctx  ')).toBe('ctx spaced, words');
  });

  it('truncates very long prompts to stay within the token budget', () => {
    const long = 'x'.repeat(2000);
    const out = buildPrompt([], long);
    expect(out).toBeDefined();
    expect(out!.length).toBeLessThanOrEqual(1024);
  });
});

describe('toPostProcessConfig', () => {
  it('maps the relevant settings fields into the post-process config', () => {
    const settings: AppSettings = {
      ...baseSettings,
      customWords: ['Foo', 'Bar'],
      wordCorrectionThreshold: 0.3,
      customFillerWords: ['okay'],
    };
    expect(toPostProcessConfig(settings)).toEqual({
      customWords: ['Foo', 'Bar'],
      wordCorrectionThreshold: 0.3,
      customFillerWords: ['okay'],
    });
  });

  it('preserves a null customFillerWords (use language defaults)', () => {
    const cfg = toPostProcessConfig(baseSettings);
    expect(cfg.customFillerWords).toBeNull();
  });
});
