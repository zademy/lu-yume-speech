import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SUMMARY_MODEL,
  SummaryGenerationError,
  generateSummary,
} from '../../src/api/summary-client';

describe('generateSummary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('generates a schema-bound summary from transcribed text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'La reunión definió el lanzamiento.',
                  keyPoints: ['Publicar el martes', 'Validar métricas'],
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateSummary('Texto de la reunión', 'gsk_key')).resolves.toEqual({
      summary: 'La reunión definió el lanzamiento.',
      keyPoints: ['Publicar el martes', 'Validar métricas'],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
      response_format: { type: string; json_schema: { strict: boolean; name: string } };
      temperature: number;
    };
    expect(body.model).toBe(SUMMARY_MODEL);
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'Texto de la reunión' });
    expect(body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true, name: 'transcription_summary' },
    });
    expect(body.temperature).toBe(0);
  });

  it('normalizes whitespace and removes empty key points', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    summary: '  Resumen limpio.  ',
                    keyPoints: [' Punto uno ', '   ', 'Punto dos'],
                  }),
                },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(generateSummary('Texto', 'gsk_key')).resolves.toEqual({
      summary: 'Resumen limpio.',
      keyPoints: ['Punto uno', 'Punto dos'],
    });
  });

  it('reports rate limits with retry-after seconds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '7' },
        }),
      ),
    );

    const error = await generateSummary('Texto', 'gsk_key').catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(SummaryGenerationError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 7 });
  });

  it('reports an HTTP failure outside rate limiting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('error', { status: 500 })));

    await expect(generateSummary('Texto', 'gsk_key')).rejects.toMatchObject({
      message: 'No se pudo generar el resumen (HTTP 500).',
      status: 500,
    });
  });

  it('rejects malformed structured output', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"summary": 3}' } }] }), {
          status: 200,
        }),
      ),
    );

    await expect(generateSummary('Texto', 'gsk_key')).rejects.toThrow(
      'Groq devolvió un resumen inválido.',
    );
  });

  it('rejects non-JSON model content', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }), {
            status: 200,
          }),
        ),
    );

    await expect(generateSummary('Texto', 'gsk_key')).rejects.toThrow(
      'Groq devolvió un resumen inválido.',
    );
  });

  it('reports network and abort failures with actionable messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')));
    await expect(generateSummary('Texto', 'gsk_key')).rejects.toThrow(
      'No se pudo conectar con Groq.',
    );

    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    );
    await expect(generateSummary('Texto', 'gsk_key')).rejects.toThrow(
      'La generación del resumen agotó el tiempo de espera.',
    );
  });

  it('does not request a summary without text or an API key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateSummary('   ', 'gsk_key')).rejects.toThrow('No hay texto para resumir.');
    await expect(generateSummary('Texto', '')).rejects.toThrow('Falta la API key de Groq.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
