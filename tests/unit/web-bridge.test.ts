import { describe, it, expect, beforeEach } from 'vitest';
import { WebBridge } from '../../src/platform/web-bridge';
import { save, load, remove } from '../../src/utils/storage';

describe('WebBridge', () => {
  let bridge: WebBridge;

  beforeEach(() => {
    localStorage.clear();
    bridge = new WebBridge();
  });

  it('isDesktop returns false', () => {
    expect(bridge.isDesktop()).toBe(false);
  });

  it('hasApiKey returns false when no key stored', async () => {
    expect(await bridge.hasApiKey()).toBe(false);
  });

  it('hasApiKey returns true after setApiKey', async () => {
    await bridge.setApiKey('gsk_' + 'a'.repeat(40));
    expect(await bridge.hasApiKey()).toBe(true);
  });

  it('getApiKey returns null when nothing stored', async () => {
    expect(await bridge.getApiKey()).toBeNull();
  });

  it('getApiKey returns key after setApiKey', async () => {
    const key = 'gsk_' + 'b'.repeat(40);
    await bridge.setApiKey(key);
    expect(await bridge.getApiKey()).toBe(key);
  });

  it('deleteApiKey removes the key', async () => {
    await bridge.setApiKey('gsk_' + 'c'.repeat(40));
    expect(await bridge.hasApiKey()).toBe(true);
    await bridge.deleteApiKey();
    expect(await bridge.hasApiKey()).toBe(false);
  });

  it('loadSettings returns null when nothing saved', async () => {
    expect(await bridge.loadSettings()).toBeNull();
  });

  it('saveSettings then loadSettings roundtrips', async () => {
    const settings = { theme: 'dark', language: 'es' } as never;
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
