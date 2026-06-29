// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import * as audioStore from '../../src/audio/audio-store';

describe('audio-store', () => {
  beforeEach(async () => {
    await audioStore.clearAll();
  });

  it('saves and retrieves a clip', async () => {
    const blob = new Blob(['fake-audio'], { type: 'audio/webm' });
    await audioStore.save('clip-1', blob, 'audio/webm');

    const clip = await audioStore.get('clip-1');
    expect(clip).not.toBeNull();
    expect(clip!.id).toBe('clip-1');
    expect(clip!.mimeType).toBe('audio/webm');
    expect(clip!.blob).toBeInstanceOf(Blob);
    expect(clip!.createdAt).toBeTypeOf('number');
  });

  it('returns null for non-existent clip', async () => {
    const clip = await audioStore.get('does-not-exist');
    expect(clip).toBeNull();
  });

  it('overwrites existing clip on save with same id', async () => {
    const blob1 = new Blob(['old'], { type: 'audio/webm' });
    await audioStore.save('clip-1', blob1, 'audio/webm');

    const blob2 = new Blob(['new'], { type: 'audio/ogg' });
    await audioStore.save('clip-1', blob2, 'audio/ogg');

    const clip = await audioStore.get('clip-1');
    expect(clip!.mimeType).toBe('audio/ogg');
    expect(await clip!.blob.text()).toBe('new');
  });

  it('deletes a clip', async () => {
    const blob = new Blob(['data'], { type: 'audio/webm' });
    await audioStore.save('clip-1', blob, 'audio/webm');

    await audioStore.remove('clip-1');

    const clip = await audioStore.get('clip-1');
    expect(clip).toBeNull();
  });

  it('delete is no-op for non-existent clip', async () => {
    await expect(audioStore.remove('ghost')).resolves.toBeUndefined();
  });

  it('deletes multiple clips in one transaction', async () => {
    await audioStore.save('a', new Blob(['1']), 'audio/webm');
    await audioStore.save('b', new Blob(['2']), 'audio/webm');
    await audioStore.save('c', new Blob(['3']), 'audio/webm');

    await audioStore.removeMany(['a', 'b']);

    expect(await audioStore.get('a')).toBeNull();
    expect(await audioStore.get('b')).toBeNull();
    expect(await audioStore.get('c')).not.toBeNull();
  });

  it('removeMany with empty array is a no-op', async () => {
    await expect(audioStore.removeMany([])).resolves.toBeUndefined();
  });

  it('clears all clips', async () => {
    await audioStore.save('x', new Blob(['1']), 'audio/webm');
    await audioStore.save('y', new Blob(['2']), 'audio/webm');

    await audioStore.clearAll();

    expect(await audioStore.get('x')).toBeNull();
    expect(await audioStore.get('y')).toBeNull();
  });
});
