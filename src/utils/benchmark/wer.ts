/**
 * Word Error Rate — the benchmark accuracy metric (spec T8).
 *
 * Single responsibility: normalize transcripts and compute WER with the
 * standard Levenshtein alignment over words. Pure module.
 */

/** Normalize a transcript for comparison: lowercase, punctuation out. */
export function normalizeTranscript(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[¡¿"()[\]{},.;:!?…—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);
}

/**
 * Word Error Rate of `hypothesis` against `reference`:
 * (substitutions + deletions + insertions) / reference words.
 * An empty reference makes WER unreachable — returns 1 (worst) by
 * convention so aggregation never divides by zero.
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeTranscript(reference);
  const hyp = normalizeTranscript(hypothesis);
  if (ref.length === 0) return 1;

  // Classic DP over word sequences, flat Int32Array (row-major). `at`
  // asserts the in-bounds read (noUncheckedIndexedAccess).
  const at = (i: number): number => dp[i] ?? 0;
  const width = hyp.length + 1;
  const dp = new Int32Array((ref.length + 1) * width);
  for (let c = 0; c <= hyp.length; c += 1) dp[c] = c;
  for (let r = 1; r <= ref.length; r += 1) {
    dp[r * width] = r;
    for (let c = 1; c <= hyp.length; c += 1) {
      const cost = ref[r - 1] === hyp[c - 1] ? 0 : 1;
      dp[r * width + c] = Math.min(
        at((r - 1) * width + c) + 1, // deletion
        at(r * width + (c - 1)) + 1, // insertion
        at((r - 1) * width + (c - 1)) + cost, // substitution / match
      );
    }
  }
  return at(ref.length * width + hyp.length) / ref.length;
}
