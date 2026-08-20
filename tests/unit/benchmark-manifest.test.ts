import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_RESULTS,
  benchmarkLabels,
  measuredModelIds,
  representativeMeasurement,
  type BenchmarkResultsManifest,
} from '../../src/utils/benchmark/manifest';
import { LOCAL_MODEL_CATALOG } from '../../src/utils/local-model-catalog';

const manifest: BenchmarkResultsManifest = {
  resultsVersion: 1,
  measured: {
    description: 'test',
    userAgent: 'UA',
    deviceMemoryGb: 8,
    measuredAt: '2026-01-01T00:00:00.000Z',
  },
  measurements: [
    {
      modelId: 'whisper-base',
      backend: 'wasm',
      corpusVersion: 1,
      clips: 7,
      languageWer: { es: 0.1, en: 0.05 },
      globalWer: 0.07,
      loadMs: 1200,
      audioSeconds: 60,
      inferenceSeconds: 24,
      rtf: 0.4,
    },
    {
      modelId: 'whisper-base',
      backend: 'webgpu',
      corpusVersion: 1,
      clips: 7,
      languageWer: { es: 0.12, en: 0.06 },
      globalWer: 0.09,
      loadMs: 900,
      audioSeconds: 60,
      inferenceSeconds: 15,
      rtf: 0.25,
    },
  ],
};

describe('representativeMeasurement', () => {
  it('prefers the WebGPU run, mirroring the default auto policy', () => {
    const measurement = representativeMeasurement('whisper-base', manifest);
    expect(measurement?.backend).toBe('webgpu');
    expect(measurement?.rtf).toBe(0.25);
  });

  it('falls back to WASM when only WASM was measured', () => {
    const wasmOnly: BenchmarkResultsManifest = {
      ...manifest,
      measurements: [manifest.measurements[0] as (typeof manifest.measurements)[number]],
    };
    expect(representativeMeasurement('whisper-base', wasmOnly)?.backend).toBe('wasm');
  });

  it('returns null for unpublished models', () => {
    expect(representativeMeasurement('whisper-small', manifest)).toBeNull();
  });
});

describe('benchmarkLabels', () => {
  it('derives labels through the public thresholds', () => {
    // webgpu run: WER 0.09 → medium; RTF 0.25 → fast.
    const labels = benchmarkLabels('whisper-base', manifest);
    expect(labels.precision).toBe('medium');
    expect(labels.speed).toBe('fast');
    expect(labels.measured?.backend).toBe('webgpu');
  });

  it('falls back to neutral buckets when unpublished', () => {
    const labels = benchmarkLabels('whisper-small', manifest);
    expect(labels.measured).toBeNull();
    expect(['basic', 'medium', 'high']).toContain(labels.precision);
    expect(['fast', 'balanced', 'slow']).toContain(labels.speed);
  });
});

describe('shipped manifest', () => {
  it('is well-formed and versioned', () => {
    expect(BENCHMARK_RESULTS.resultsVersion).toBeGreaterThan(0);
    for (const measurement of BENCHMARK_RESULTS.measurements) {
      expect(measurement.clips).toBeGreaterThan(0);
      expect(measurement.globalWer).toBeGreaterThanOrEqual(0);
      expect(measurement.rtf).toBeGreaterThan(0);
      expect(measurement.languageWer.es ?? measurement.languageWer.en).toBeDefined();
    }
  });

  it('catalog precision/speed labels are exactly the derived ones', () => {
    // The cards can never drift from the manifest: every catalog label is
    // recomputed from the published numbers (fallback = neutral bucket).
    for (const entry of LOCAL_MODEL_CATALOG) {
      const labels = benchmarkLabels(entry.id);
      expect(entry.precision).toBe(labels.precision);
      expect(entry.speed).toBe(labels.speed);
    }
  });

  it('measured model ids are unique', () => {
    const ids = measuredModelIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});
