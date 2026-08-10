import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IMPROVE_MODEL,
  ImproveError,
  buildImproveSystemPrompt,
  clampSelection,
  improveSelection,
  parseImproveResponse,
  stripInvisibleChars,
} from '../../src/escritos/improve';

describe('improve — pure helpers', () => {
  describe('stripInvisibleChars', () => {
    it('removes zero-width and bidi characters but keeps visible text', () => {
      expect(stripInvisibleChars('hello\u200bworld')).toBe('helloworld');
      expect(stripInvisibleChars('foo\u202ebar')).toBe('foobar');
      expect(stripInvisibleChars('plain text')).toBe('plain text');
    });
  });

  describe('buildImproveSystemPrompt', () => {
    it('returns the base prompt by default', () => {
      const p = buildImproveSystemPrompt();
      expect(p).toContain('improve');
      expect(p).toContain('{"text": string}');
      expect(p).not.toContain('Additional instructions');
    });

    it('appends extra instructions when provided', () => {
      const p = buildImproveSystemPrompt('Use British spelling.');
      expect(p).toContain('Additional instructions: Use British spelling.');
    });
  });

  describe('parseImproveResponse', () => {
    it('parses a well-formed { "text": ... } payload', () => {
      expect(parseImproveResponse(JSON.stringify({ text: 'Improved!' }))).toBe('Improved!');
    });

    it('strips invisible chars from the parsed value', () => {
      expect(parseImproveResponse(JSON.stringify({ text: 'a\u200bb' }))).toBe('ab');
    });

    it('falls back to the raw string when JSON is malformed', () => {
      expect(parseImproveResponse('just plain text')).toBe('just plain text');
    });

    it('returns empty for empty input', () => {
      expect(parseImproveResponse('')).toBe('');
      expect(parseImproveResponse('   ')).toBe('');
    });

    it('falls back to raw when the parsed object lacks text', () => {
      expect(parseImproveResponse(JSON.stringify({ other: 'x' }))).toBe(
        JSON.stringify({ other: 'x' }),
      );
    });
  });

  describe('clampSelection', () => {
    it('returns the input when under the limit', () => {
      expect(clampSelection('short', 100)).toBe('short');
    });

    it('truncates over-long selections', () => {
      const big = 'x'.repeat(5000);
      expect(clampSelection(big, 100).length).toBe(100);
    });

    it('uses the default limit when none is passed', () => {
      const big = 'y'.repeat(5000);
      const clamped = clampSelection(big);
      expect(clamped.length).toBeLessThanOrEqual(4000);
    });
  });
});

describe('improveSelection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to Groq chat completions with the improve schema and returns the cleaned text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ text: 'Improved version.' }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(improveSelection('draft text', 'gsk_key')).resolves.toBe('Improved version.');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string; json_schema: { strict: boolean; name: string } };
      temperature: number;
    };
    expect(body.model).toBe(IMPROVE_MODEL);
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'draft text' });
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true, name: 'improve_output' },
    });
    expect(body.temperature).toBe(0);
  });

  it('throws ImproveError on empty selection', async () => {
    await expect(improveSelection('   ', 'gsk_key')).rejects.toBeInstanceOf(ImproveError);
  });

  it('throws ImproveError when the API key is missing', async () => {
    await expect(improveSelection('text', '')).rejects.toMatchObject({ name: 'ImproveError' });
  });

  it('surfaces 429 rate limit as ImproveError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: { message: 'Too many requests' } }), {
          status: 429,
          headers: { 'retry-after': '12' },
        }),
      ),
    );
    const err = await improveSelection('text', 'gsk_key').catch((e) => e);
    expect(err).toBeInstanceOf(ImproveError);
    expect((err as ImproveError).message).toContain('12');
    expect((err as ImproveError).status).toBe(429);
    expect((err as ImproveError).retryAfterSeconds).toBe(12);
  });

  it('throws ImproveError when the response is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), {
          status: 200,
        }),
      ),
    );
    await expect(improveSelection('text', 'gsk_key')).rejects.toBeInstanceOf(ImproveError);
  });

  it('aborts cleanly via the caller signal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        });
      }),
    );
    const ctrl = new AbortController();
    const p = improveSelection('text', 'gsk_key', { signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toBeInstanceOf(ImproveError);
  });
});
