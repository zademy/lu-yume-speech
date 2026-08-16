import { describe, it, expect, beforeEach } from 'vitest';
import { GateService } from '../../src/gate/gate-service';
import type { Platform } from '../../src/platform/platform';

/** In-memory Platform double — only the credential surface GateService uses. */
function createPlatformStub(): Platform & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async hasCredential(name) {
      return store.has(name);
    },
    async getCredential(name) {
      return store.get(name) ?? null;
    },
    async setCredential(name, value) {
      store.set(name, value);
    },
    async deleteCredential(name) {
      store.delete(name);
    },
    async loadSettings() {
      return null;
    },
    async saveSettings() {
      /* unused */
    },
  };
}

describe('GateService', () => {
  let platform: ReturnType<typeof createPlatformStub>;

  beforeEach(() => {
    platform = createPlatformStub();
  });

  describe('estado', () => {
    it('returns setup when no gate credential is stored', async () => {
      const gate = new GateService(platform);
      expect(await gate.estado()).toBe('setup');
    });

    it('returns locked once a credential exists (fresh instance = reload)', async () => {
      const gate = new GateService(platform);
      await gate.establecer('frase-de-acceso');
      expect(await new GateService(platform).estado()).toBe('locked');
    });
  });

  describe('establecer', () => {
    it('transitions setup → open and persists a hashed credential', async () => {
      const gate = new GateService(platform);
      const result = await gate.establecer('frase-de-acceso');
      expect(result).toEqual({ ok: true, state: 'open' });

      const stored = platform.store.get('gate');
      expect(stored).toBeTruthy();
      expect(stored).not.toContain('frase-de-acceso');
    });

    it('rejects a phrase shorter than the schema minimum', async () => {
      const gate = new GateService(platform);
      const result = await gate.establecer('abc');
      expect(result).toEqual({ ok: false, error: 'frase-corta', state: 'setup' });
      expect(platform.store.has('gate')).toBe(false);
    });

    it('rejects an empty phrase', async () => {
      const gate = new GateService(platform);
      const result = await gate.establecer('   ');
      expect(result).toEqual({ ok: false, error: 'frase-vacia', state: 'setup' });
    });

    it('refuses to run again once a credential exists', async () => {
      const gate = new GateService(platform);
      await gate.establecer('frase-de-acceso');
      const result = await gate.establecer('otra-frase');
      expect(result).toEqual({ ok: false, error: 'ya-establecida', state: 'locked' });
    });
  });

  describe('abrir', () => {
    it('opens with the correct phrase', async () => {
      await new GateService(platform).establecer('frase-de-acceso');
      const gate = new GateService(platform);
      const result = await gate.abrir('frase-de-acceso');
      expect(result).toEqual({ ok: true, state: 'open' });
    });

    it('stays locked with a wrong phrase', async () => {
      await new GateService(platform).establecer('frase-de-acceso');
      const gate = new GateService(platform);
      const result = await gate.abrir(' incorrecta ');
      expect(result).toEqual({ ok: false, error: 'frase-incorrecta', state: 'locked' });
      expect(await gate.estado()).toBe('locked');
    });

    it('rejects an empty attempt without revealing format rules', async () => {
      await new GateService(platform).establecer('frase-de-acceso');
      const gate = new GateService(platform);
      const result = await gate.abrir('');
      expect(result).toEqual({ ok: false, error: 'frase-vacia', state: 'locked' });
    });

    it('fails when no credential was ever established', async () => {
      const gate = new GateService(platform);
      const result = await gate.abrir('frase-de-acceso');
      expect(result).toEqual({ ok: false, error: 'no-establecida', state: 'setup' });
    });
  });

  describe('cambiar', () => {
    it('replaces the credential when the current phrase matches', async () => {
      await new GateService(platform).establecer('frase-vieja');
      const gate = new GateService(platform);
      const result = await gate.cambiar('frase-vieja', 'frase-nueva');
      expect(result).toEqual({ ok: true, state: 'locked' });

      const reloaded = new GateService(platform);
      expect(await reloaded.abrir('frase-nueva')).toEqual({ ok: true, state: 'open' });
    });

    it('rotates the salt even when the new phrase equals the current one', async () => {
      await new GateService(platform).establecer('frase-de-acceso');
      const before = platform.store.get('gate');
      const gate = new GateService(platform);
      await gate.cambiar('frase-de-acceso', 'frase-de-acceso');
      expect(platform.store.get('gate')).not.toBe(before);
    });

    it('keeps the old credential when the current phrase is wrong', async () => {
      await new GateService(platform).establecer('frase-de-acceso');
      const before = platform.store.get('gate');
      const gate = new GateService(platform);
      const result = await gate.cambiar('_equivocada', 'frase-nueva');
      expect(result).toEqual({ ok: false, error: 'frase-incorrecta', state: 'locked' });
      expect(platform.store.get('gate')).toBe(before);
    });

    it('rejects a too-short new phrase', async () => {
      await new GateService(platform).establecer('frase-de-acceso');
      const gate = new GateService(platform);
      const result = await gate.cambiar('frase-de-acceso', 'abc');
      expect(result).toEqual({ ok: false, error: 'frase-corta', state: 'locked' });
    });

    it('fails when no credential was ever established', async () => {
      const gate = new GateService(platform);
      const result = await gate.cambiar('frase-de-acceso', 'frase-nueva');
      expect(result).toEqual({ ok: false, error: 'no-establecida', state: 'setup' });
    });
  });

  describe('corrupt storage', () => {
    it('reports a corrupt credential instead of crashing', async () => {
      platform.store.set('gate', 'garbage-not-a-credential');
      const gate = new GateService(platform);
      const result = await gate.abrir('frase-de-acceso');
      expect(result).toEqual({ ok: false, error: 'credencial-invalida', state: 'locked' });
    });
  });
});
