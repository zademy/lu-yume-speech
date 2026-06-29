import { describe, it, expect, beforeEach, vi } from 'vitest';
import { load, save, remove } from '../../src/utils/storage';

describe('storage wrapper', () => {
  beforeEach(() => localStorage.clear());

  it('save then load round-trips JSON', () => {
    save('key', { a: 1 });
    expect(load<{ a: number }>('key', { a: 0 })).toEqual({ a: 1 });
    expect(localStorage.getItem('stt_key')).toBe('{"a":1}');
  });

  it('load returns defaultValue for missing key', () => {
    expect(load('missing', null)).toBeNull();
    expect(load('missing', { fallback: true })).toEqual({ fallback: true });
  });

  it('remove deletes the underlying key', () => {
    save('key', 1);
    remove('key');
    expect(localStorage.getItem('stt_key')).toBeNull();
  });

  it('load returns defaultValue on corrupt JSON (no throw)', () => {
    localStorage.setItem('stt_bad', '{not json');
    expect(load('bad', null)).toBeNull();
  });

  it('save swallows quota errors gracefully (does not throw)', () => {
    const spy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => save('k', 'v')).not.toThrow();
    spy.mockRestore();
  });

  it('save logs a console.warn on quota error', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const setSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    save('k', 'v');
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/quota|storage/i);
    setSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('load logs a console.warn on corrupt JSON', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem('stt_bad', '{not json');
    load('bad', null);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
