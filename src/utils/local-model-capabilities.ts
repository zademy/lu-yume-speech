/**
 * Detección de capacidades del dispositivo para el Motor local.
 *
 * Pure decision logic over an injected environment probe plus a thin async
 * probe helper that reads real browser APIs. Keeping the decisions pure lets
 * unit tests cover every capability combination without a GPU; only the
 * probe touches `window`/`navigator`.
 */

import type { LocalModelBackend } from './local-model-catalog';

/** Raw environment facts gathered from browser APIs. */
export interface DeviceCapabilitiesProbe {
  /** Secure context (HTTPS or localhost) — required for WebGPU and workers. */
  isSecureContext: boolean;
  /** `Worker` constructor exists. */
  workerAvailable: boolean;
  /** WebGPU adapter probe result. */
  webgpuAdapter: 'available' | 'unavailable' | 'no-api';
  /** Storage estimate when the browser reports one, else null. */
  storageEstimate: { usage: number; quota: number } | null;
}

/** Derived capability summary shown in Ajustes › Modelos locales. */
export interface DeviceCapabilities {
  secureContext: boolean;
  worker: boolean;
  webgpu: boolean;
  /** Local inference possible at all (secure context + worker). */
  localInferenceSupported: boolean;
  /** Best backend the device can use: 'webgpu' | 'wasm' | 'unsupported'. */
  backendKey: 'webgpu' | 'wasm' | 'unsupported';
  storageUsageBytes: number | null;
  storageQuotaBytes: number | null;
}

/**
 * Derive the capability summary from a probe. Pure.
 *
 * WASM single-threaded inference needs no capability beyond the baseline, so
 * `localInferenceSupported` gates only on secure context + worker; WebGPU is
 * reported separately as the best available backend.
 */
export function detectCapabilities(probe: DeviceCapabilitiesProbe): DeviceCapabilities {
  const webgpu = probe.webgpuAdapter === 'available';
  const localInferenceSupported = probe.isSecureContext && probe.workerAvailable;
  return {
    secureContext: probe.isSecureContext,
    worker: probe.workerAvailable,
    webgpu,
    localInferenceSupported,
    backendKey: !localInferenceSupported ? 'unsupported' : webgpu ? 'webgpu' : 'wasm',
    storageUsageBytes: probe.storageEstimate?.usage ?? null,
    storageQuotaBytes: probe.storageEstimate?.quota ?? null,
  };
}

/** Whether a model's backend requirement is satisfiable by the device. */
export function backendRequirementMet(
  requirement: LocalModelBackend,
  caps: Pick<DeviceCapabilities, 'webgpu'>,
): boolean {
  return requirement === 'wasm-compatible' ? true : caps.webgpu;
}

/**
 * Probe the real environment. Thin: reads `window`/`navigator` and resolves.
 * WebGPU availability is decided by `requestAdapter()` actually resolving —
 * `navigator.gpu` existing is necessary but not sufficient.
 */
export async function probeEnvironment(): Promise<DeviceCapabilitiesProbe> {
  const isSecureContext: boolean = typeof window !== 'undefined' ? window.isSecureContext : false;
  const workerAvailable = typeof Worker !== 'undefined';

  let webgpuAdapter: DeviceCapabilitiesProbe['webgpuAdapter'] = 'no-api';
  const gpu = (navigator as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
  if (typeof gpu?.requestAdapter === 'function') {
    try {
      const adapter = await gpu.requestAdapter();
      webgpuAdapter = adapter ? 'available' : 'unavailable';
    } catch {
      webgpuAdapter = 'unavailable';
    }
  }

  let storageEstimate: DeviceCapabilitiesProbe['storageEstimate'] = null;
  // Optional-chained through a widened type: jsdom and older browsers may
  // lack navigator.storage even though the DOM lib types say otherwise.
  const storage = (navigator as { storage?: { estimate?: () => Promise<StorageEstimate> } })
    .storage;
  if (typeof storage?.estimate === 'function') {
    try {
      const estimate = await storage.estimate();
      if (typeof estimate.usage === 'number' && typeof estimate.quota === 'number') {
        storageEstimate = { usage: estimate.usage, quota: estimate.quota };
      }
    } catch {
      // Estimate is best-effort — null keeps the UI warning-only.
    }
  }

  return { isSecureContext, workerAvailable, webgpuAdapter, storageEstimate };
}
