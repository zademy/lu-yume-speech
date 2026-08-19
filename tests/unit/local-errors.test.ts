import { describe, expect, it } from 'vitest';

import {
  buildTechnicalReport,
  classifyLocalFailure,
  fromTranscriptionError,
  type LocalFailureInput,
} from '../../src/local-models/local-errors';
import { TranscriptionApiError } from '../../src/types';

const ALL_CATEGORIES = [
  'browser-not-supported',
  'webgpu-unavailable',
  'insufficient-memory',
  'insufficient-space',
  'download-interrupted',
  'integrity-invalid',
  'model-incompatible',
  'inference-failed',
  'busy-other-tab',
] as const;

function classify(input: LocalFailureInput) {
  return classifyLocalFailure(input);
}

describe('classifyLocalFailure — the nine categories', () => {
  it('browser-not-supported: worker-less browser', () => {
    const out = classify({ code: 'browser-not-supported', kind: 'network', message: 'x' });
    expect(out.category).toBe('browser-not-supported');
    expect(out.actions).toContain('update-browser');
  });

  it('webgpu-unavailable: plan refusal and worker WebGPU losses', () => {
    expect(classify({ code: 'webgpu-required', kind: 'incompatible' }).category).toBe(
      'webgpu-unavailable',
    );
    expect(classify({ message: 'WebGPU device lost during inference' }).category).toBe(
      'webgpu-unavailable',
    );
  });

  it('insufficient-memory: pre-load block and inference OOM', () => {
    expect(classify({ code: 'memory-blocked', kind: 'incompatible' }).category).toBe(
      'insufficient-memory',
    );
    expect(classify({ code: 'memory-inference', kind: 'network' }).category).toBe(
      'insufficient-memory',
    );
    // Worker-origin string without a code still classifies by stable signal.
    expect(classify({ message: 'Error: out of memory when allocating tensor' }).category).toBe(
      'insufficient-memory',
    );
  });

  it('insufficient-space: download-side warning', () => {
    const out = classify({ warningKind: 'space-insufficient', downloadReason: 'download-failed' });
    expect(out.category).toBe('insufficient-space');
    expect(out.actions).toContain('free-space');
  });

  it('download-interrupted: cancellation and fetch failures', () => {
    expect(classify({ downloadReason: 'cancelled' }).category).toBe('download-interrupted');
    expect(
      classify({ downloadReason: 'download-failed', downloadPhase: 'fetching' }).category,
    ).toBe('download-interrupted');
  });

  it('integrity-invalid: verify-phase failures, missing weights and size drift', () => {
    expect(
      classify({ downloadReason: 'download-failed', downloadPhase: 'verifying' }).category,
    ).toBe('integrity-invalid');
    expect(classify({ code: 'weights-missing' }).category).toBe('integrity-invalid');
    expect(classify({ message: 'Los pesos no están en el caché' }).category).toBe(
      'integrity-invalid',
    );
  });

  it('model-incompatible: every request/model mismatch code', () => {
    for (const code of [
      'no-active-model',
      'model-not-in-catalog',
      'model-not-downloaded',
      'wasm-not-supported',
      'request-incompatible',
    ] as const) {
      expect(classify({ code, kind: 'incompatible' }).category).toBe('model-incompatible');
    }
  });

  it('inference-failed: decode, load and generic inference losses', () => {
    for (const code of ['audio-decode', 'load-failed', 'inference-failed'] as const) {
      expect(classify({ code }).category).toBe('inference-failed');
    }
    expect(classify({ message: 'unexpected ORT error' }).category).toBe('inference-failed');
    // The headline action for an inference failure is a manual retry.
    expect(classify({ code: 'inference-failed' }).actions[0]).toBe('retry');
  });

  it('busy-other-tab: cross-tab lock refusal', () => {
    const out = classify({ downloadReason: 'busy-other-tab' });
    expect(out.category).toBe('busy-other-tab');
    expect(out.actions).toEqual(['wait-other-tab']);
  });

  it('every category carries at least one concrete action', () => {
    for (const category of ALL_CATEGORIES) {
      const probe: Record<(typeof ALL_CATEGORIES)[number], LocalFailureInput> = {
        'browser-not-supported': { code: 'browser-not-supported' },
        'webgpu-unavailable': { code: 'webgpu-required' },
        'insufficient-memory': { code: 'memory-blocked' },
        'insufficient-space': { warningKind: 'space-insufficient' },
        'download-interrupted': { downloadReason: 'cancelled' },
        'integrity-invalid': { code: 'weights-missing' },
        'model-incompatible': { code: 'no-active-model' },
        'inference-failed': { code: 'inference-failed' },
        'busy-other-tab': { downloadReason: 'busy-other-tab' },
      };
      const out = classify(probe[category]);
      expect(out.category).toBe(category);
      expect(out.actions.length).toBeGreaterThan(0);
    }
  });
});

describe('fromTranscriptionError', () => {
  it('extracts the structured detail from TranscriptionApiError', () => {
    const detail = {
      kind: 'incompatible' as const,
      code: 'webgpu-required' as const,
      message: 'm',
    };
    const error = new TranscriptionApiError(detail);
    expect(fromTranscriptionError(error)).toMatchObject({
      kind: 'incompatible',
      code: 'webgpu-required',
      message: 'm',
    });
  });

  it('degrades plain errors to their message', () => {
    expect(fromTranscriptionError(new Error('boom'))).toEqual({ message: 'boom' });
  });
});

describe('buildTechnicalReport', () => {
  it('includes category, environment and cause chain — no audio, no text', () => {
    const root = new Error('root cause');
    const mid = new Error('middle', { cause: root });
    const report = buildTechnicalReport(
      { code: 'inference-failed', message: 'inference exploded', cause: mid },
      {
        at: '2026-08-19T00:00:00.000Z',
        method: 'local',
        modelId: 'whisper-base',
        userAgent: 'TestUA',
        deviceMemoryGb: 8,
      },
    );
    expect(report).toContain('inference-failed');
    expect(report).toContain('whisper-base');
    expect(report).toContain('TestUA');
    expect(report).toContain('middle <- root cause');
    expect(report).not.toContain('blob');
  });
});
