/**
 * Audio processor module.
 *
 * Builds a Web Audio API processing graph between the raw microphone stream
 * and the MediaRecorder. This is where noise reduction and audio enhancement
 * happen BEFORE audio is captured for transcription.
 *
 * Supports three modes:
 * - 'off':     Passthrough (WebRTC built-in processing only)
 * - 'dsp':     Highpass filter (80Hz) + dynamics compressor (speech-optimized)
 * - 'rnnoise': RNNoise neural noise suppression + DSP filters
 *
 * DIP: Depends on nothing — produces a processed MediaStream + AnalyserNode.
 * SRP: One responsibility — audio processing chain management.
 */

import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor';
// Vite ?url imports — these resolve at build time to asset URLs
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';

export type NoiseReductionMode = 'off' | 'dsp' | 'rnnoise';

export interface ProcessedAudio {
  /** MediaStream containing processed audio — feed this to MediaRecorder. */
  readonly stream: MediaStream;
  /** AnalyserNode connected after the processing chain — use for waveform/RMS. */
  readonly analyser: AnalyserNode;
  /** Shared AudioContext (owned by this processor). */
  readonly audioContext: AudioContext;
}

export class AudioProcessor {
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private highpassNode: BiquadFilterNode | null = null;
  private compressorNode: DynamicsCompressorNode | null = null;
  private destinationNode: MediaStreamAudioDestinationNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private rnnoiseNode: RnnoiseWorkletNode | null = null;

  private mode: NoiseReductionMode = 'dsp';
  private workletLoaded = false;

  /**
   * Process a raw microphone stream through the selected enhancement chain.
   * Returns the processed stream + shared analyser.
   */
  async process(rawStream: MediaStream, mode: NoiseReductionMode = 'dsp'): Promise<ProcessedAudio> {
    // RNNoise requires 48kHz — create context at that rate
    this.audioContext = new AudioContext({ sampleRate: 48000 });
    this.sourceNode = this.audioContext.createMediaStreamSource(rawStream);
    this.destinationNode = this.audioContext.createMediaStreamDestination();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 2048;
    this.analyserNode.smoothingTimeConstant = 0.8;

    // DSP filter nodes (created once, reused across mode switches)
    this.highpassNode = this.audioContext.createBiquadFilter();
    this.highpassNode.type = 'highpass';
    this.highpassNode.frequency.value = 80;
    this.highpassNode.Q.value = 0.7;

    this.compressorNode = this.audioContext.createDynamicsCompressor();
    this.compressorNode.threshold.value = -24;
    this.compressorNode.knee.value = 30;
    this.compressorNode.ratio.value = 12;
    this.compressorNode.attack.value = 0.003;
    this.compressorNode.release.value = 0.25;

    this.mode = mode;
    await this.buildGraph();

    return {
      stream: this.destinationNode.stream,
      analyser: this.analyserNode,
      audioContext: this.audioContext,
    };
  }

  /**
   * Switch noise reduction mode at runtime.
   * Rebuilds the processing graph without re-creating the AudioContext.
   */
  async setMode(mode: NoiseReductionMode): Promise<void> {
    if (this.mode === mode || !this.audioContext) return;
    this.mode = mode;
    await this.buildGraph();
  }

  get currentMode(): NoiseReductionMode {
    return this.mode;
  }

  getAnalyser(): AnalyserNode | null {
    return this.analyserNode;
  }

  /**
   * Release all Web Audio resources.
   * After dispose, this processor cannot be reused.
   */
  dispose(): void {
    this.sourceNode?.disconnect();
    this.rnnoiseNode?.disconnect();
    this.rnnoiseNode?.destroy();
    this.rnnoiseNode = null;
    if (this.audioContext?.state !== 'closed') {
      void this.audioContext?.close();
    }
    this.sourceNode = null;
    this.highpassNode = null;
    this.compressorNode = null;
    this.destinationNode = null;
    this.analyserNode = null;
    this.audioContext = null;
  }

  // -----------------------------------------------------------------------
  // Private — graph construction
  // -----------------------------------------------------------------------

  /**
   * Build the processing graph based on the current mode.
   * Disconnects all nodes first, then reconnects in the correct order.
   */
  private async buildGraph(): Promise<void> {
    if (!this.sourceNode || !this.destinationNode || !this.analyserNode || !this.audioContext) {
      return;
    }
    if (!this.highpassNode || !this.compressorNode) return;

    // Teardown existing connections
    this.sourceNode.disconnect();
    this.rnnoiseNode?.disconnect();
    this.rnnoiseNode?.destroy();
    this.rnnoiseNode = null;
    this.highpassNode.disconnect();
    this.compressorNode.disconnect();
    this.analyserNode.disconnect();

    if (this.mode === 'off') {
      // Passthrough: source → analyser → destination
      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.destinationNode);
      return;
    }

    // Chain: source → [rnnoise?] → highpass → compressor → analyser → destination
    let lastNode: AudioNode = this.sourceNode;

    if (this.mode === 'rnnoise') {
      const rnnoise = await this.createRnnoise(this.audioContext);
      if (rnnoise) {
        this.rnnoiseNode = rnnoise;
        lastNode.connect(rnnoise);
        lastNode = rnnoise;
      }
      // If RNNoise fails to load, fall through to DSP-only chain
    }

    lastNode.connect(this.highpassNode);
    this.highpassNode.connect(this.compressorNode);
    this.compressorNode.connect(this.analyserNode);
    this.analyserNode.connect(this.destinationNode);
  }

  /**
   * Lazily load the RNNoise AudioWorklet processor + WASM model.
   * The worklet module is registered once per AudioContext.
   */
  private async createRnnoise(ctx: AudioContext): Promise<RnnoiseWorkletNode | null> {
    try {
      if (!this.workletLoaded) {
        await ctx.audioWorklet.addModule(rnnoiseWorkletUrl);
        this.workletLoaded = true;
      }
      const wasmBinary = await loadRnnoise({
        url: rnnoiseWasmUrl,
        simdUrl: rnnoiseSimdWasmUrl,
      });
      return new RnnoiseWorkletNode(ctx, { maxChannels: 1, wasmBinary });
    } catch (err) {
      console.warn('[AudioProcessor] RNNoise load failed, falling back to DSP:', err);
      return null;
    }
  }
}
