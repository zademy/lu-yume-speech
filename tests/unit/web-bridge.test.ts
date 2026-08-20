import { describe, it, expect, beforeEach } from 'vitest';
import { WebBridge } from '../../src/platform/web-bridge';
import { detectPlatform } from '../../src/platform/platform';
import { save, load, remove } from '../../src/utils/storage';

describe('WebBridge', () => {
  let bridge: WebBridge;

  beforeEach(() => {
    localStorage.clear();
    bridge = new WebBridge();
  });

  it('detectPlatform returns a cached WebBridge instance', () => {
    const platform = detectPlatform();
    expect(platform).toBeInstanceOf(WebBridge);
    expect(detectPlatform()).toBe(platform);
  });

  describe('groq credential', () => {
    it('hasCredential returns false when no key stored', async () => {
      expect(await bridge.hasCredential('groq')).toBe(false);
    });

    it('hasCredential returns true after setCredential', async () => {
      await bridge.setCredential('groq', 'gsk_' + 'a'.repeat(40));
      expect(await bridge.hasCredential('groq')).toBe(true);
    });

    it('getCredential returns null when nothing stored', async () => {
      expect(await bridge.getCredential('groq')).toBeNull();
    });

    it('getCredential returns key after setCredential', async () => {
      const key = 'gsk_' + 'b'.repeat(40);
      await bridge.setCredential('groq', key);
      expect(await bridge.getCredential('groq')).toBe(key);
    });

    it('deleteCredential removes the key', async () => {
      await bridge.setCredential('groq', 'gsk_' + 'c'.repeat(40));
      expect(await bridge.hasCredential('groq')).toBe(true);
      await bridge.deleteCredential('groq');
      expect(await bridge.hasCredential('groq')).toBe(false);
    });

    it('keeps the historical stt_groq_api_key storage key (no migration)', async () => {
      await bridge.setCredential('groq', 'legacy-value');
      expect(localStorage.getItem('stt_groq_api_key')).toBe(JSON.stringify('legacy-value'));
      localStorage.setItem('stt_groq_api_key', JSON.stringify('pre-existing'));
      expect(await bridge.getCredential('groq')).toBe('pre-existing');
    });
  });

  describe('worker credential', () => {
    it('roundtrips set/get/has/delete independently of groq', async () => {
      await bridge.setCredential('groq', 'gsk_' + 'd'.repeat(40));
      await bridge.setCredential('worker', 'worker-secret-token');

      expect(await bridge.getCredential('worker')).toBe('worker-secret-token');
      expect(await bridge.hasCredential('worker')).toBe(true);
      expect(localStorage.getItem('stt_worker_token')).toBe(JSON.stringify('worker-secret-token'));

      await bridge.deleteCredential('worker');
      expect(await bridge.hasCredential('worker')).toBe(false);
      expect(await bridge.hasCredential('groq')).toBe(true);
    });
  });

  describe('gate credential', () => {
    it('roundtrips set/get/has/delete independently of groq and worker', async () => {
      await bridge.setCredential('gate', 'v1.c2FsdA.dGhlZGlnZXN0');
      expect(await bridge.hasCredential('gate')).toBe(true);
      expect(await bridge.getCredential('gate')).toBe('v1.c2FsdA.dGhlZGlnZXN0');
      expect(localStorage.getItem('stt_gate_credential')).toBe(
        JSON.stringify('v1.c2FsdA.dGhlZGlnZXN0'),
      );

      await bridge.deleteCredential('gate');
      expect(await bridge.hasCredential('gate')).toBe(false);
      expect(await bridge.hasCredential('groq')).toBe(false);
      expect(await bridge.hasCredential('worker')).toBe(false);
    });
  });

  it('loadSettings returns null when nothing saved', async () => {
    expect(await bridge.loadSettings()).toBeNull();
  });

  it('saveSettings then loadSettings roundtrips', async () => {
    const settings = { theme: 'dark', language: 'es' } as never;
    await bridge.saveSettings(settings);
    expect(await bridge.loadSettings()).toEqual(settings);
  });

  it('roundtrips the transcription method selections independently', async () => {
    const settings = {
      transcriptionMethod: 'local',
      transcriptionProvider: 'cloudflare-whisper',
      localModelId: 'whisper-base',
    } as never;
    await bridge.saveSettings(settings);
    expect(await bridge.loadSettings()).toEqual(settings);
  });

  it('roundtrips a null active local model', async () => {
    const settings = { transcriptionMethod: 'remote', localModelId: null } as never;
    await bridge.saveSettings(settings);
    expect(await bridge.loadSettings()).toEqual(settings);
  });

  it('uses stt_ prefix via storage utils', () => {
    save('groq_api_key', 'test-value');
    expect(load<string | null>('groq_api_key', null)).toBe('test-value');
    remove('groq_api_key');
    expect(load<string | null>('groq_api_key', null)).toBeNull();
  });
});
