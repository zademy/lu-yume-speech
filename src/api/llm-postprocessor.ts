/**
 * LLM transcription post-processor — optional polishing pass via Groq chat
 * completions, reusing the same API key as transcription.
 *
 * Raw Whisper output is often unpunctuated and littered with disfluencies. This
 * module asks a Groq chat model to clean it up — punctuation, capitalization,
 * filler/stutter removal, obvious-error correction — while preserving meaning
 * and language. Output is constrained to `{ "transcription": "..." }` via a
 * strict JSON schema so parsing is reliable.
 *
 * Delegates the HTTP envelope (URL, timeout, abort, retry-after, content
 * extraction) to `groq-chat.ts`; this module owns only its domain pieces: the
 * system prompt, the output schema, and the lenient parser.
 *
 * Fail-open by design: on any network error, non-2xx status, or empty result
 * the original text is returned untouched so transcription never depends on the
 * LLM succeeding. The single `catch` makes this policy explicit.
 *
 * SRP: this module only refines transcription text via an LLM — it does not do
 * speech-to-text, manage settings, or touch the DOM.
 */

import { chatCompletion, stripInvisibleChars } from './groq-chat';

/** Options for an LLM post-processing run. */
export interface LlmPostProcessOptions {
  /** Groq chat model id, e.g. `llama-3.3-70b-versatile`. */
  model: string;
  /** Extra user instructions appended to the built-in system prompt. */
  instructions?: string;
  /** Optional abort signal for caller-initiated cancellation. */
  signal?: AbortSignal;
}

/** Built-in system prompt that constrains the model to clean, schema-bound output. */
const BASE_SYSTEM_PROMPT = [
  'You are a transcription post-processor.',
  'Clean up raw speech-to-text output:',
  'add punctuation and correct capitalization;',
  'remove filler words and stutters;',
  'fix obvious spelling and grammar errors;',
  'preserve the original meaning and language exactly — never add or omit information.',
  'Return ONLY a JSON object matching this schema:',
  '{"transcription": string}.',
  'Do not include any prose, markdown, or explanation.',
].join(' ');

/**
 * Build the system prompt, optionally extending the built-in instructions with
 * user-supplied guidance (e.g. "prefer formal tone", domain vocabulary).
 */
export function buildSystemPrompt(instructions?: string): string {
  const extra = instructions?.trim();
  return extra ? `${BASE_SYSTEM_PROMPT}\n\nAdditional instructions: ${extra}` : BASE_SYSTEM_PROMPT;
}

/** JSON schema enforcing `{ "transcription": string }` with no extra fields. */
export const TRANSCRIPTION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { transcription: { type: 'string' } },
  required: ['transcription'],
} as const;

/**
 * Parse the model's chat response: extract `transcription`, strip invisible
 * chars, and fall back to the raw string when JSON is missing or malformed.
 */
export function parseTranscriptionResponse(raw: string): string {
  const text = stripInvisibleChars(raw).trim();
  if (!text) return '';
  try {
    const parsed = JSON.parse(text) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'transcription' in parsed &&
      typeof (parsed as { transcription?: unknown }).transcription === 'string'
    ) {
      return stripInvisibleChars((parsed as { transcription: string }).transcription);
    }
  } catch {
    // Not JSON — fall through and return the raw text.
  }
  return text;
}

/**
 * Run the LLM post-processing pass on `text`.
 *
 * @returns The polished text, or the original `text` unchanged on any failure
 *          (network error, timeout, non-2xx status, empty result).
 */
export async function postProcessWithLlm(
  text: string,
  apiKey: string,
  options: LlmPostProcessOptions,
): Promise<string> {
  if (!text.trim() || !apiKey || !options.model) return text;

  try {
    const content = await chatCompletion({
      apiKey,
      model: options.model,
      systemPrompt: buildSystemPrompt(options.instructions),
      userContent: text,
      schemaName: 'transcription_output',
      schema: TRANSCRIPTION_OUTPUT_SCHEMA,
      signal: options.signal,
    });
    const cleaned = parseTranscriptionResponse(content);
    return cleaned || text;
  } catch {
    return text; // network/abort/parse failure — fail open with the original
  }
}
