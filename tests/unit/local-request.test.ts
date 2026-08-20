import { describe, expect, it } from 'vitest';

import { resolveLocalRequest } from '../../src/local-models/local-request';

const detectAndTranslate = { autoDetectLanguage: true, supportsTranslation: true };
const detectOnly = { autoDetectLanguage: true, supportsTranslation: false };
const manualOnly = { autoDetectLanguage: false, supportsTranslation: true };

describe('resolveLocalRequest', () => {
  it('auto language on a detecting model lets the model detect', () => {
    expect(resolveLocalRequest('auto', 'transcribe', detectAndTranslate)).toEqual({
      ok: true,
      request: { language: undefined, task: 'transcribe' },
    });
  });

  it('undefined language behaves like auto', () => {
    expect(resolveLocalRequest(undefined, 'transcribe', detectAndTranslate)).toEqual({
      ok: true,
      request: { language: undefined, task: 'transcribe' },
    });
  });

  it('explicit language is passed through', () => {
    expect(resolveLocalRequest('es', 'transcribe', manualOnly)).toEqual({
      ok: true,
      request: { language: 'es', task: 'transcribe' },
    });
  });

  it('auto language on a non-detecting model requires an explicit language', () => {
    expect(resolveLocalRequest('auto', 'transcribe', manualOnly)).toEqual({
      ok: false,
      incompatibility: 'explicit-language-required',
    });
    expect(resolveLocalRequest(undefined, 'transcribe', manualOnly)).toEqual({
      ok: false,
      incompatibility: 'explicit-language-required',
    });
  });

  it('translate maps to the translate task when supported', () => {
    expect(resolveLocalRequest('es', 'translate', detectAndTranslate)).toEqual({
      ok: true,
      request: { language: 'es', task: 'translate' },
    });
  });

  it('translate on a non-translating model is rejected, never silently transcribed', () => {
    expect(resolveLocalRequest('es', 'translate', detectOnly)).toEqual({
      ok: false,
      incompatibility: 'translation-unsupported',
    });
  });
});
