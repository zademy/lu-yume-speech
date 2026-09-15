/**
 * Resumable take controller — session-only recovery state for a failed
 * multi-fragment take (spec T3).
 *
 * Single responsibility: own ONE take's retained artifacts in memory — the
 * original recording (identity for retry routing), the request audio that
 * produced the fragment results (so a retry re-partitions identical bytes),
 * and the completed-fragment prefix. It guards against concurrent retries
 * and ignores stale progress from disposed/replaced takes (generation
 * check). The actual upload is delegated to an injected runner so it stays
 * free of bus/DOM/provider dependencies and fully unit-testable through its
 * observable behavior: what the runner receives, and whether it runs.
 *
 * Lifetime: while the page stays open, or until `finished`/`dispose`/a new
 * `begin` — never persisted.
 */

import type { ResumeRunInfo } from './transcription-provider';

/** Runner: re-submit the take's request audio resuming from the prefix. */
export type ResumeRunner = (audio: Blob, resume: ResumeRunInfo) => Promise<void>;

export interface ResumableTakeController {
  /** Register a NEW take (replaces any retained one without mixing). */
  begin(rawBlob: Blob, requestAudio: Blob): void;
  /** Record the completed-fragment prefix of the CURRENT take. */
  progress(completedTexts: string[]): void;
  /** A terminal failure: retain state, allow a later retry. */
  failed(): void;
  /** The take completed — clear state. */
  finished(): void;
  /** Explicit disposal (dismiss/new non-resumable take): release state. */
  dispose(): void;
  /** True when `rawBlob` is the retained take's original recording. */
  handles(rawBlob: Blob): boolean;
  /** Start a guarded retry; false when nothing is retained or already busy. */
  retry(): boolean;
}

interface TakeState {
  raw: Blob;
  audio: Blob;
  texts: string[];
}

export function createResumableTakeController(deps: {
  run: ResumeRunner;
}): ResumableTakeController {
  let generation = 0;
  let state: TakeState | null = null;
  let busy = false;

  const begin = (rawBlob: Blob, requestAudio: Blob): void => {
    generation += 1;
    state = { raw: rawBlob, audio: requestAudio, texts: [] };
    busy = false;
  };

  return {
    begin,
    progress(completedTexts) {
      if (state) state.texts = [...completedTexts];
    },
    failed() {
      busy = false;
    },
    finished() {
      generation += 1;
      state = null;
      busy = false;
    },
    dispose() {
      generation += 1;
      state = null;
      busy = false;
    },
    handles: (rawBlob) => state !== null && state.raw === rawBlob,
    retry() {
      if (!state || busy) return false;
      busy = true;
      const attempt = state;
      const attemptGeneration = generation;
      const resume: ResumeRunInfo = {
        completedTexts: [...attempt.texts],
        onFragmentCompleted: (texts) => {
          // Only the attempt's own generation may update the current take —
          // a late callback after replacement/disposal is silently dropped.
          if (state === attempt && generation === attemptGeneration) {
            state.texts = [...texts];
          }
        },
      };
      void deps.run(attempt.audio, resume).catch(() => {
        if (generation === attemptGeneration) busy = false;
      });
      return true;
    },
  };
}
