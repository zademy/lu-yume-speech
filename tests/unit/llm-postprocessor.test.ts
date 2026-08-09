import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TRANSCRIPTION_OUTPUT_SCHEMA,
  buildSystemPrompt,
  parseTranscriptionResponse,
  postProcessWithLlm,
  stripInvisibleChars,
} from '../../src/api/llm-postprocessor';

describe('stripInvisibleChars', () => {
  it('leaves normal text untouched', () => {
    expect(stripInvisibleChars('Hello, world!')).toBe('Hello, world!');
  });

  it('removes zero-width spaces and the BOM', () => {
    expect(stripInvisibleChars('a\u200bb\ufeffc')).toBe('abc');
  });

  it('removes soft hyphens and bidi marks', () => {
    expect(stripInvisibleChars('foo\u00adbar\u202e')).toBe('foobar');
  });
});

describe('buildSystemPrompt', () => {
  it('returns the base prompt when no instructions are given', () => {
    const p = buildSystemPrompt();
    expect(p).toContain('transcription post-processor');
    expect(p).toContain('{"transcription": string}');
  });

  it('appends extra user instructions when provided', () => {
    const p = buildSystemPrompt('Prefer a formal tone.');
    expect(p).toContain('Additional instructions: Prefer a formal tone.');
  });

  it('ignores whitespace-only instructions', () => {
    expect(buildSystemPrompt('   ')).toBe(buildSystemPrompt());
  });
});

describe('TRANSCRIPTION_OUTPUT_SCHEMA', () => {
  it('requires exactly one string field named transcription', () => {
    expect(TRANSCRIPTION_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    expect(TRANSCRIPTION_OUTPUT_SCHEMA.required).toEqual(['transcription']);
    expect(TRANSCRIPTION_OUTPUT_SCHEMA.properties.transcription).toEqual({ type: 'string' });
  });
});

describe('parseTranscriptionResponse', () => {
  it('extracts the transcription field from valid JSON', () => {
    expect(parseTranscriptionResponse('{"transcription": "Hello!"}')).toBe('Hello!');
  });

  it('strips invisible characters from the extracted value', () => {
    expect(parseTranscriptionResponse('{"transcription": "Hi\u200b!"}')).toBe('Hi!');
  });

  it('falls back to the raw text when JSON is malformed', () => {
    expect(parseTranscriptionResponse('not json at all')).toBe('not json at all');
  });

  it('falls back when the transcription field is missing', () => {
    expect(parseTranscriptionResponse('{"other": "x"}')).toBe('{"other": "x"}');
  });

  it('returns empty string for empty input', () => {
    expect(parseTranscriptionResponse('')).toBe('');
  });
});

describe('postProcessWithLlm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the original text when the API call succeeds with valid JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: '{"transcription": "Fixed."}' } }] }),
        {
          status: 200,
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await postProcessWithLlm('raw text', 'gsk_key', {
      model: 'llama-3.3-70b-versatile',
    });
    expect(out).toBe('Fixed.');

    const [, init] = fetchMock.mock.calls[0]!;
    const sentBody = JSON.parse((init as RequestInit).body as string) as {
      response_format: { type: string; json_schema: { strict: boolean; name: string } };
      temperature: number;
    };
    expect(sentBody.response_format.type).toBe('json_schema');
    expect(sentBody.response_format.json_schema.strict).toBe(true);
    expect(sentBody.temperature).toBe(0);
  });

  it('fails open (returns the original) on an HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));
    const out = await postProcessWithLlm('raw text', 'gsk_key', { model: 'llama' });
    expect(out).toBe('raw text');
  });

  it('fails open on a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    const out = await postProcessWithLlm('raw text', 'gsk_key', { model: 'llama' });
    expect(out).toBe('raw text');
  });

  it('skips the request entirely for empty text or missing key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await postProcessWithLlm('', 'gsk_key', { model: 'llama' })).toBe('');
    expect(await postProcessWithLlm('text', '', { model: 'llama' })).toBe('text');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
