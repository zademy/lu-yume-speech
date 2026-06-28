/**
 * Real-time audio analyzer using the Web Audio API.
 *
 * Connects to a MediaStream (microphone) and provides:
 * - RMS volume level (0–1) for visual feedback
 * - Waveform time-domain data for canvas visualization
 * - Silence detection threshold for auto-stop
 *
 * This module is a pure data producer. It reads audio data from the
 * AnalyserNode and emits it through the event bus. It does NOT know
 * about the canvas, the UI, or the recorder lifecycle.
 *
 * SRP: This module's only job is extracting audio analysis data.
 * DIP: Depends on EventBus (abstraction) to deliver data to consumers.
 * OCP: New analysis features (FFT frequency data, etc.) can be added
 *      without changing any consumer.
 *
 * Lifecycle:
 * ```ts
 * const analyzer = new AudioAnalyzer(bus);
 * await analyzer.connect(stream);
 * analyzer.start();   // begins emitting 'recording:level'
 * analyzer.stop();    // pauses emission (keeps AudioContext alive)
 * analyzer.dispose(); // releases all Web Audio resources
 * ```
 */

import type { EventBus } from '../core/event-bus';
import type { AnalyserByteData, EventMap } from '../types';

/** Analysis configuration with sensible defaults for speech. */
export interface AnalyzerConfig {
  /** FFT size. Higher = more frequency resolution, lower time resolution. Power of 2. */
  fftSize: number;
  /** How often (ms) to sample and emit audio levels. Lower = smoother but more CPU. */
  sampleInterval: number;
  /** RMS level below which audio is considered "silence". 0–1. */
  silenceThreshold: number;
  /** Consecutive silence samples before emitting 'recording:silence'. */
  silenceDurationSamples: number;
}

/** Default config tuned for human speech recognition. */
export const DEFAULT_ANALYZER_CONFIG: Readonly<AnalyzerConfig> = {
  fftSize: 2048,
  sampleInterval: 50,
  silenceThreshold: 0.01,
  silenceDurationSamples: 60, // 60 × 50ms = 3 seconds of silence
};

export class AudioAnalyzer {
  private readonly bus: EventBus<EventMap>;
  private readonly config: AnalyzerConfig;

  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private timeDomainData: AnalyserByteData | null = null;
  private animationFrame: number | null = null;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveSilenceCount = 0;

  constructor(bus: EventBus<EventMap>, config: AnalyzerConfig = DEFAULT_ANALYZER_CONFIG) {
    this.bus = bus;
    this.config = config;
  }

  /**
   * Connect to a MediaStream and set up the analysis pipeline.
   * Must be called before `start()`.
   *
   * The AudioContext is created here (not in the constructor) because
   * browsers require a user gesture before audio playback/context creation.
   */
  connect(stream: MediaStream): void {
    this.audioContext = new AudioContext();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = this.config.fftSize;
    this.analyserNode.smoothingTimeConstant = 0.8;

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.sourceNode.connect(this.analyserNode);

    this.timeDomainData = new Uint8Array(this.analyserNode.frequencyBinCount);
  }

  /**
   * Start emitting audio level data through the event bus.
   * Uses setInterval for consistent timing independent of frame rate.
   */
  start(): void {
    if (!this.analyserNode || !this.timeDomainData) return;

    this.consecutiveSilenceCount = 0;

    this.sampleTimer = setInterval(() => {
      if (!this.analyserNode || !this.timeDomainData) return;
      this.analyserNode.getByteTimeDomainData(this.timeDomainData);
      const rms = this.computeRMS(this.timeDomainData);

      this.bus.emit('recording:level', rms);

      if (rms < this.config.silenceThreshold) {
        this.consecutiveSilenceCount++;
        if (this.consecutiveSilenceCount >= this.config.silenceDurationSamples) {
          this.consecutiveSilenceCount = 0;
          this.bus.emit('recording:silence', undefined);
        }
      } else {
        this.consecutiveSilenceCount = 0;
      }
    }, this.config.sampleInterval);
  }

  /**
   * Stop emitting audio data. Keeps AudioContext alive for quick restart.
   */
  stop(): void {
    if (this.sampleTimer !== null) {
      clearInterval(this.sampleTimer);
      this.sampleTimer = null;
    }
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Get the current waveform data snapshot.
   * Returns a copy so consumers can't mutate the internal buffer.
   * Returns null when not connected.
   */
  getWaveformData(): Uint8Array | null {
    if (!this.analyserNode || !this.timeDomainData) return null;
    this.analyserNode.getByteTimeDomainData(this.timeDomainData);
    return new Uint8Array(this.timeDomainData);
  }

  /**
   * Release all Web Audio resources.
   * After dispose, this analyzer cannot be reused.
   */
  dispose(): void {
    this.stop();
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.analyserNode = null;
    if (this.audioContext?.state !== 'closed') {
      void this.audioContext?.close();
    }
    this.audioContext = null;
    this.timeDomainData = null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Compute RMS (Root Mean Square) volume level from time-domain data.
   * Returns a value between 0 (silence) and 1 (maximum).
   *
   * The AnalyserNode provides unsigned byte data centered at 128.
   * We subtract 128 to get signed values, then compute RMS.
   */
  private computeRMS(data: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const value = data[i];
      if (value === undefined) break;
      const sample = (value - 128) / 128;
      sum += sample * sample;
    }
    return Math.sqrt(sum / data.length);
  }
}
