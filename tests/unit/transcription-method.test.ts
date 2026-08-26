import { describe, it, expect } from 'vitest';
import {
  TRANSCRIPTION_METHODS,
  methodChangePatch,
  hasActiveLocalModel,
  resolveCanDictate,
  resolveActiveTranscription,
  remoteKnobsLocked,
} from '../../src/utils/transcription-method';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { AppSettings } from '../../src/types';

function settingsWith(overrides: Partial<AppSettings>): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

describe('transcription-method', () => {
  describe('TRANSCRIPTION_METHODS', () => {
    it('offers exactly remote and local, remote first', () => {
      expect(TRANSCRIPTION_METHODS.map((m) => m.value)).toEqual(['remote', 'local']);
    });

    it('carries an i18n label key per option', () => {
      for (const option of TRANSCRIPTION_METHODS) {
        expect(option.labelKey).toMatch(/^method\./);
      }
    });
  });

  describe('methodChangePatch', () => {
    it('returns a patch that only carries the method', () => {
      const patch = methodChangePatch('local');
      expect(patch).toEqual({ transcriptionMethod: 'local' });
    });

    it('never touches provider, model or local model fields', () => {
      const current = settingsWith({
        transcriptionProvider: 'cloudflare-whisper',
        model: 'whisper-large-v3',
        localModelId: 'whisper-base',
      });
      const next: AppSettings = { ...current, ...methodChangePatch('local') };
      expect(next.transcriptionProvider).toBe('cloudflare-whisper');
      expect(next.model).toBe('whisper-large-v3');
      expect(next.localModelId).toBe('whisper-base');
    });

    it('switching back to remote keeps the local model selection', () => {
      const current = settingsWith({
        transcriptionMethod: 'local',
        localModelId: 'whisper-base',
      });
      const next: AppSettings = { ...current, ...methodChangePatch('remote') };
      expect(next.transcriptionMethod).toBe('remote');
      expect(next.localModelId).toBe('whisper-base');
    });
  });

  describe('hasActiveLocalModel', () => {
    it('is false with no active model (default)', () => {
      expect(hasActiveLocalModel(DEFAULT_SETTINGS)).toBe(false);
    });

    it('is true when a local model id is set', () => {
      expect(hasActiveLocalModel(settingsWith({ localModelId: 'whisper-base' }))).toBe(true);
    });

    it('treats an empty string as no model', () => {
      expect(hasActiveLocalModel(settingsWith({ localModelId: '' }))).toBe(false);
    });
  });

  describe('remoteKnobsLocked', () => {
    it('keeps the knobs free under remote + Groq', () => {
      expect(remoteKnobsLocked('remote', 'groq')).toBe(false);
    });

    it('locks the knobs under the worker provider (fixed model)', () => {
      expect(remoteKnobsLocked('remote', 'cloudflare-whisper')).toBe(true);
    });

    it('locks the knobs under the local method regardless of provider', () => {
      expect(remoteKnobsLocked('local', 'groq')).toBe(true);
      expect(remoteKnobsLocked('local', 'cloudflare-whisper')).toBe(true);
    });
  });

  describe('resolveCanDictate', () => {
    it('remote method follows the remote credential', () => {
      expect(
        resolveCanDictate({ method: 'remote', remoteCredentialOk: true, localModelReady: false }),
      ).toBe(true);
      expect(
        resolveCanDictate({ method: 'remote', remoteCredentialOk: false, localModelReady: true }),
      ).toBe(false);
    });

    it('local method requires an active local model regardless of credentials', () => {
      expect(
        resolveCanDictate({ method: 'local', remoteCredentialOk: true, localModelReady: false }),
      ).toBe(false);
      expect(
        resolveCanDictate({ method: 'local', remoteCredentialOk: false, localModelReady: true }),
      ).toBe(true);
    });
  });

  describe('resolveActiveTranscription', () => {
    it('remote + Groq follows the selected Groq model', () => {
      expect(resolveActiveTranscription(DEFAULT_SETTINGS)).toEqual({
        kind: 'groq',
        model: 'whisper-large-v3-turbo',
      });
      expect(resolveActiveTranscription(settingsWith({ model: 'whisper-large-v3' }))).toEqual({
        kind: 'groq',
        model: 'whisper-large-v3',
      });
    });

    it('remote + worker uses the fixed server-side model', () => {
      expect(
        resolveActiveTranscription(settingsWith({ transcriptionProvider: 'cloudflare-whisper' })),
      ).toEqual({ kind: 'worker', model: 'whisper-large-v3-turbo' });
    });

    it('local method follows the active local model id', () => {
      expect(
        resolveActiveTranscription(settingsWith({ transcriptionMethod: 'local', localModelId: 'whisper-small' })),
      ).toEqual({ kind: 'local', modelId: 'whisper-small' });
    });

    it('local method without an active model resolves to none', () => {
      expect(resolveActiveTranscription(settingsWith({ transcriptionMethod: 'local' }))).toEqual({
        kind: 'none',
      });
    });
  });
});
