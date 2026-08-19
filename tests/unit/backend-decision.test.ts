import { describe, expect, it } from 'vitest';

import { planBackends } from '../../src/local-models/backend-decision';

describe('planBackends — auto policy', () => {
  it('tries WebGPU first with a WASM fallback for wasm-compatible models', () => {
    expect(
      planBackends({ policy: 'auto', requirement: 'wasm-compatible', hasWebgpu: true }),
    ).toEqual({ ok: true, backends: ['webgpu', 'wasm'] });
  });

  it('goes straight to WASM without a WebGPU adapter (wasm-compatible)', () => {
    expect(
      planBackends({ policy: 'auto', requirement: 'wasm-compatible', hasWebgpu: false }),
    ).toEqual({ ok: true, backends: ['wasm'] });
  });

  it('WebGPU-only for webgpu-required models when the adapter exists (no crawling on WASM)', () => {
    expect(
      planBackends({ policy: 'auto', requirement: 'webgpu-required', hasWebgpu: true }),
    ).toEqual({ ok: true, backends: ['webgpu'] });
  });

  it('refuses webgpu-required models without WebGPU', () => {
    expect(
      planBackends({ policy: 'auto', requirement: 'webgpu-required', hasWebgpu: false }),
    ).toEqual({ ok: false, reason: 'webgpu-required' });
  });
});

describe('planBackends — force WASM diagnostic', () => {
  it('forces WASM for models that permit it', () => {
    expect(
      planBackends({ policy: 'wasm', requirement: 'wasm-compatible', hasWebgpu: true }),
    ).toEqual({ ok: true, backends: ['wasm'] });
    expect(
      planBackends({ policy: 'wasm', requirement: 'wasm-compatible', hasWebgpu: false }),
    ).toEqual({ ok: true, backends: ['wasm'] });
  });

  it('never unlocks WASM for webgpu-required models', () => {
    expect(
      planBackends({ policy: 'wasm', requirement: 'webgpu-required', hasWebgpu: true }),
    ).toEqual({ ok: false, reason: 'wasm-not-permitted' });
    expect(
      planBackends({ policy: 'wasm', requirement: 'webgpu-required', hasWebgpu: false }),
    ).toEqual({ ok: false, reason: 'wasm-not-permitted' });
  });
});
