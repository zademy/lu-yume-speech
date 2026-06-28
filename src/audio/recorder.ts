/**
 * Audio recorder module.
 *
 * Wraps the browser's MediaRecorder API into a clean, reusable class.
 * Emits events through the application event bus so other modules
 * can react to recording lifecycle changes without coupling.
 *
 * Responsibilities (SRP — one reason to change: recording logic):
 * - Request microphone access
 * - Manage recording start/stop lifecycle
 * - Collect audio chunks into a single Blob
 * - Detect the best supported MIME type
 *
 * It does NOT know about:
 * - Transcription (that's GroqClient)
 * - UI state (that's the renderer)
 * - Keyboard shortcuts (that's keyboard.ts)
 *
 * DIP: Depends on EventBus abstraction, not on concrete consumers.
 * OCP: Accepts custom MediaStreamConstraints without modification.
 */

import type { EventBus } from '../core/event-bus';
import type { EventMap } from '../types';
import { AUDIO_MIME_TYPES } from '../types';

/** Optimal audio constraints for speech recognition. */
const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

export class Recorder {
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private mimeType: string | undefined;

  private readonly bus: EventBus<EventMap>;

  /**
   * @param bus - Application event bus for emitting lifecycle events.
   */
  constructor(bus: EventBus<EventMap>) {
    this.bus = bus;
  }

  /**
   * Initialize the recorder by requesting microphone access.
   * Must be called before `start()` / `stop()`.
   *
   * @returns The acquired MediaStream so callers can share it with other modules (e.g., AudioAnalyzer).
   * @throws Error if the user denies microphone permission.
   */
  async init(constraints: MediaStreamConstraints = DEFAULT_CONSTRAINTS): Promise<MediaStream> {
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.mimeType = this.detectMimeType();
    this.mediaRecorder = this.buildRecorder(this.stream);
    return this.stream;
  }

  /**
   * Start capturing audio.
   * No-op if already recording or not initialized.
   */
  start(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'inactive') return;

    this.audioChunks = [];
    this.mediaRecorder.start();
    this.bus.emit('recording:start', undefined);
  }

  /**
   * Stop capturing audio.
   * The complete audio blob is emitted via the `audio:blob-ready` event.
   * No-op if not currently recording.
   */
  stop(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'recording') return;
    this.mediaRecorder.stop();
  }

  /**
   * Current MediaRecorder state.
   * Returns 'inactive' when not initialized.
   */
  get state(): RecordingState {
    return this.mediaRecorder?.state ?? 'inactive';
  }

  /**
   * Release microphone and all resources.
   * Call this when the recorder is permanently discarded.
   */
  dispose(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.stream?.getTracks().forEach((track) => { track.stop(); });
    this.stream = null;
    this.mediaRecorder = null;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build a MediaRecorder wired to emit events on data and stop.
   */
  private buildRecorder(stream: MediaStream): MediaRecorder {
    const options = this.mimeType ? { mimeType: this.mimeType } : undefined;
    const recorder = new MediaRecorder(stream, options);

    recorder.ondataavailable = (event: BlobEvent) => {
      this.audioChunks.push(event.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(this.audioChunks, {
        type: this.mimeType || 'audio/webm',
      });
      this.audioChunks = [];

      this.bus.emit('audio:blob-ready', blob);
      this.bus.emit('recording:stop', undefined);
    };

    return recorder;
  }

  /**
   * Find the best supported audio MIME type for this browser.
   * Prefers opus codec for its quality-to-size ratio.
   */
  private detectMimeType(): string | undefined {
    for (const mime of AUDIO_MIME_TYPES) {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    }
    return undefined;
  }
}
