import { describe, expect, it } from 'vitest';

import { populateQualitySettings, readQualitySettings } from '../../src/utils/settings';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { AppSettings } from '../../src/types';
import type { AppElements } from '../../src/ui/renderer';

/** Build a minimal AppElements slice exposing only the quality controls. */
function qualityElements(): AppElements {
  const make = (id: string, tag: 'textarea' | 'input' | 'select'): HTMLElement => {
    const el = document.createElement(tag);
    el.id = id;
    return el;
  };
  const checkbox = (id: string, checked: boolean): HTMLInputElement => {
    const el = document.createElement('input');
    el.id = id;
    el.type = 'checkbox';
    el.checked = checked;
    return el;
  };
  return {
    customWordsInput: make('customWordsInput', 'textarea') as HTMLTextAreaElement,
    wordCorrectionThresholdSlider: make(
      'wordCorrectionThresholdSlider',
      'input',
    ) as HTMLInputElement,
    wordCorrectionThresholdValue: make('wordCorrectionThresholdValue', 'input') as HTMLSpanElement,
    customFillerWordsInput: make('customFillerWordsInput', 'input') as HTMLInputElement,
    silenceTrimToggle: checkbox('silenceTrimToggle', false),
    llmToggle: checkbox('llmToggle', false),
    localLlmAuth: checkbox('localLlmAuth', false),
    llmModelInput: make('llmModelInput', 'input') as HTMLInputElement,
    llmInstructionsInput: make('llmInstructionsInput', 'textarea') as HTMLTextAreaElement,
  } as unknown as AppElements;
}

describe('readQualitySettings', () => {
  it('parses custom words split by newline and comma, trimmed', () => {
    const el = qualityElements();
    el.customWordsInput.value = 'ChargeBee,\nOpenAI  ,  GPT-4';
    expect(readQualitySettings(el).customWords).toEqual(['ChargeBee', 'OpenAI', 'GPT-4']);
  });

  it('reads the threshold slider as a clamped number', () => {
    const el = qualityElements();
    el.wordCorrectionThresholdSlider.value = '0.35';
    expect(readQualitySettings(el).wordCorrectionThreshold).toBeCloseTo(0.35, 5);
  });

  it('maps an empty filler field to null (use language defaults)', () => {
    const el = qualityElements();
    el.customFillerWordsInput.value = '   ';
    expect(readQualitySettings(el).customFillerWords).toBeNull();
  });

  it('maps a non-empty filler field to a trimmed list', () => {
    const el = qualityElements();
    el.customFillerWordsInput.value = 'eh, o sea , bueno';
    expect(readQualitySettings(el).customFillerWords).toEqual(['eh', 'o sea', 'bueno']);
  });

  it('reads the silence/LLM toggles and LLM model + instructions', () => {
    const el = qualityElements();
    el.silenceTrimToggle.checked = true;
    el.llmToggle.checked = true;
    el.llmModelInput.value = 'llama-3.1-8b-instant';
    el.llmInstructionsInput.value = 'Tono formal';
    const out = readQualitySettings(el);
    expect(out.enableSilenceTrim).toBe(true);
    expect(out.enableLlmPostProcess).toBe(true);
    expect(out.llmModel).toBe('llama-3.1-8b-instant');
    expect(out.llmInstructions).toBe('Tono formal');
  });

  it('falls back to the default model when the field is empty', () => {
    const el = qualityElements();
    el.llmModelInput.value = '';
    expect(readQualitySettings(el).llmModel).toBe(DEFAULT_SETTINGS.llmModel);
  });
});

describe('populateQualitySettings', () => {
  it('writes the config values into the DOM controls', () => {
    const el = qualityElements();
    const config: AppSettings = {
      ...DEFAULT_SETTINGS,
      customWords: ['Foo', 'Bar'],
      wordCorrectionThreshold: 0.7,
      customFillerWords: ['eh'],
      enableSilenceTrim: false,
      enableLlmPostProcess: true,
      llmModel: 'custom-model',
      llmInstructions: 'Be concise.',
    };
    populateQualitySettings(el, config);
    expect(el.customWordsInput.value).toBe('Foo, Bar');
    expect(el.wordCorrectionThresholdSlider.value).toBe('0.7');
    expect(el.wordCorrectionThresholdValue.textContent).toBe('0.7');
    expect(el.customFillerWordsInput.value).toBe('eh');
    expect(el.silenceTrimToggle.checked).toBe(false);
    expect(el.llmToggle.checked).toBe(true);
    expect(el.llmModelInput.value).toBe('custom-model');
    expect(el.llmInstructionsInput.value).toBe('Be concise.');
  });

  it('renders null filler words as an empty field', () => {
    const el = qualityElements();
    populateQualitySettings(el, { ...DEFAULT_SETTINGS, customFillerWords: null });
    expect(el.customFillerWordsInput.value).toBe('');
  });
});
