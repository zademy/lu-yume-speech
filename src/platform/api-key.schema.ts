/**
 * Zod schema for the Groq API key.
 *
 * Single responsibility: validate the `gsk_…` credential format
 * (`gsk_` prefix + ≥ 40 base62 chars). The `Platform` seam and the
 * settings UI consume this to reject malformed keys before storage.
 */
import { z } from 'zod';

export const apiKeySchema = z
  .string()
  .regex(/^gsk_[A-Za-z0-9]{40,}$/u, 'Groq API key debe tener formato gsk_…');

export type ApiKey = z.infer<typeof apiKeySchema>;
