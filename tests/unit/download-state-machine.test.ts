import { describe, expect, it } from 'vitest';

import {
  canStartDownload,
  isActivatable,
  nextLocalModelState,
} from '../../src/local-models/download-state-machine';
import type { LocalModelState } from '../../src/types';

describe('nextLocalModelState', () => {
  it('walks the happy path: not-downloaded → downloading → preparing → downloaded', () => {
    expect(nextLocalModelState('not-downloaded', { type: 'download-start' })).toEqual({
      ok: true,
      state: 'downloading',
    });
    expect(nextLocalModelState('downloading', { type: 'artifacts-complete' })).toEqual({
      ok: true,
      state: 'preparing',
    });
    expect(nextLocalModelState('preparing', { type: 'verified' })).toEqual({
      ok: true,
      state: 'downloaded',
    });
  });

  it('cancels a download into Descarga parcial', () => {
    expect(nextLocalModelState('downloading', { type: 'cancelled' })).toEqual({
      ok: true,
      state: 'partial',
    });
    expect(nextLocalModelState('preparing', { type: 'cancelled' })).toEqual({
      ok: true,
      state: 'partial',
    });
  });

  it('maps failures to error from both active phases', () => {
    expect(nextLocalModelState('downloading', { type: 'failed' })).toEqual({
      ok: true,
      state: 'error',
    });
    expect(nextLocalModelState('preparing', { type: 'verify-failed' })).toEqual({
      ok: true,
      state: 'error',
    });
  });

  it('re-downloads from partial and error, but not from downloaded', () => {
    expect(nextLocalModelState('partial', { type: 'download-start' })).toEqual({
      ok: true,
      state: 'downloading',
    });
    expect(nextLocalModelState('error', { type: 'download-start' })).toEqual({
      ok: true,
      state: 'downloading',
    });
    expect(nextLocalModelState('downloaded', { type: 'download-start' })).toEqual({ ok: false });
  });

  it('rejects events out of phase', () => {
    const illegal: Array<[LocalModelState, Parameters<typeof nextLocalModelState>[1]['type']]> = [
      ['not-downloaded', 'verified'],
      ['not-downloaded', 'cancelled'],
      ['downloading', 'verified'],
      ['preparing', 'artifacts-complete'],
      ['downloaded', 'cancelled'],
      ['downloaded', 'failed'],
      ['partial', 'verified'],
      ['error', 'cancelled'],
    ];
    for (const [state, event] of illegal) {
      expect(nextLocalModelState(state, { type: event }), `${state} + ${event}`).toEqual({
        ok: false,
      });
    }
  });
});

describe('canStartDownload', () => {
  it('is true exactly for not-downloaded, partial and error', () => {
    expect(canStartDownload('not-downloaded')).toBe(true);
    expect(canStartDownload('partial')).toBe(true);
    expect(canStartDownload('error')).toBe(true);
    expect(canStartDownload('downloading')).toBe(false);
    expect(canStartDownload('preparing')).toBe(false);
    expect(canStartDownload('downloaded')).toBe(false);
  });
});

describe('isActivatable', () => {
  it('only verified-complete models may activate — partial never', () => {
    expect(isActivatable('downloaded')).toBe(true);
    expect(isActivatable('partial')).toBe(false);
    expect(isActivatable('downloading')).toBe(false);
    expect(isActivatable('preparing')).toBe(false);
    expect(isActivatable('error')).toBe(false);
    expect(isActivatable('not-downloaded')).toBe(false);
  });
});
