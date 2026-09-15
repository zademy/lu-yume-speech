/**
 * Resumable take controller contract (spec T3): a failed MiniMax take keeps
 * its request audio and completed-fragment prefix in memory (session only),
 * Reintentar re-submits ONLY pending fragments, concurrent retries are
 * impossible, and stale progress from a disposed/replaced take can never
 * corrupt the current one.
 *
 * Assertions are behavioral: what the injected runner receives, and whether
 * it runs — no private state layout is observed.
 */
import { describe, expect, it } from 'vitest';

import { createResumableTakeController } from '../../src/api/resumable-take';
import type { ResumeRunInfo } from '../../src/api/transcription-provider';

function makeRun(
  impl: (audio: Blob, resume: ResumeRunInfo) => Promise<void> = async () => undefined,
): {
  run: (audio: Blob, resume: ResumeRunInfo) => Promise<void>;
  calls: Array<{ audioText: () => Promise<string>; resume: ResumeRunInfo }>;
} {
  const calls: Array<{ audioText: () => Promise<string>; resume: ResumeRunInfo }> = [];
  const run = async (audio: Blob, resume: ResumeRunInfo): Promise<void> => {
    calls.push({ audioText: () => audio.text(), resume });
    await impl(audio, resume);
  };
  return { run, calls };
}

const rawA = (): Blob => new Blob(['raw-a'], { type: 'audio/webm' });
const audioA = (): Blob => new Blob(['trimmed-a'], { type: 'audio/webm' });
const rawB = (): Blob => new Blob(['raw-b'], { type: 'audio/webm' });

describe('createResumableTakeController', () => {
  it('retry re-submits only pending fragments with the stored request audio', async () => {
    const { run, calls } = makeRun();
    const controller = createResumableTakeController({ run });

    controller.begin(rawA(), audioA());
    controller.progress(['a']);
    controller.failed();

    expect(controller.retry()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(await calls[0]!.audioText()).toBe('trimmed-a');
    expect(calls[0]!.resume.completedTexts).toEqual(['a']);
    expect(typeof calls[0]!.resume.onFragmentCompleted).toBe('function');
  });

  it('blocks concurrent retries while an attempt is in flight', () => {
    const { run, calls } = makeRun();
    const controller = createResumableTakeController({ run });

    controller.begin(rawA(), audioA());
    controller.failed();

    expect(controller.retry()).toBe(true);
    expect(controller.retry()).toBe(false);
    expect(calls).toHaveLength(1);

    // The attempt failed again → a new retry is allowed.
    controller.failed();
    expect(controller.retry()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('retry without state does nothing', () => {
    const { run, calls } = makeRun();
    const controller = createResumableTakeController({ run });
    expect(controller.retry()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a run rejection un-busies the controller (failure path)', async () => {
    const { run, calls } = makeRun(async () => {
      throw new Error('boom');
    });
    const controller = createResumableTakeController({ run });
    controller.begin(rawA(), audioA());
    expect(controller.retry()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.retry()).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('finished() clears the take — no further retry', () => {
    const { run, calls } = makeRun();
    const controller = createResumableTakeController({ run });
    controller.begin(rawA(), audioA());
    controller.failed();
    controller.finished();
    expect(controller.retry()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('dispose() releases state, ignores late progress and later retries', () => {
    const { run, calls } = makeRun();
    const controller = createResumableTakeController({ run });
    controller.begin(rawA(), audioA());
    controller.progress(['a']);
    controller.dispose();

    expect(controller.retry()).toBe(false);
    controller.progress(['z']);
    expect(controller.retry()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('a new take replaces the retained one without mixing', async () => {
    const { run, calls } = makeRun();
    const controller = createResumableTakeController({ run });

    const firstRaw = rawA();
    controller.begin(firstRaw, audioA());
    controller.progress(['a']);
    controller.failed();

    const secondRaw = rawB();
    controller.begin(secondRaw, new Blob(['trimmed-b'], { type: 'audio/webm' }));
    expect(controller.handles(firstRaw)).toBe(false);
    expect(controller.handles(secondRaw)).toBe(true);

    controller.retry();
    expect(await calls[0]!.audioText()).toBe('trimmed-b');
    expect(calls[0]!.resume.completedTexts).toEqual([]);
  });

  it('stale progress callbacks from an older attempt cannot corrupt the current take', () => {
    const { run, calls } = makeRun();
    const controller = createResumableTakeController({ run });

    controller.begin(rawA(), audioA());
    controller.failed();
    controller.retry();
    const firstResume = calls[0]?.resume;

    // The first attempt's late fragment completion arrives AFTER a new take
    // started — the next retry must resume from an empty prefix, not 'stale'.
    const secondRaw = rawB();
    controller.begin(secondRaw, new Blob(['trimmed-b'], { type: 'audio/webm' }));
    firstResume!.onFragmentCompleted?.(['stale']);
    controller.failed();

    expect(controller.retry()).toBe(true);
    expect(calls[1]!.resume.completedTexts).toEqual([]);

    // Current-attempt progress still lands on the CURRENT take.
    calls[1]!.resume.onFragmentCompleted?.(['fresh']);
    controller.failed();
    controller.retry();
    expect(calls[2]!.resume.completedTexts).toEqual(['fresh']);
  });
});
