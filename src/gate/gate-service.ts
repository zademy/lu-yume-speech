/**
 * Puerta de acceso — domain service.
 *
 * Single responsibility: own the state machine of the Puerta de acceso
 * (`setup` → `locked` → `open`) and the hashing/verification of the
 * Frase de acceso. The credential is persisted through the Platform seam
 * (`gate`); nothing here touches storage, the DOM or the EventBus —
 * `main.ts` wires those. Verification is client-side and cosmetic by
 * design (ADR 0003): it filters passers-by, it does not stop an
 * attacker who inspects the bundle.
 *
 * Credential format (opaque string, versioned):
 *   `v1.<salt-b64url>.<digest-b64url>` — SHA-256(salt ‖ phrase).
 */
import type { Platform } from '../platform/platform';
import { gatePhraseSchema } from '../platform/gate-phrase.schema';
import type { GateState, GateResult } from '../types';

/** Bytes of random salt generated each time a phrase is established or changed. */
const SALT_BYTES = 16;

/** SHA-256 digest length in bytes. */
const DIGEST_BYTES = 32;

/** Encode bytes as unpadded base64url. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decode unpadded base64url to bytes; returns null on invalid input. */
function fromBase64Url(value: string): Uint8Array | null {
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** Compare two digests in constant time (no early exit on first mismatch). */
function digestsEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== DIGEST_BYTES || b.length !== DIGEST_BYTES) return false;
  let diff = 0;
  for (let i = 0; i < DIGEST_BYTES; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/** Derive SHA-256(salt ‖ phrase) as raw bytes. */
async function digest(salt: Uint8Array, phrase: string): Promise<Uint8Array> {
  const phraseBytes = new TextEncoder().encode(phrase);
  const input = new Uint8Array(salt.length + phraseBytes.length);
  input.set(salt);
  input.set(phraseBytes, salt.length);
  const hash = await crypto.subtle.digest('SHA-256', input);
  return new Uint8Array(hash);
}

/** Parsed `v1` credential. */
interface ParsedCredential {
  salt: Uint8Array;
  expected: Uint8Array;
}

/** Parse the stored credential; null when the value is corrupt. */
function parseCredential(stored: string): ParsedCredential | null {
  const [version, saltPart, digestPart] = stored.split('.');
  if (version !== 'v1' || saltPart === undefined || digestPart === undefined) return null;
  const salt = fromBase64Url(saltPart);
  const expected = fromBase64Url(digestPart);
  if (!salt || !expected || salt.length !== SALT_BYTES || expected.length !== DIGEST_BYTES) {
    return null;
  }
  return { salt, expected };
}

/** Map a failed schema parse to the service error vocabulary. */
function schemaError(phrase: string): 'frase-vacia' | 'frase-corta' {
  return phrase.trim().length === 0 ? 'frase-vacia' : 'frase-corta';
}

/**
 * State machine of the Puerta de acceso over the Platform credential.
 *
 * Fresh instance per application load: `estado()` reads the credential,
 * so a new instance after `establecer` behaves like a page reload
 * (`locked`, never `open` — the Puerta appears once per load).
 */
export class GateService {
  private readonly platform: Platform;

  constructor(platform: Platform) {
    this.platform = platform;
  }

  /** Current state derived from storage: `setup` (no credential) or `locked`. */
  async estado(): Promise<GateState> {
    return (await this.platform.hasCredential('gate')) ? 'locked' : 'setup';
  }

  /** Establish the Frase de acceso on first run; transitions `setup → open`. */
  async establecer(frase: string): Promise<GateResult> {
    if (await this.platform.hasCredential('gate')) {
      return { ok: false, error: 'ya-establecida', state: 'locked' };
    }
    const parsed = gatePhraseSchema.safeParse(frase);
    if (!parsed.success) {
      return { ok: false, error: schemaError(frase), state: 'setup' };
    }
    await this.savePhrase(parsed.data);
    return { ok: true, state: 'open' };
  }

  /** Try to open the Puerta with a phrase; stays `locked` on mismatch. */
  async abrir(frase: string): Promise<GateResult> {
    const guard = await this.guardStorage();
    if (guard) return guard;
    if (frase.trim().length === 0) {
      return { ok: false, error: 'frase-vacia', state: 'locked' };
    }
    const match = await this.verify(frase);
    return match
      ? { ok: true, state: 'open' }
      : { ok: false, error: 'frase-incorrecta', state: 'locked' };
  }

  /** Replace the Frase de acceso after confirming the current one. */
  async cambiar(actual: string, nueva: string): Promise<GateResult> {
    const guard = await this.guardStorage();
    if (guard) return guard;
    const match = await this.verify(actual);
    if (!match) return { ok: false, error: 'frase-incorrecta', state: 'locked' };
    const parsed = gatePhraseSchema.safeParse(nueva);
    if (!parsed.success) {
      return { ok: false, error: schemaError(nueva), state: 'locked' };
    }
    // Fresh salt on every change, even when the phrase itself is identical.
    await this.savePhrase(parsed.data);
    return { ok: true, state: 'locked' };
  }

  /** Common precondition for `abrir`/`cambiar`; non-null when storage blocks them. */
  private async guardStorage(): Promise<GateResult | null> {
    const status = await this.readLockedState();
    if (status === 'no-establecida') {
      return { ok: false, error: 'no-establecida', state: 'setup' };
    }
    if (status === 'credencial-invalida') {
      return { ok: false, error: 'credencial-invalida', state: 'locked' };
    }
    return null;
  }

  /** Read the credential; returns `locked` or the storage problem found. */
  private async readLockedState(): Promise<'locked' | 'no-establecida' | 'credencial-invalida'> {
    const stored = await this.platform.getCredential('gate');
    if (stored === null) return 'no-establecida';
    return parseCredential(stored) ? 'locked' : 'credencial-invalida';
  }

  /** Derive and compare the digest for {@link phrase}. */
  private async verify(phrase: string): Promise<boolean> {
    const stored = await this.platform.getCredential('gate');
    if (stored === null) return false;
    const parsed = parseCredential(stored);
    if (!parsed) return false;
    const actual = await digest(parsed.salt, phrase);
    return digestsEqual(actual, parsed.expected);
  }

  /** Hash {@link phrase} with a fresh salt and persist the credential. */
  private async savePhrase(phrase: string): Promise<void> {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const expected = await digest(salt, phrase);
    await this.platform.setCredential('gate', `v1.${toBase64Url(salt)}.${toBase64Url(expected)}`);
  }
}
