import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { Recorder } from '../../src/audio/recorder';
import { RecordingTimer } from '../../src/audio/recording-timer';
import { MicNotSupportedError } from '../../src/types';
import { EventBus } from '../../src/core/event-bus';
import type { EventMap } from '../../src/types';

function createBus(): EventBus<EventMap> {
  return new EventBus<EventMap>();
}

// ------------------------------------------------------------------
// Mock helpers for MediaRecorder + getUserMedia
// ------------------------------------------------------------------

class FakeMediaStream {
  private tracks: MediaStreamTrack[];
  constructor() {
    this.tracks = [
      { stop: vi.fn(), kind: 'audio', readyState: 'live' } as unknown as MediaStreamTrack,
    ];
  }
  getTracks(): MediaStreamTrack[] {
    return this.tracks;
  }
}

class FakeMediaRecorder {
  state: RecordingState = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  stream: MediaStream;
  mimeType: string;

  constructor(stream: MediaStream, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? 'audio/webm';
    (globalThis as Record<string, unknown>).__lastRecorder = this;
  }
  start(): void {
    this.state = 'recording';
  }
  stop(): void {
    this.state = 'inactive';
    // Fire ondataavailable then onstop
    this.ondataavailable?.({ data: new Blob(['chunk'], { type: this.mimeType }) });
    this.onstop?.();
  }
  static isTypeSupported(mime: string): boolean {
    return mime === 'audio/webm;codecs=opus' || mime === 'audio/webm';
  }
}

// ------------------------------------------------------------------
// Recorder.init guard
// ------------------------------------------------------------------

describe('Recorder.init guard', () => {
  const original = navigator.mediaDevices;

  afterEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: original,
      configurable: true,
      writable: true,
    });
  });

  it('throws MicNotSupportedError when mediaDevices is undefined', async () => {
    // @ts-expect-error deliberate deletion for the test
    delete navigator.mediaDevices;
    const recorder = new Recorder(createBus());
    await expect(recorder.init()).rejects.toBeInstanceOf(MicNotSupportedError);
  });

  it('throws MicNotSupportedError when getUserMedia is not a function', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: 'not-a-function' },
      configurable: true,
      writable: true,
    });
    const recorder = new Recorder(createBus());
    await expect(recorder.init()).rejects.toBeInstanceOf(MicNotSupportedError);
  });
});

// ------------------------------------------------------------------
// Recorder lifecycle (with mocked MediaRecorder)
// ------------------------------------------------------------------

describe('Recorder lifecycle', () => {
  let originalMediaRecorder: typeof MediaRecorder;
  let originalMediaDevices: MediaDevices;

  beforeEach(() => {
    originalMediaRecorder = globalThis.MediaRecorder;
    originalMediaDevices = navigator.mediaDevices;

    globalThis.MediaRecorder = FakeMediaRecorder as unknown as typeof MediaRecorder;

    const fakeStream = new FakeMediaStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockResolvedValue(fakeStream),
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    globalThis.MediaRecorder = originalMediaRecorder;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
      writable: true,
    });
  });

  it('init acquires stream and creates MediaRecorder', async () => {
    const recorder = new Recorder(createBus());
    const stream = await recorder.init();
    expect(stream).toBeDefined();
    expect(recorder.state).toBe('inactive');
  });

  it('start emits recording:start and sets state to recording', async () => {
    const bus = createBus();
    let started = false;
    bus.on('recording:start', () => {
      started = true;
    });
    const recorder = new Recorder(bus);
    await recorder.init();
    recorder.start();
    expect(started).toBe(true);
    expect(recorder.state).toBe('recording');
  });

  it('start is a no-op when already recording', async () => {
    const bus = createBus();
    const recorder = new Recorder(bus);
    await recorder.init();
    recorder.start();
    // Second start should not throw or emit
    expect(() => recorder.start()).not.toThrow();
  });

  it('start is a no-op when not initialized', () => {
    const bus = createBus();
    let started = false;
    bus.on('recording:start', () => {
      started = true;
    });
    const recorder = new Recorder(bus);
    recorder.start();
    expect(started).toBe(false);
  });

  it('stop triggers onstop → emits audio:blob-ready and recording:stop', async () => {
    const bus = createBus();
    let blobReady = false;
    let stopped = false;
    bus.on('audio:blob-ready', () => {
      blobReady = true;
    });
    bus.on('recording:stop', () => {
      stopped = true;
    });
    const recorder = new Recorder(bus);
    await recorder.init();
    recorder.start();
    recorder.stop();
    expect(blobReady).toBe(true);
    expect(stopped).toBe(true);
    expect(recorder.state).toBe('inactive');
  });

  it('stop is a no-op when not recording', async () => {
    const bus = createBus();
    let stopped = false;
    bus.on('recording:stop', () => {
      stopped = true;
    });
    const recorder = new Recorder(bus);
    await recorder.init();
    recorder.stop();
    expect(stopped).toBe(false);
  });

  it('state returns inactive when not initialized', () => {
    const recorder = new Recorder(createBus());
    expect(recorder.state).toBe('inactive');
  });

  it('dispose stops recording and releases tracks', async () => {
    const fakeStream = new FakeMediaStream();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockResolvedValue(fakeStream) },
      configurable: true,
      writable: true,
    });

    const recorder = new Recorder(createBus());
    await recorder.init();
    recorder.start();

    const trackStopSpy = fakeStream.getTracks()[0]!.stop as ReturnType<typeof vi.fn>;
    recorder.dispose();
    expect(trackStopSpy).toHaveBeenCalled();
    expect(recorder.state).toBe('inactive');
  });
});

// ------------------------------------------------------------------
// RecordingTimer
// ------------------------------------------------------------------

describe('RecordingTimer.dispose', () => {
  it('stops the interval and resets elapsed', () => {
    const bus = createBus();
    const timer = new RecordingTimer(bus);
    timer.start();
    timer.dispose();
    expect(timer.getElapsed()).toBe(0);
  });

  it('is safe to call multiple times', () => {
    const bus = createBus();
    const timer = new RecordingTimer(bus);
    expect(() => {
      timer.dispose();
      timer.dispose();
    }).not.toThrow();
  });

  it('stops an active timer and emits final tick', () => {
    const bus = createBus();
    let lastTick = -1;
    bus.on('recording:timer', (s: number) => {
      lastTick = s;
    });
    const timer = new RecordingTimer(bus);
    timer.start();
    timer.dispose();
    expect(timer.getElapsed()).toBe(0);
    expect(lastTick).toBe(0);
  });
});

describe('RecordingTimer interval', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits periodic ticks while running', () => {
    const bus = createBus();
    const ticks: number[] = [];
    bus.on('recording:timer', (s: number) => {
      ticks.push(s);
    });
    const timer = new RecordingTimer(bus);
    timer.start();

    vi.advanceTimersByTime(250);

    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks[0]!).toBeGreaterThanOrEqual(0);
  });

  it('getElapsed returns live elapsed while running', () => {
    const bus = createBus();
    const timer = new RecordingTimer(bus);
    timer.start();

    vi.advanceTimersByTime(500);
    expect(timer.getElapsed()).toBeGreaterThanOrEqual(0.4);
  });
});
