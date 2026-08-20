/**
 * Selección de backend del Motor local — pure planning.
 *
 * Decides which inference backends to attempt, in order, for a model under
 * the configured policy ('auto' or force-WASM diagnostic). Pure so every
 * capability × requirement combination is unit-testable without a GPU.
 *
 * Spec rules:
 * - auto → try WebGPU first; fall back to WASM **only** for models that
 *   permit it (wasm-compatible). WebGPU-required models never crawl on WASM:
 *   they get a clear message instead.
 * - force-WASM is a diagnostic override for models that permit WASM; it
 *   never unlocks WASM for a webgpu-required model.
 */

import type { LocalBackend } from '../types';
import type { LocalModelBackend } from '../utils/local-model-catalog';

/** Configured policy. */
export type BackendPolicy = 'auto' | 'wasm';

/** Inputs for {@link planBackends}. */
export interface PlanBackendsInput {
  policy: BackendPolicy;
  /** Catalog requirement of the model to load. */
  requirement: LocalModelBackend;
  /** Whether the device exposed a WebGPU adapter (capability probe). */
  hasWebgpu: boolean;
}

/** Why loading is refused before any attempt is made. */
export type BackendBlockReason =
  /** WebGPU-required model on a device without WebGPU. */
  | 'webgpu-required'
  /** WASM was forced on a model that does not permit WASM. */
  | 'wasm-not-permitted';

/** Outcome of {@link planBackends}: ordered attempts or a refusal. */
export type BackendPlan =
  { ok: true; backends: LocalBackend[] } | { ok: false; reason: BackendBlockReason };

/**
 * Plan the ordered backend attempts. The worker verifies each attempt by
 * actually creating the session; falling back from WebGPU happens only
 * within this list (never mid-inference).
 */
export function planBackends(input: PlanBackendsInput): BackendPlan {
  const { policy, requirement, hasWebgpu } = input;
  const wasmPermitted = requirement === 'wasm-compatible';

  if (policy === 'wasm') {
    return wasmPermitted
      ? { ok: true, backends: ['wasm'] }
      : { ok: false, reason: 'wasm-not-permitted' };
  }

  // policy === 'auto'
  if (requirement === 'webgpu-required') {
    return hasWebgpu
      ? { ok: true, backends: ['webgpu'] }
      : { ok: false, reason: 'webgpu-required' };
  }
  return hasWebgpu ? { ok: true, backends: ['webgpu', 'wasm'] } : { ok: true, backends: ['wasm'] };
}
