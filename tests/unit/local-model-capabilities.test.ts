import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  detectCapabilities,
  backendRequirementMet,
  probeEnvironment,
  type DeviceCapabilitiesProbe,
} from '../../src/utils/local-model-capabilities';

function probe(overrides: Partial<DeviceCapabilitiesProbe> = {}): DeviceCapabilitiesProbe {
  return {
    isSecureContext: true,
    workerAvailable: true,
    webgpuAdapter: 'available',
    storageEstimate: { usage: 100, quota: 1000 },
    ...overrides,
  };
}

describe('detectCapabilities', () => {
  it('reports webgpu when the adapter resolves', () => {
    const caps = detectCapabilities(probe());
    expect(caps.secureContext).toBe(true);
    expect(caps.worker).toBe(true);
    expect(caps.webgpu).toBe(true);
    expect(caps.localInferenceSupported).toBe(true);
    expect(caps.backendKey).toBe('webgpu');
  });

  it('falls back to wasm summary when webgpu is unavailable', () => {
    const caps = detectCapabilities(probe({ webgpuAdapter: 'unavailable' }));
    expect(caps.webgpu).toBe(false);
    expect(caps.localInferenceSupported).toBe(true);
    expect(caps.backendKey).toBe('wasm');
  });

  it('treats a missing navigator.gpu as no webgpu (wasm still fine)', () => {
    const caps = detectCapabilities(probe({ webgpuAdapter: 'no-api' }));
    expect(caps.webgpu).toBe(false);
    expect(caps.backendKey).toBe('wasm');
  });

  it('blocks local inference on insecure contexts', () => {
    const caps = detectCapabilities(probe({ isSecureContext: false }));
    expect(caps.localInferenceSupported).toBe(false);
    expect(caps.backendKey).toBe('unsupported');
  });

  it('blocks local inference without Web Worker support', () => {
    const caps = detectCapabilities(probe({ workerAvailable: false }));
    expect(caps.localInferenceSupported).toBe(false);
  });

  it('carries the storage estimate through when present', () => {
    const caps = detectCapabilities(probe({ storageEstimate: { usage: 5, quota: 500 } }));
    expect(caps.storageUsageBytes).toBe(5);
    expect(caps.storageQuotaBytes).toBe(500);
  });

  it('tolerates a null storage estimate', () => {
    const caps = detectCapabilities(probe({ storageEstimate: null }));
    expect(caps.storageUsageBytes).toBeNull();
    expect(caps.storageQuotaBytes).toBeNull();
  });
});

describe('backendRequirementMet', () => {
  it('wasm-compatible models run with or without webgpu', () => {
    expect(backendRequirementMet('wasm-compatible', { webgpu: true })).toBe(true);
    expect(backendRequirementMet('wasm-compatible', { webgpu: false })).toBe(true);
  });

  it('webgpu-required models run only with webgpu', () => {
    expect(backendRequirementMet('webgpu-required', { webgpu: true })).toBe(true);
    expect(backendRequirementMet('webgpu-required', { webgpu: false })).toBe(false);
  });
});

describe('probeEnvironment (real browser APIs)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports available when requestAdapter resolves with an adapter', async () => {
    vi.stubGlobal('navigator', {
      gpu: { requestAdapter: vi.fn().mockResolvedValue({}) },
      storage: { estimate: vi.fn().mockResolvedValue({ usage: 1, quota: 2 }) },
    });
    const probe = await probeEnvironment();
    expect(probe.webgpuAdapter).toBe('available');
    expect(probe.storageEstimate).toEqual({ usage: 1, quota: 2 });
  });

  it('reports unavailable when requestAdapter resolves null or rejects', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockResolvedValue(null) } });
    expect((await probeEnvironment()).webgpuAdapter).toBe('unavailable');

    vi.stubGlobal('navigator', { gpu: { requestAdapter: vi.fn().mockRejectedValue(new Error()) } });
    expect((await probeEnvironment()).webgpuAdapter).toBe('unavailable');
  });

  it('reports no-api without navigator.gpu and null estimate without storage', async () => {
    vi.stubGlobal('navigator', {});
    const probe = await probeEnvironment();
    expect(probe.webgpuAdapter).toBe('no-api');
    expect(probe.storageEstimate).toBeNull();
  });

  it('tolerates a throwing storage estimate', async () => {
    vi.stubGlobal('navigator', {
      storage: { estimate: vi.fn().mockRejectedValue(new Error('quota')) },
    });
    const probe = await probeEnvironment();
    expect(probe.storageEstimate).toBeNull();
  });
});
