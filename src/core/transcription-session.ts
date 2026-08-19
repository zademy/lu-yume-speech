/**
 * Transcription pipeline session — named, testable lifecycle state.
 *
 * Replaces the implicit `lastBlob` / `lastMimeType` closure that used to live
 * inside the composition root. Owning the blob-awaiting-result as a real object
 * removes two latent bugs:
 *
 *  - **Silent overwrite**: a second recording arriving before the first
 *    transcription resolved used to clobber the stashed blob.
 *  - **Leak on error**: when transcription failed, the blob was never cleared,
 *    so a later success saved the wrong (stale) audio clip.
 *
 * The session is a pure state machine with no EventBus or DOM dependency, so
 * the whole transition table is unit-testable in isolation.
 *
 * SRP: it only tracks pipeline stage and the one pending audio buffer.
 */

/** Pipeline lifecycle stages. */
export type SessionStage = 'idle' | 'recording' | 'processing';

/** An audio buffer awaiting the transcription result that matches it. */
export interface PendingAudio {
  blob: Blob;
  mimeType: string;
}

export class TranscriptionSession {
  private stage: SessionStage = 'idle';
  private pending: PendingAudio | null = null;

  /** Current lifecycle stage. */
  getStage(): SessionStage {
    return this.stage;
  }

  /** The stashed audio buffer, if any (does not remove it). */
  peekPending(): PendingAudio | null {
    return this.pending;
  }

  /** Move idle → recording. No-op if already recording; ignored while processing. */
  startRecording(): void {
    if (this.stage === 'idle') this.stage = 'recording';
  }

  /** Move recording → idle, dropping any not-yet-submitted audio. */
  cancelRecording(): void {
    if (this.stage === 'recording') {
      this.stage = 'idle';
      this.pending = null;
    }
  }

  /**
   * Stash the recorded audio and move to `processing`.
   *
   * If a previous buffer was still pending (rapid re-record before the prior
   * result resolved), it is returned so the caller can release it — this is
   * the exact overwrite bug the session exists to make visible.
   */
  submit(blob: Blob, mimeType: string): PendingAudio | null {
    const previous = this.pending;
    this.pending = { blob, mimeType: mimeType || blob.type || 'audio/webm' };
    this.stage = 'processing';
    return previous;
  }

  /**
   * Take the stashed audio (e.g. to save the clip alongside the result) and
   * return to idle. Returns `null` when nothing was stashed.
   */
  complete(): PendingAudio | null {
    const pending = this.pending;
    this.pending = null;
    this.stage = 'idle';
    return pending;
  }

  /**
   * Abandon a failed run: drop the stashed audio and return to idle.
   * Prevents a later success from saving audio that belongs to a failed take.
   */
  fail(): void {
    this.pending = null;
    this.stage = 'idle';
  }

  /**
   * Abandon a failed LOCAL run while keeping the stashed audio for manual
   * recovery (spec T7: the Grabación is conserved and only manual actions
   * are offered). Returns the kept audio — null when nothing was stashed.
   * A subsequent recording overwrites it (surfaced by `submit`), and
   * `complete()` takes it when a retry succeeds.
   */
  failKeepingAudio(): PendingAudio | null {
    this.stage = 'idle';
    return this.pending;
  }

  /** Drop any recovery audio kept by {@link failKeepingAudio}. */
  discardKept(): void {
    this.pending = null;
  }
}
