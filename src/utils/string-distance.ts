/**
 * String-distance and phonetic-similarity primitives.
 *
 * Pure, dependency-free scoring helpers used by text post-processing to
 * measure how close a transcribed token is to a known custom word. Kept
 * deterministic and side-effect-free so scoring stays trivially testable.
 *
 * SRP: this module only computes distances and phonetic codes — it knows
 * nothing about transcription, custom-word lists, or the UI.
 */

/**
 * Levenshtein edit distance between two strings.
 *
 * Minimum number of single-character insertions, deletions, or substitutions
 * needed to turn `a` into `b`. Iterative two-row DP — O(n·m) time, O(m) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** Maps a lowercased ASCII letter to its Soundex digit (or separator/transparent marker). */
function soundexDigit(ch: string): string {
  switch (ch) {
    case 'b':
    case 'f':
    case 'p':
    case 'v':
      return '1';
    case 'c':
    case 'g':
    case 'j':
    case 'k':
    case 'q':
    case 's':
    case 'x':
    case 'z':
      return '2';
    case 'd':
    case 't':
      return '3';
    case 'l':
      return '4';
    case 'm':
    case 'n':
      return '5';
    case 'r':
      return '6';
    case 'a':
    case 'e':
    case 'i':
    case 'o':
    case 'u':
      return '.'; // vowel — acts as a separator (resets adjacent-digit collapse)
    default:
      return ''; // h, w, y and non-letters are transparent
  }
}

/**
 * American Soundex code (4 characters) for a word.
 *
 * Rules: keep the first letter; map consonants to digits; collapse adjacent
 * identical digits; digits separated by a vowel count twice, by h/w count once.
 * Pads with zeros and truncates to length 4. Returns `'0000'` for empty input.
 */
export function soundex(input: string): string {
  const word = input.toLowerCase();
  let i = 0;
  while (i < word.length && !/[a-z]/.test(word[i]!)) i++;
  if (i >= word.length) return '0000';

  const first = word[i]!.toUpperCase();
  let prevDigit = soundexDigit(word[i]!);
  let code = '';

  for (let k = i + 1; k < word.length && code.length < 3; k++) {
    const ch = word[k]!;
    if (!/[a-z]/.test(ch)) continue;
    const digit = soundexDigit(ch);
    if (digit >= '1' && digit <= '6') {
      if (digit !== prevDigit) code += digit;
      prevDigit = digit;
    } else if (digit === '.') {
      // Vowel separator — allow the next same-digit consonant to count again.
      prevDigit = '';
    }
    // h, w, y leave prevDigit unchanged (collapse rule).
  }

  return (first + code + '000').slice(0, 4);
}

/** True when two words share the same Soundex code (roughly: sound alike). */
export function soundexMatch(a: string, b: string): boolean {
  return soundex(a) === soundex(b);
}
