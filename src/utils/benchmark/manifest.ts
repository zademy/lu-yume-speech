/**
 * Published benchmark results — manifest schema + label derivation (T8).
 *
 * Single responsibility: type the versioned results manifest
 * (src/utils/benchmark/results.json), pick the representative measurement
 * per model, and derive the catalog precision/speed labels through the
 * public thresholds. Labels are RECALCULABLE: rerun the corpus, paste the
 * exported run into results.json, and every card follows.
 *
 * Backend selection rule (documented): the representative measurement is
 * the WebGPU run when one was measured, otherwise WASM — mirroring the
 * 'auto' backend policy users get by default.
 */

import type { LocalBackend } from '../../types';
import type { LocalModelPrecision, LocalModelSpeed } from '../local-model-catalog';
import { derivePrecision, deriveSpeed } from './thresholds';
import resultsJson from './results.json';

/** One model × backend measurement over the whole corpus. */
export interface BenchmarkMeasurement {
  modelId: string;
  backend: LocalBackend;
  corpusVersion: number;
  clips: number;
  /** Mean WER per language across that language's clips. */
  languageWer: { es?: number; en?: number };
  /** Mean WER across every clip (the label input). */
  globalWer: number;
  /** Cold model load in milliseconds (weights fetch excluded once cached). */
  loadMs: number;
  /** Total seconds of corpus audio measured. */
  audioSeconds: number;
  /** Total seconds of inference over that audio. */
  inferenceSeconds: number;
  /** inferenceSeconds / audioSeconds — lower is faster. */
  rtf: number;
  /** Peak JS heap in bytes when observable, else omitted. */
  peakMemoryBytes?: number;
}

/** The published, versioned results manifest committed to the repo. */
export interface BenchmarkResultsManifest {
  resultsVersion: number;
  /** How the numbers were produced (device + method), for disclosure. */
  measured: {
    description: string;
    userAgent: string;
    deviceMemoryGb: number | null;
    measuredAt: string;
  };
  measurements: BenchmarkMeasurement[];
}

/**
 * JSON imports arrive structurally widened (`backend: string`), so the
 * manifest is asserted into its schema here. The shape is guarded at
 * runtime by tests/unit/benchmark-manifest.test.ts (well-formedness,
 * allowed backends, unique model ids) — a bad results.json fails the
 * suite before it can ship a wrong label.
 */
export const BENCHMARK_RESULTS = resultsJson as unknown as BenchmarkResultsManifest;

/**
 * The representative measurement for a model: WebGPU when published,
 * else WASM (mirrors the default 'auto' policy). Null when the model has
 * no published run yet.
 */
export function representativeMeasurement(
  modelId: string,
  manifest: BenchmarkResultsManifest = BENCHMARK_RESULTS,
): BenchmarkMeasurement | null {
  const forModel = manifest.measurements.filter((m) => m.modelId === modelId);
  if (forModel.length === 0) return null;
  return forModel.find((m) => m.backend === 'webgpu') ?? forModel[0] ?? null;
}

/** Derived catalog labels for a model (fallback buckets when unpublished). */
export function benchmarkLabels(
  modelId: string,
  manifest: BenchmarkResultsManifest = BENCHMARK_RESULTS,
): {
  precision: LocalModelPrecision;
  speed: LocalModelSpeed;
  measured: BenchmarkMeasurement | null;
} {
  const measurement = representativeMeasurement(modelId, manifest);
  if (!measurement) return { precision: 'medium', speed: 'balanced', measured: null };
  return {
    precision: derivePrecision(measurement.globalWer),
    speed: deriveSpeed(measurement.rtf),
    measured: measurement,
  };
}

/** Every model with a published measurement (used by manifest tests). */
export function measuredModelIds(manifest: BenchmarkResultsManifest = BENCHMARK_RESULTS): string[] {
  return [...new Set(manifest.measurements.map((m) => m.modelId))];
}
