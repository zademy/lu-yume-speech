/**
 * Zod schema for the Cloudflare Whisper worker token.
 *
 * Single responsibility: validate the worker credential before storage.
 * Unlike the Groq key there is no known public format — the token is set
 * with `wrangler secret` — so only a conservative non-empty minimum length
 * is enforced.
 */
import { z } from 'zod';

export const workerTokenSchema = z
  .string()
  .min(8, 'El token del worker debe tener al menos 8 caracteres');

export type WorkerToken = z.infer<typeof workerTokenSchema>;
