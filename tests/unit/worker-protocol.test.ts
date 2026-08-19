import { describe, expect, it } from 'vitest';

import { isWorkerResponse } from '../../src/local-models/worker-protocol';

describe('isWorkerResponse', () => {
  it('accepts every well-formed response shape', () => {
    expect(isWorkerResponse({ type: 'ready', requestId: 1 })).toBe(true);
    expect(isWorkerResponse({ type: 'loading', requestId: 2, note: '…' })).toBe(true);
    expect(isWorkerResponse({ type: 'result', requestId: 3, text: 'hola' })).toBe(true);
    expect(isWorkerResponse({ type: 'error', requestId: 4, message: 'boom' })).toBe(true);
  });

  it('rejects malformed payloads', () => {
    expect(isWorkerResponse(null)).toBe(false);
    expect(isWorkerResponse('ready')).toBe(false);
    expect(isWorkerResponse({ type: 'ready' })).toBe(false);
    expect(isWorkerResponse({ type: 'ready', requestId: '1' })).toBe(false);
    expect(isWorkerResponse({ type: 'nonsense', requestId: 1 })).toBe(false);
  });
});
