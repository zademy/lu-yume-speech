import { describe, expect, it } from 'vitest';

import { TranscriptionSession } from '../../src/core/transcription-session';

function blob(text = 'audio'): Blob {
  return new Blob([text], { type: 'audio/webm' });
}

describe('TranscriptionSession', () => {
  it('starts idle with no pending audio', () => {
    const s = new TranscriptionSession();
    expect(s.getStage()).toBe('idle');
    expect(s.peekPending()).toBeNull();
  });

  it('transitions idle → recording → processing → idle', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    expect(s.getStage()).toBe('recording');
    s.submit(blob(), 'audio/webm');
    expect(s.getStage()).toBe('processing');
    s.complete();
    expect(s.getStage()).toBe('idle');
  });

  it('startRecording is a no-op while already recording', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.startRecording();
    expect(s.getStage()).toBe('recording');
  });

  it('ignores startRecording while processing (pipeline busy)', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob(), 'audio/webm');
    s.startRecording();
    expect(s.getStage()).toBe('processing');
  });

  it('cancelRecording drops a not-yet-submitted recording back to idle', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.cancelRecording();
    expect(s.getStage()).toBe('idle');
    expect(s.peekPending()).toBeNull();
  });

  it('cancelRecording is a no-op once audio has been submitted (processing)', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob(), 'audio/webm');
    s.cancelRecording(); // already processing — cannot cancel, must fail/complete
    expect(s.getStage()).toBe('processing');
    expect(s.peekPending()).not.toBeNull();
  });

  it('submit stashes the blob with the given mime type', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob(), 'audio/ogg;codecs=opus');
    const pending = s.peekPending();
    expect(pending).not.toBeNull();
    expect(pending!.mimeType).toBe('audio/ogg;codecs=opus');
  });

  it('submit falls back to the blob type and then webm', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob(), '');
    expect(s.peekPending()!.mimeType).toBe('audio/webm');
  });

  it('submit returns a previous unconsumed buffer (overwrite surfacing)', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    const first = blob('first');
    s.submit(first, 'audio/webm');
    const previous = s.submit(blob('second'), 'audio/webm');
    expect(previous).not.toBeNull();
    expect(previous!.blob).toBe(first);
  });

  it('complete returns and clears the pending audio', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob('take'), 'audio/webm');
    const pending = s.complete();
    expect(pending).not.toBeNull();
    expect(pending!.mimeType).toBe('audio/webm');
    expect(s.peekPending()).toBeNull();
    expect(s.getStage()).toBe('idle');
  });

  it('complete on an idle session returns null', () => {
    const s = new TranscriptionSession();
    expect(s.complete()).toBeNull();
  });

  it('fail clears pending so a later success saves the right clip', async () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob('failed-take'), 'audio/webm');
    s.fail();
    expect(s.peekPending()).toBeNull();
    expect(s.getStage()).toBe('idle');

    s.startRecording();
    s.submit(blob('good-take'), 'audio/webm');
    const pending = s.complete();
    expect(pending).not.toBeNull();
    expect(await pending!.blob.text()).toBe('good-take');
  });

  it('failKeepingAudio returns to idle but keeps the clip for manual recovery (T7)', async () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob('failed-local-take'), 'audio/webm');

    const kept = s.failKeepingAudio();
    expect(kept).not.toBeNull();
    expect(await kept!.blob.text()).toBe('failed-local-take');
    // Session is reusable — a retry completes and TAKES the kept clip.
    expect(s.getStage()).toBe('idle');
    const taken = s.complete();
    expect(await taken!.blob.text()).toBe('failed-local-take');
    expect(s.peekPending()).toBeNull();
  });

  it('a new recording after failKeepingAudio overwrites the kept clip (surfaced)', async () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob('old-failed'), 'audio/webm');
    s.failKeepingAudio();

    s.startRecording();
    const previous = s.submit(blob('new-take'), 'audio/webm');
    expect(previous).not.toBeNull();
    expect(await previous!.blob.text()).toBe('old-failed');
    expect(await s.complete()!.blob.text()).toBe('new-take');
  });

  it('discardKept drops recovery audio without touching the stage', () => {
    const s = new TranscriptionSession();
    s.startRecording();
    s.submit(blob('stale'), 'audio/webm');
    s.failKeepingAudio();
    s.discardKept();
    expect(s.peekPending()).toBeNull();
  });
});
