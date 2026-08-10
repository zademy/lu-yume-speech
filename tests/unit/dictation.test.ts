import { describe, expect, it } from 'vitest';

import { nextDictationState } from '../../src/escritos/dictation';

describe('nextDictationState', () => {
  const idle = nextDictationState(
    { active: false, recording: false, message: '', level: 'idle' },
    { type: 'reset' },
    'en',
  );

  it('arms when toggled on and the recorder starts', () => {
    const next = nextDictationState(idle, { type: 'toggle', nowRecording: true }, 'en');
    expect(next).toMatchObject({ active: true, recording: true, level: 'recording' });
  });

  it('arms but waits when toggled on before mic is ready', () => {
    const next = nextDictationState(idle, { type: 'toggle', nowRecording: false }, 'en');
    expect(next).toMatchObject({ active: true, recording: false, level: 'warning' });
  });

  it('disarms and clears recording state when toggled off', () => {
    const armed = nextDictationState(idle, { type: 'toggle', nowRecording: true }, 'en');
    const next = nextDictationState(armed, { type: 'toggle', nowRecording: false }, 'en');
    expect(next).toMatchObject({ active: false, recording: false, level: 'idle' });
  });

  it('reflects recording:start only when armed', () => {
    // Not armed — start is ignored.
    const a = nextDictationState(idle, { type: 'recording:start' }, 'en');
    expect(a).toEqual(idle);
    // Armed — start moves us to recording.
    const armed = nextDictationState(idle, { type: 'toggle', nowRecording: false }, 'en');
    const b = nextDictationState(armed, { type: 'recording:start' }, 'en');
    expect(b).toMatchObject({ recording: true, level: 'recording' });
  });

  it('reflects recording:stop only when armed', () => {
    const armed = nextDictationState(idle, { type: 'toggle', nowRecording: true }, 'en');
    const stopped = nextDictationState(armed, { type: 'recording:stop' }, 'en');
    expect(stopped).toMatchObject({ recording: false, level: 'processing' });
  });

  it('surfaces arbitrary status updates', () => {
    const next = nextDictationState(
      idle,
      { type: 'status', message: 'custom', level: 'error' },
      'en',
    );
    expect(next).toMatchObject({ message: 'custom', level: 'error' });
  });

  it('reset returns to idle regardless of prior state', () => {
    const armed = nextDictationState(idle, { type: 'toggle', nowRecording: true }, 'en');
    const next = nextDictationState(armed, { type: 'reset' }, 'en');
    expect(next).toMatchObject({ active: false, recording: false, level: 'idle' });
  });

  it('honors the Spanish dictionary for messages', () => {
    const next = nextDictationState(idle, { type: 'toggle', nowRecording: true }, 'es');
    expect(next.message).toBe('Escuchando — hablá ahora.');
  });
});
