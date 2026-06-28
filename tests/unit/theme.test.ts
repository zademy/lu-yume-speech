import { describe, it, expect, beforeEach } from 'vitest';
import { STORAGE_KEY } from '../../src/utils/theme';
import { save } from '../../src/utils/storage';

describe('theme storage key', () => {
  beforeEach(() => localStorage.clear());

  it('STORAGE_KEY is "theme" (storage layer adds stt_ prefix)', () => {
    expect(STORAGE_KEY).toBe('theme');
  });

  it('persisted value lands at stt_theme (matches index.html no-flash script)', () => {
    save(STORAGE_KEY, 'dark');
    expect(localStorage.getItem('stt_theme')).toBe('"dark"');
    // The no-flash script reads localStorage.getItem('stt_theme') then JSON.parse
    expect(localStorage.getItem('theme')).toBeNull();
  });
});
