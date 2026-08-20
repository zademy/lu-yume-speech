import { describe, it, expect } from 'vitest';
import {
  LOCAL_MODEL_CATALOG,
  LOCAL_CATALOG_VERSION,
  LOCAL_MODEL_MAX_BYTES,
  validateCatalog,
  formatDownloadSize,
  type LocalCatalogEntry,
} from '../../src/utils/local-model-catalog';
import { translate } from '../../src/i18n/translations';
import { representativeMeasurement } from '../../src/utils/benchmark/manifest';
import type { AppLanguage } from '../../src/types';

/** Deep-mutable copy of the shipped catalog for negative-case tests. */
function copyCatalog(): LocalCatalogEntry[] {
  return LOCAL_MODEL_CATALOG.map((entry) => ({
    ...entry,
    artifacts: entry.artifacts.map((artifact) => ({ ...artifact })),
    languages: [...entry.languages],
  }));
}

/** Fixture accessor that fails loudly instead of returning undefined. */
function pick(entries: LocalCatalogEntry[], index: number): LocalCatalogEntry {
  const entry = entries[index];
  if (!entry) throw new Error(`fixture entry ${index} missing`);
  return entry;
}

describe('local model catalog', () => {
  it('ships the versioned catalog: stages 1-3 (Base, Small, Turbo, Tiny, Medium, Large v3 + four Lite)', () => {
    expect(LOCAL_CATALOG_VERSION).toBe(3);
    expect(LOCAL_MODEL_CATALOG.map((e) => e.id)).toEqual([
      'whisper-base',
      'whisper-small',
      'whisper-large-v3-turbo',
      'whisper-tiny',
      'whisper-medium',
      'whisper-large-v3',
      'whisper-large-v3-turbo-lite-fast',
      'whisper-large-v3-turbo-lite-accurate',
      'whisper-large-v3-lite-fast',
      'whisper-large-v3-lite-accurate',
    ]);
  });

  it('marks exactly the four Lite entries as experimental', () => {
    const experimental = LOCAL_MODEL_CATALOG.filter((e) => e.experimental === true).map(
      (e) => e.id,
    );
    expect(experimental).toEqual([
      'whisper-large-v3-turbo-lite-fast',
      'whisper-large-v3-turbo-lite-accurate',
      'whisper-large-v3-lite-fast',
      'whisper-large-v3-lite-accurate',
    ]);
    for (const entry of experimental) {
      const found = LOCAL_MODEL_CATALOG.find((e) => e.id === entry);
      expect(found?.license).toBe('apache-2.0');
    }
  });

  it('guides the first download: Small recommended, Base for modest hardware', () => {
    // Exactly one of each — the story-25 guidance must stay unambiguous.
    expect(LOCAL_MODEL_CATALOG.filter((e) => e.recommended === true).map((e) => e.id)).toEqual([
      'whisper-small',
    ]);
    expect(LOCAL_MODEL_CATALOG.filter((e) => e.modestHardware === true).map((e) => e.id)).toEqual([
      'whisper-base',
    ]);
  });

  it('keeps experimental measurements out of published results (benchmarks separate)', () => {
    // Stage-3 entries ship as estimates until their own measurements land.
    for (const entry of LOCAL_MODEL_CATALOG) {
      if (!entry.experimental) continue;
      expect(representativeMeasurement(entry.id)).toBeNull();
    }
  });

  it('assigns tiers and backend requirements per stage-2/3 policy', () => {
    const byId = new Map(LOCAL_MODEL_CATALOG.map((e) => [e.id, e]));
    expect(byId.get('whisper-tiny')).toMatchObject({
      memoryTier: 'light',
      backend: 'wasm-compatible',
    });
    expect(byId.get('whisper-medium')).toMatchObject({
      memoryTier: 'high',
      backend: 'wasm-compatible',
    });
    // Large v3 (full) requires WebGPU and a very-high tier, like every Lite.
    expect(byId.get('whisper-large-v3')).toMatchObject({
      memoryTier: 'very-high',
      backend: 'webgpu-required',
    });
    expect(byId.get('whisper-large-v3-turbo-lite-fast')).toMatchObject({
      memoryTier: 'high',
      backend: 'webgpu-required',
    });
    expect(byId.get('whisper-large-v3-lite-accurate')).toMatchObject({
      memoryTier: 'very-high',
      backend: 'webgpu-required',
    });
  });

  it('passes its own validation', () => {
    expect(validateCatalog(LOCAL_MODEL_CATALOG)).toEqual([]);
  });

  it('pins an immutable Hugging Face revision per entry', () => {
    for (const entry of LOCAL_MODEL_CATALOG) {
      expect(entry.repo).toMatch(/^[^/]+\/[^/]+$/);
      expect(entry.revision).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('declares Spanish and English with detection and translation support', () => {
    for (const entry of LOCAL_MODEL_CATALOG) {
      expect(entry.languages).toContain('es');
      expect(entry.languages).toContain('en');
      expect(entry.autoDetectLanguage).toBe(true);
      expect(entry.supportsTranslation).toBe(true);
    }
  });

  it('stays under the 2 GB per-download ceiling', () => {
    for (const entry of LOCAL_MODEL_CATALOG) {
      expect(entry.downloadBytes).toBeLessThanOrEqual(LOCAL_MODEL_MAX_BYTES);
    }
  });

  it('keeps WebGPU-required to the large-v3 family (Turbo, Large v3, Lite)', () => {
    const required = LOCAL_MODEL_CATALOG.filter((e) => e.backend === 'webgpu-required');
    expect(required.map((e) => e.id)).toEqual([
      'whisper-large-v3-turbo',
      'whisper-large-v3',
      'whisper-large-v3-turbo-lite-fast',
      'whisper-large-v3-turbo-lite-accurate',
      'whisper-large-v3-lite-fast',
      'whisper-large-v3-lite-accurate',
    ]);
  });

  describe('validateCatalog', () => {
    it('flags duplicate ids', () => {
      const entries = copyCatalog();
      pick(entries, 1).id = pick(entries, 0).id;
      const issues = validateCatalog(entries).map((i) => i.kind);
      expect(issues).toContain('duplicate-id');
    });

    it('flags downloadBytes not matching the artifact sum', () => {
      const entries = copyCatalog();
      pick(entries, 0).downloadBytes += 1024;
      const issues = validateCatalog(entries).map((i) => i.kind);
      expect(issues).toContain('size-mismatch');
    });

    it('flags non-positive artifact sizes', () => {
      const entries = copyCatalog();
      const artifacts = pick(entries, 0).artifacts;
      const first = artifacts[0];
      if (!first) throw new Error('fixture artifact missing');
      artifacts[0] = { path: first.path, bytes: 0 };
      expect(validateCatalog(entries).map((i) => i.kind)).toContain('bad-artifact-size');
    });

    it('flags entries over the ceiling', () => {
      const entries = copyCatalog();
      entries[0] = {
        ...pick(entries, 0),
        downloadBytes: LOCAL_MODEL_MAX_BYTES + 1,
        artifacts: [{ path: 'onnx/huge.onnx', bytes: LOCAL_MODEL_MAX_BYTES + 1 }],
      };
      expect(validateCatalog(entries).map((i) => i.kind)).toContain('over-ceiling');
    });

    it('flags licenses outside the allow-list', () => {
      const entries = copyCatalog();
      // Simulate a CC-BY-NC entry via the raw shape (cast bypasses the type).
      entries[0] = { ...pick(entries, 0), license: 'cc-by-nc-4.0' } as unknown as LocalCatalogEntry;
      expect(validateCatalog(entries).map((i) => i.kind)).toContain('license-not-allowed');
    });

    it('flags a model without Spanish', () => {
      const entries = copyCatalog();
      const base = pick(entries, 0);
      entries[0] = {
        ...base,
        languages: base.languages.filter((l) => l !== 'es'),
      };
      expect(validateCatalog(entries).map((i) => i.kind)).toContain('missing-language');
    });

    it('flags duplicate repo+revision pairs', () => {
      const entries = copyCatalog();
      const first = pick(entries, 0);
      entries[1] = { ...pick(entries, 1), repo: first.repo, revision: first.revision };
      expect(validateCatalog(entries).map((i) => i.kind)).toContain('duplicate-repo-revision');
    });

    it('flags entries without artifacts', () => {
      const entries = copyCatalog();
      entries[0] = { ...pick(entries, 0), artifacts: [] };
      expect(validateCatalog(entries).map((i) => i.kind)).toContain('empty-artifacts');
    });
  });

  describe('i18n guardian', () => {
    const langs: AppLanguage[] = ['en', 'es'];

    it('resolves every dynamic card key in both languages', () => {
      const missing: string[] = [];
      for (const entry of LOCAL_MODEL_CATALOG) {
        const keys = [
          `localModels.languages.${entry.autoDetectLanguage ? 'auto' : 'manual'}`,
          `localModels.precision.${entry.precision}`,
          `localModels.speed.${entry.speed}`,
          `localModels.memory.${entry.memoryTier}`,
          `localModels.backend.${entry.backend}`,
        ];
        for (const key of keys) {
          for (const lang of langs) {
            if (translate(lang, key) === key) missing.push(`${lang}:${key}`);
          }
        }
      }
      expect(missing).toEqual([]);
    });
  });

  describe('formatDownloadSize', () => {
    it('renders MiB with one decimal', () => {
      expect(formatDownloadSize(145_144_432)).toBe('138.4 MiB');
      expect(formatDownloadSize(302_101_039)).toBe('288.1 MiB');
    });

    it('renders GiB when a terabyte is not needed', () => {
      expect(formatDownloadSize(1_610_612_736)).toBe('1.5 GiB');
    });
  });
});
