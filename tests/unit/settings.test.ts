import { describe, it, expect } from 'vitest';
import { readTranscriptionOptions, readOperationMode } from '../../src/utils/settings';
import type { AppElements } from '../../src/ui/renderer';

/** Create a <select> whose .value is a plain data property (jsdom-safe). */
function selectWithValue(value: string): HTMLSelectElement {
  const sel = document.createElement('select');
  Object.defineProperty(sel, 'value', { value, configurable: true, writable: true });
  return sel;
}

/** Build a minimal AppElements stub with sensible defaults. */
function makeElements(overrides: Partial<AppElements> = {}): AppElements {
  return {
    root: document.createElement('div'),
    modelSelect: selectWithValue('whisper-large-v3-turbo'),
    operationModeSelect: selectWithValue('transcribe'),
    recordModeSelect: selectWithValue('push-to-talk'),
    languageSelect: selectWithValue('es'),
    promptInput: Object.assign(document.createElement('textarea'), { value: '' }),
    temperatureSlider: Object.assign(document.createElement('input'), { value: '0.5' }),
    temperatureValue: document.createElement('span'),
    responseFormatSelect: selectWithValue('json'),
    timestampToggle: Object.assign(document.createElement('input'), { checked: false }),
    statusDiv: document.createElement('div'),
    waveformCanvas: document.createElement('canvas'),
    timerDisplay: document.createElement('span'),
    outputArea: document.createElement('textarea'),
    wordCount: document.createElement('span'),
    metadataPanel: document.createElement('div'),
    toastContainer: document.createElement('div'),
    themeToggle: document.createElement('button'),
    copyAllBtn: document.createElement('button'),
    clearBtn: document.createElement('button'),
    downloadBtn: document.createElement('button'),
    headerActions: document.createElement('div'),
    ...overrides,
  } as AppElements;
}

describe('settings — readTranscriptionOptions', () => {
  it('clamps temperature below 0 to 0', () => {
    const elements = makeElements({
      temperatureSlider: Object.assign(document.createElement('input'), {
        value: '-5',
      }) as HTMLInputElement,
    });
    expect(readTranscriptionOptions(elements).temperature).toBe(0);
  });

  it('clamps temperature above 1 to 1', () => {
    const elements = makeElements({
      temperatureSlider: Object.assign(document.createElement('input'), {
        value: '99',
      }) as HTMLInputElement,
    });
    expect(readTranscriptionOptions(elements).temperature).toBe(1);
  });

  it('parses valid temperature normally', () => {
    const elements = makeElements({
      temperatureSlider: Object.assign(document.createElement('input'), {
        value: '0.7',
      }) as HTMLInputElement,
    });
    expect(readTranscriptionOptions(elements).temperature).toBe(0.7);
  });

  it('defaults to 0 for non-numeric input', () => {
    const elements = makeElements({
      temperatureSlider: Object.assign(document.createElement('input'), {
        value: 'abc',
      }) as HTMLInputElement,
    });
    expect(readTranscriptionOptions(elements).temperature).toBe(0);
  });

  it('returns a frozen object', () => {
    const opts = readTranscriptionOptions(makeElements());
    expect(Object.isFrozen(opts)).toBe(true);
  });

  it('omits language when set to auto', () => {
    const elements = makeElements({
      languageSelect: selectWithValue('auto'),
    });
    expect(readTranscriptionOptions(elements).language).toBeUndefined();
  });

  it('returns [segment] for verbose_json without word toggle', () => {
    const elements = makeElements({
      responseFormatSelect: selectWithValue('verbose_json'),
      timestampToggle: Object.assign(document.createElement('input'), {
        checked: false,
      }) as HTMLInputElement,
    });
    expect(readTranscriptionOptions(elements).timestampGranularities).toEqual(['segment']);
  });

  it('returns [word, segment] for verbose_json with word toggle', () => {
    const elements = makeElements({
      responseFormatSelect: selectWithValue('verbose_json'),
      timestampToggle: Object.assign(document.createElement('input'), {
        checked: true,
      }) as HTMLInputElement,
    });
    expect(readTranscriptionOptions(elements).timestampGranularities).toEqual(['word', 'segment']);
  });

  it('omits timestampGranularities for non-verbose_json formats', () => {
    const elements = makeElements({
      responseFormatSelect: selectWithValue('json'),
    });
    expect(readTranscriptionOptions(elements).timestampGranularities).toBeUndefined();
  });
});

describe('settings — readOperationMode', () => {
  it('returns the current operation mode value', () => {
    const elements = makeElements({
      operationModeSelect: selectWithValue('translate'),
    });
    expect(readOperationMode(elements)).toBe('translate');
  });

  it('returns transcribe when set', () => {
    const elements = makeElements({
      operationModeSelect: selectWithValue('transcribe'),
    });
    expect(readOperationMode(elements)).toBe('transcribe');
  });
});
