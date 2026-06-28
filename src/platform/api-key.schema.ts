import { z } from 'zod';

export const apiKeySchema = z
  .string()
  .regex(/^gsk_[A-Za-z0-9]{40,}$/u, 'Groq API key debe tener formato gsk_…');

export type ApiKey = z.infer<typeof apiKeySchema>;
