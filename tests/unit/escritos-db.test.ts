// @vitest-environment node

import 'fake-indexeddb/auto';

import { afterEach, describe, expect, it } from 'vitest';

import type { ImagenEscrito } from '../../src/types';
import {
  __resetForTests,
  clearAllEscritos,
  createEscrito,
  getAllEscritos,
  getEscrito,
  getImagen,
  getImagenesByEscrito,
  removeEscrito,
  removeImagen,
  renameEscrito,
  saveImagen,
  updateContent,
} from '../../src/escritos/escritos-db';

afterEach(async () => {
  await clearAllEscritos();
  __resetForTests();
});

function blob(text: string, mimeType = 'image/png'): Blob {
  return new Blob([text], { type: mimeType });
}

describe('escritos-db', () => {
  describe('createEscrito', () => {
    it('persists a new escrito with empty body and stable timestamps', async () => {
      const escrito = await createEscrito();
      expect(escrito.id).toBeTruthy();
      expect(escrito.contenidoMD).toBe('');
      expect(escrito.titulo).toBe('');
      expect(escrito.createdAt).toBe(escrito.updatedAt);

      const fetched = await getEscrito(escrito.id);
      expect(fetched).toEqual(escrito);
    });

    it('honours a provided title', async () => {
      const escrito = await createEscrito('Lluvia de ideas');
      expect(escrito.titulo).toBe('Lluvia de ideas');
    });
  });

  describe('getAllEscritos', () => {
    it('returns escritos newest-first by updatedAt', async () => {
      const a = await createEscrito('a');
      // bump `a.updatedAt` so ordering is deterministic regardless of clock jitter
      await updateContent(a.id, '# A');
      await new Promise((r) => setTimeout(r, 2));
      const b = await createEscrito('b');

      const all = await getAllEscritos();
      expect(all.map((e) => e.id)).toEqual([b.id, a.id]);
    });

    it('is empty when nothing is persisted', async () => {
      expect(await getAllEscritos()).toEqual([]);
    });
  });

  describe('renameEscrito', () => {
    it('renames and bumps updatedAt, returning true', async () => {
      const escrito = await createEscrito();
      const before = escrito.updatedAt;
      await new Promise((r) => setTimeout(r, 2));
      const ok = await renameEscrito(escrito.id, 'Título nuevo');
      expect(ok).toBe(true);

      const fetched = await getEscrito(escrito.id);
      expect(fetched?.titulo).toBe('Título nuevo');
      expect((fetched?.updatedAt ?? 0) > before).toBe(true);
    });

    it('returns false for a missing escrito', async () => {
      expect(await renameEscrito('nope', 'x')).toBe(false);
    });
  });

  describe('updateContent', () => {
    it('writes markdown and bumps updatedAt', async () => {
      const escrito = await createEscrito();
      const ok = await updateContent(escrito.id, '# Hola\n\nun párrafo');
      expect(ok).toBe(true);

      const fetched = await getEscrito(escrito.id);
      expect(fetched?.contenidoMD).toBe('# Hola\n\nun párrafo');
    });

    it('returns false for a missing escrito', async () => {
      expect(await updateContent('nope', 'x')).toBe(false);
    });
  });

  describe('removeEscrito', () => {
    it('deletes the escrito and cascades its images atomically', async () => {
      const escrito = await createEscrito();
      const img1: ImagenEscrito = {
        id: 'img-1',
        escritoId: escrito.id,
        blob: blob('a'),
        mimeType: 'image/png',
        createdAt: Date.now(),
      };
      const img2: ImagenEscrito = {
        id: 'img-2',
        escritoId: escrito.id,
        blob: blob('b'),
        mimeType: 'image/jpeg',
        createdAt: Date.now(),
      };
      await saveImagen(img1);
      await saveImagen(img2);

      await removeEscrito(escrito.id);

      expect(await getEscrito(escrito.id)).toBeUndefined();
      expect(await getImagen('img-1')).toBeUndefined();
      expect(await getImagen('img-2')).toBeUndefined();
    });

    it('is a no-op for a missing escrito', async () => {
      await expect(removeEscrito('nope')).resolves.toBeUndefined();
    });
  });

  describe('imágenes', () => {
    it('fetches images by escrito and deletes one by id', async () => {
      const escrito = await createEscrito();
      const img: ImagenEscrito = {
        id: 'img-x',
        escritoId: escrito.id,
        blob: blob('x'),
        mimeType: 'image/png',
        createdAt: Date.now(),
      };
      await saveImagen(img);

      expect(await getImagenesByEscrito(escrito.id)).toHaveLength(1);
      await removeImagen('img-x');
      expect(await getImagenesByEscrito(escrito.id)).toHaveLength(0);
    });

    it('survives a round-trip preserving blob bytes and mime', async () => {
      const escrito = await createEscrito();
      const img: ImagenEscrito = {
        id: 'img-rt',
        escritoId: escrito.id,
        blob: blob('raw-bytes', 'image/webp'),
        mimeType: 'image/webp',
        createdAt: Date.now(),
      };
      await saveImagen(img);
      const fetched = await getImagen('img-rt');
      expect(fetched?.mimeType).toBe('image/webp');
      expect(await fetched?.blob.text()).toBe('raw-bytes');
    });
  });

  describe('clearAllEscritos', () => {
    it('wipes both escritos and images', async () => {
      const escrito = await createEscrito();
      await saveImagen({
        id: 'img',
        escritoId: escrito.id,
        blob: blob('a'),
        mimeType: 'image/png',
        createdAt: Date.now(),
      });

      await clearAllEscritos();

      expect(await getAllEscritos()).toEqual([]);
      expect(await getImagen('img')).toBeUndefined();
    });
  });
});
