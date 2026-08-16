/**
 * Zod schema for the Frase de acceso (gate phrase).
 *
 * Single responsibility: validate the user-chosen phrase before it is
 * hashed and stored. Only a conservative minimum length is enforced —
 * the gate is cosmetic by design (ADR 0003), so heavy complexity rules
 * would add friction without adding security.
 */
import { z } from 'zod';

export const gatePhraseSchema = z
  .string()
  .trim()
  .min(4, 'La frase de acceso debe tener al menos 4 caracteres');

export type GatePhrase = z.infer<typeof gatePhraseSchema>;
