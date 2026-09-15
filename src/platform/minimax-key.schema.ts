/**
 * Zod schema for the MiniMax Speech-to-Text API key.
 *
 * Single responsibility: validate the MiniMax credential before storage.
 * MiniMax documents no public key format (unlike Groq's `gsk_…`), so only a
 * conservative non-empty minimum length is enforced — mirroring the worker
 * token policy.
 */
import { z } from 'zod';

export const minimaxKeySchema = z
  .string()
  .min(8, 'La API key de MiniMax debe tener al menos 8 caracteres');

export type MinimaxKey = z.infer<typeof minimaxKeySchema>;
