import { describe, expect, it, vi } from 'vitest';

import {
  APP_IMAGE_PREFIX,
  extractImageIds,
  hydrateImages,
  serializeImages,
} from '../../src/escritos/images';

describe('images helpers', () => {
  describe('extractImageIds', () => {
    it('extracts app-image ids in order', () => {
      expect(extractImageIds('![a](app-image:id1) x ![b](app-image:id2)')).toEqual(['id1', 'id2']);
    });

    it('returns empty when there are no app-image refs', () => {
      expect(extractImageIds('no images here')).toEqual([]);
      expect(extractImageIds('![a](https://example.com/x.png)')).toEqual([]);
    });

    it('dedupes repeated ids', () => {
      expect(extractImageIds('![a](app-image:id1)![b](app-image:id1)')).toEqual(['id1']);
    });
  });

  describe('serializeImages', () => {
    it('rewrites object URLs back to app-image refs', () => {
      const map = new Map([['blob:x', 'id1']]);
      expect(serializeImages('![a](blob:x) text', map)).toBe('![a](app-image:id1) text');
    });

    it('leaves unrelated URLs untouched', () => {
      expect(serializeImages('![a](https://example.com/y.png)', new Map())).toBe(
        '![a](https://example.com/y.png)',
      );
    });

    it('rewrites every occurrence of each object URL', () => {
      const map = new Map([['blob:x', 'id1']]);
      expect(serializeImages('![a](blob:x) ![b](blob:x)', map)).toBe(
        '![a](app-image:id1) ![b](app-image:id1)',
      );
    });
  });

  describe('hydrateImages', () => {
    it('resolves blobs via the adapter and rewrites refs to object URLs', async () => {
      const blob = new Blob(['x'], { type: 'image/png' });
      const adapter = { loadBlob: vi.fn().mockResolvedValue(blob) };

      const { md, idToObject, objectToId } = await hydrateImages(
        `![a](${APP_IMAGE_PREFIX}id1)`,
        adapter,
      );

      expect(adapter.loadBlob).toHaveBeenCalledWith('id1');
      const obj = idToObject.get('id1');
      expect(obj).toBeTruthy();
      expect(md).toContain(obj!);
      expect(objectToId.get(obj!)).toBe('id1');
    });

    it('leaves the ref untouched when the blob is missing', async () => {
      const adapter = { loadBlob: vi.fn().mockResolvedValue(null) };
      const { md, idToObject } = await hydrateImages(`![a](${APP_IMAGE_PREFIX}gone)`, adapter);
      expect(idToObject.size).toBe(0);
      expect(md).toContain(`${APP_IMAGE_PREFIX}gone`);
    });

    it('hydrates multiple distinct ids', async () => {
      const adapter = {
        loadBlob: vi.fn(async (id: string) =>
          id === 'id1'
            ? new Blob(['a'], { type: 'image/png' })
            : new Blob(['b'], { type: 'image/png' }),
        ),
      };
      const { idToObject } = await hydrateImages(
        `![a](${APP_IMAGE_PREFIX}id1) ![b](${APP_IMAGE_PREFIX}id2)`,
        adapter,
      );
      expect([...idToObject.keys()].sort()).toEqual(['id1', 'id2']);
    });
  });
});
