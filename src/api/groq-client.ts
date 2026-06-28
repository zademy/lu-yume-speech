/**
 * Groq Whisper API client.
 *
 * Handles all HTTP communication with the Groq speech-to-text API.
 * Supports both transcription (same language) and translation (to English).
 *
 * Responsibilities (SRP — one reason to change: Groq API contract):
 * - Build and send multipart form requests
 * - Authenticate with API key
 * - Parse responses into typed objects
 * - Surface HTTP and network errors through the event bus
 *
 * It does NOT know about:
 * - Audio recording (that's Recorder)
 * - UI state (that's the renderer)
 * - Keyboard shortcuts (that's keyboard.ts)
 *
 * DIP: Depends on EventBus abstraction, not on concrete consumers.
 * OCP: New API parameters can be added to TranscriptionOptions without
 *      modifying existing consumers.
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access --
   Task 9 replaces response parsing with Zod schema validation, which will
   eliminate all unsafe-any usage in this file. Suppressing until then. */

import type { EventBus } from '../core/event-bus';
import type { EventMap, TranscriptionOptions, TranscriptionResult } from '../types';

/** Groq API base URL (OpenAI-compatible). */
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

/** Audio endpoints supported by Groq. */
type AudioEndpoint = 'transcriptions' | 'translations';

export class GroqClient {
  private readonly bus: EventBus<EventMap>;
  private apiKey: string;

  constructor(bus: EventBus<EventMap>) {
    this.bus = bus;
    this.apiKey = this.resolveApiKey();
  }

  /**
   * Send audio to Groq for transcription or translation.
   *
   * Emits `transcription:start`, then either `transcription:success`
   * or `transcription:error` through the event bus.
   *
   * @param audioBlob - Recorded audio data
   * @param options   - Transcription parameters
   * @param endpoint  - 'transcriptions' (same language) or 'translations' (→ English)
   */
  async transcribe(
    audioBlob: Blob,
    options: TranscriptionOptions,
    endpoint: AudioEndpoint = 'transcriptions',
  ): Promise<void> {
    if (!this.apiKey) {
      this.bus.emit('status:change', {
        message: 'Configura tu API Key en .env',
        level: 'warning',
      });
      return;
    }

    this.bus.emit('transcription:start', options.model);
    this.bus.emit('status:change', {
      message: `Procesando con ${options.model}...`,
      level: 'processing',
    });

    const formData = this.buildFormData(audioBlob, options);

    try {
      const response = await fetch(`${GROQ_BASE_URL}/audio/${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: formData,
      });

      if (!response.ok) {
        await this.handleHttpError(response);
        return;
      }

      const result = await this.parseResponse(response, options.responseFormat);
      this.bus.emit('transcription:success', result);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.bus.emit('transcription:error', err);
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build the multipart form payload for the API request.
   * Only appends parameters that have values — avoids sending empty strings.
   */
  private buildFormData(blob: Blob, options: TranscriptionOptions): FormData {
    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', options.model);

    if (options.language) form.append('language', options.language);
    if (options.prompt) form.append('prompt', options.prompt);
    if (options.temperature !== undefined) form.append('temperature', String(options.temperature));
    if (options.responseFormat && options.responseFormat !== 'json') {
      form.append('response_format', options.responseFormat);
    }
    if (options.timestampGranularities?.length) {
      for (const g of options.timestampGranularities) {
        form.append('timestamp_granularities[]', g);
      }
    }

    return form;
  }

  /**
   * Parse the raw API response into a TranscriptionResult.
   * Handles both text and JSON response formats.
   */
  private async parseResponse(response: Response, format?: string): Promise<TranscriptionResult> {
    if (format === 'text') {
      const text = await response.text();
      return { text };
    }

    const data = await response.json();

    return {
      text: data.text ?? '',
      language: data.language,
      duration: data.duration,
      segments: data.segments,
      words: data.words,
    };
  }

  /**
   * Convert HTTP error responses into user-friendly error messages.
   */
  private async handleHttpError(response: Response): Promise<void> {
    let message = `Error HTTP ${response.status}`;

    try {
      const data = await response.json();
      message = data.error?.message || message;
    } catch {
      // Response body is not JSON — keep the default message
    }

    if (response.status === 429) {
      message = 'Rate limit alcanzado. Espera un momento e intenta de nuevo.';
    } else if (response.status === 401) {
      message = 'API Key inválida. Verifica tu configuración.';
    }

    this.bus.emit('transcription:error', new Error(message));
  }

  /**
   * Resolve the API key with a three-tier strategy:
   * 1. Vite env variable (VITE_GROQ_API_KEY in .env)
   * 2. Session storage (survives page reloads within the session)
   * 3. Interactive prompt (stored in session for reuse)
   */
  private resolveApiKey(): string {
    const envKey: string | undefined = import.meta.env.VITE_GROQ_API_KEY;
    if (envKey && envKey !== 'TU_API_KEY_AQUI') return envKey;

    const stored = sessionStorage.getItem('groq_api_key');
    if (stored) return stored;

    const key = prompt('Ingresa tu Groq API Key:')?.trim();
    if (key) {
      sessionStorage.setItem('groq_api_key', key);
      return key;
    }

    return '';
  }
}
