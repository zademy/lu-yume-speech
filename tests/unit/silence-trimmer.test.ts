import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  dbToLinear,
  encodeWav,
  findSpeechBounds,
  rms,
  trimSilence,
} from '../../src/audio/silence-trimmer';

describe('dbToLinear', () => {
  it('maps 0 dB to unity amplitude', () => {
    expect(dbToLinear(0)).toBeCloseTo(1, 5);
  });

  it('maps -40 dB to ~0.01', () => {
    expect(dbToLinear(-40)).toBeCloseTo(0.01, 3);
  });
});

describe('rms', () => {
  it('is zero for a silent frame', () => {
    const samples = new Float32Array([0, 0, 0, 0]);
    expect(rms(samples, 0, samples.length)).toBe(0);
  });

  it('equals the absolute amplitude for a constant signal', () => {
    const samples = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    expect(rms(samples, 0, samples.length)).toBeCloseTo(0.5, 5);
  });

  it('reads only the requested slice', () => {
    const samples = new Float32Array([0, 0, 1, -1]);
    expect(rms(samples, 2, 2)).toBeCloseTo(1, 5);
  });
});

describe('findSpeechBounds', () => {
  const opts = { thresholdDb: -40, paddingMs: 0, frameMs: 10 };
  const sampleRate = 16000; // 10 ms frame = 160 samples

  it('returns null for an entirely silent buffer', () => {
    const samples = new Float32Array(1600); // 1 s of silence
    expect(findSpeechBounds(samples, sampleRate, opts)).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(findSpeechBounds(new Float32Array(0), sampleRate, opts)).toBeNull();
  });

  it('trims leading silence and keeps speech', () => {
    const samples = new Float32Array(1600); // 1 s
    samples.fill(0, 0, 800); // 0.5 s silent
    samples.fill(0.5, 800, 1600); // 0.5 s loud
    const bounds = findSpeechBounds(samples, sampleRate, opts);
    expect(bounds).not.toBeNull();
    expect(bounds!.start).toBeLessThanOrEqual(800);
    expect(bounds!.end).toBe(1600);
  });

  it('trims trailing silence and keeps speech', () => {
    const samples = new Float32Array(1600);
    samples.fill(0.5, 0, 800);
    samples.fill(0, 800, 1600);
    const bounds = findSpeechBounds(samples, sampleRate, opts);
    expect(bounds).not.toBeNull();
    expect(bounds!.start).toBe(0);
    expect(bounds!.end).toBeGreaterThanOrEqual(800);
  });

  it('applies padding around the detected speech without overflowing', () => {
    const samples = new Float32Array(1600);
    samples.fill(0.5, 780, 820); // tiny burst in the middle
    const bounds = findSpeechBounds(samples, sampleRate, {
      thresholdDb: -40,
      paddingMs: 100, // 1600 samples of padding → clamps to buffer edges
      frameMs: 10,
    });
    expect(bounds).not.toBeNull();
    expect(bounds!.start).toBe(0);
    expect(bounds!.end).toBe(1600);
  });
});

describe('encodeWav', () => {
  it('writes the canonical 44-byte WAV header', () => {
    const samples = new Float32Array([0, 0.5, -0.5]);
    const buf = encodeWav(samples, 16000);
    const view = new DataView(buf);
    expect(buf.byteLength).toBe(44 + samples.length * 2);
    expect(readString(view, 0, 4)).toBe('RIFF');
    expect(readString(view, 8, 4)).toBe('WAVE');
    expect(readString(view, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(readString(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('encodes amplitudes as signed 16-bit little-endian PCM', () => {
    const samples = new Float32Array([1, -1, 0]);
    const view = new DataView(encodeWav(samples, 8000));
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
    expect(view.getInt16(48, true)).toBe(0);
  });
});

function readString(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe('trimSilence (async wrapper, fail-open)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the original blob when AudioContext is unavailable', async () => {
    const ctx = globalThis.AudioContext;
    // @ts-expect-error — simulate an environment without AudioContext
    delete globalThis.AudioContext;
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm' });
    try {
      const out = await trimSilence(blob, { thresholdDb: -40, paddingMs: 0 });
      expect(out).toBe(blob); // identical reference — passed through untouched
    } finally {
      globalThis.AudioContext = ctx;
    }
  });

  it('returns the original blob when decoding throws', async () => {
    const fakeCtx = function () {
      return {
        decodeAudioData: () => Promise.reject(new Error('unsupported codec')),
        close: () => Promise.resolve(),
      };
    };
    vi.stubGlobal('AudioContext', fakeCtx);
    const blob = new Blob([new Uint8Array([0])], { type: 'audio/webm' });
    const out = await trimSilence(blob, { thresholdDb: -40, paddingMs: 0 });
    expect(out).toBe(blob);
  });
});
