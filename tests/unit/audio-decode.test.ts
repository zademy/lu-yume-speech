import { describe, expect, it } from 'vitest';

import { WHISPER_SAMPLE_RATE, decodeAudioTo16kMono } from '../../src/local-models/audio-decode';

/** Minimal AudioBuffer double with deterministic samples. */
class FakeAudioBuffer {
  private readonly data: Float32Array;
  readonly sampleRate: number;
  constructor(sampleRate: number, length: number, fill: (index: number) => number) {
    this.sampleRate = sampleRate;
    this.data = new Float32Array(length);
    for (let i = 0; i < length; i += 1) this.data[i] = fill(i);
  }
  get duration(): number {
    return this.data.length / this.sampleRate;
  }
  getChannelData(): Float32Array {
    return this.data;
  }
}

/**
 * Fake OfflineAudioContext: decodeAudioData returns a scripted "native"
 * buffer; startRendering renders a mono buffer at the context's own rate
 * (plumbing-level fidelity is enough — the real resampler lives in the
 * browser and is exercised by the T10 launch smoke).
 */
class FakeOfflineAudioContext {
  static decodeResult: FakeAudioBuffer | null = null;
  static renderContexts: FakeOfflineAudioContext[] = [];

  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    FakeOfflineAudioContext.renderContexts.push(this);
  }
  async decodeAudioData(): Promise<FakeAudioBuffer> {
    const result = FakeOfflineAudioContext.decodeResult;
    if (!result) throw new DOMException('no data', 'EncodingError');
    return result;
  }
  createBufferSource(): {
    buffer: FakeAudioBuffer | null;
    connect: (destination: unknown) => void;
    start: () => void;
  } {
    return { buffer: null, connect: () => undefined, start: () => undefined };
  }
  async startRendering(): Promise<FakeAudioBuffer> {
    return new FakeAudioBuffer(this.sampleRate, this.length, () => 0.25);
  }
}

/** Blob double whose arrayBuffer resolves immediately. */
class FakeBlob {
  private readonly bytes: ArrayBuffer;
  constructor(bytes = new ArrayBuffer(8)) {
    this.bytes = bytes;
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    return this.bytes;
  }
}

async function withFakeContext<T>(run: () => Promise<T>): Promise<T> {
  const original = (globalThis as Record<string, unknown>).OfflineAudioContext;
  (globalThis as Record<string, unknown>).OfflineAudioContext = FakeOfflineAudioContext;
  FakeOfflineAudioContext.decodeResult = null;
  FakeOfflineAudioContext.renderContexts = [];
  try {
    return await run();
  } finally {
    (globalThis as Record<string, unknown>).OfflineAudioContext = original;
  }
}

describe('decodeAudioTo16kMono', () => {
  it('renders the decoded buffer through a mono 16 kHz context and returns PCM + duration', async () => {
    await withFakeContext(async () => {
      // 1 s of 44.1 kHz "decoded" audio.
      FakeOfflineAudioContext.decodeResult = new FakeAudioBuffer(44_100, 44_100, () => 0.25);

      const { audio, duration } = await decodeAudioTo16kMono(new FakeBlob() as unknown as Blob);

      expect(audio).toBeInstanceOf(Float32Array);
      expect(audio.length).toBe(WHISPER_SAMPLE_RATE); // 1 s @ 16 kHz
      expect(duration).toBeCloseTo(1, 5);

      // The render context asked for exactly one channel at 16 kHz.
      const render = FakeOfflineAudioContext.renderContexts.at(-1);
      expect(render?.numberOfChannels).toBe(1);
      expect(render?.sampleRate).toBe(WHISPER_SAMPLE_RATE);
      expect(render?.length).toBe(WHISPER_SAMPLE_RATE);
    });
  });

  it('propagates decode failures so the provider can map them to a typed error', async () => {
    await withFakeContext(async () => {
      await expect(decodeAudioTo16kMono(new FakeBlob() as unknown as Blob)).rejects.toMatchObject({
        name: 'EncodingError',
      });
    });
  });

  it('keeps at least one frame for audio shorter than one output sample', async () => {
    await withFakeContext(async () => {
      FakeOfflineAudioContext.decodeResult = new FakeAudioBuffer(44_100, 1, () => 0);
      const { audio } = await decodeAudioTo16kMono(new FakeBlob() as unknown as Blob);
      expect(audio.length).toBeGreaterThanOrEqual(1);
    });
  });
});
