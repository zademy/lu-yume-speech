import { describe, it, expect, afterEach } from 'vitest';
import { Recorder } from '../../src/audio/recorder';
import { RecordingTimer } from '../../src/audio/recording-timer';
import { MicNotSupportedError } from '../../src/types';
import { EventBus } from '../../src/core/event-bus';
import type { EventMap } from '../../src/types';

function createBus(): EventBus<EventMap> {
  return new EventBus<EventMap>();
}

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
    // After dispose, the timer should be at 0
    expect(timer.getElapsed()).toBe(0);
    // reset() emits a tick with 0
    expect(lastTick).toBe(0);
  });
});
