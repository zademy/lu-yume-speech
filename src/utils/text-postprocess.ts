/**
 * Transcription text post-processing — custom-word correction and cleanup.
 *
 * Two stages applied to raw transcription text:
 *
 * 1. `applyCustomWords` — fuzzy-corrects tokens toward a user-supplied
 *    vocabulary (names, jargon, acronyms) that Whisper often misspells. Uses
 *    normalized Levenshtein distance boosted by Soundex phonetic matching,
 *    plus n-gram matching so split artifacts like "Charge B" → "ChargeBee".
 *
 * 2. `filterTranscriptionOutput` — removes language-aware filler words
 *    ("uh", "um", …) and collapses stutter artifacts ("I I I" → "I").
 *
 * `postProcessText` chains both stages for convenience.
 *
 * Ported from the `cjpais/Handy` reference (`audio_toolkit/text.rs`) and kept
 * pure: every function is deterministic and side-effect-free, so the whole
 * pipeline is unit-testable without DOM or network.
 *
 * SRP: this module only transforms transcription text — it does not read
 * settings, touch the DOM, or call the network.
 */

import { levenshtein, soundexMatch } from './string-distance';

/** Default similarity threshold below which a custom-word correction is accepted (0–1). */
export const DEFAULT_WORD_CORRECTION_THRESHOLD = 0.5;

/**
 * Per-transcription post-processing configuration.
 * `customFillerWords`: `null` = use language defaults; `[]` = disable filler
 * filtering; a non-empty array overrides the defaults entirely.
 */
export interface TextPostProcessConfig {
  customWords: string[];
  wordCorrectionThreshold: number;
  customFillerWords: string[] | null;
}

/** Options for `filterTranscriptionOutput`. */
export interface FilterOptions {
  /** App/spoken language code (e.g. "en", "pt-BR"). Selects default filler words. */
  language: string;
  /**
   * `null` uses language defaults; `[]` disables filtering; a non-empty array
   * overrides the defaults. Mirrors Handy's `Option<Vec<String>>` semantics.
   */
  customFillerWords: string[] | null;
}

// ---------------------------------------------------------------------------
// Custom-word correction
// ---------------------------------------------------------------------------

/**
 * Build an n-gram comparison key: strip punctuation from each word, lowercase,
 * and concatenate without spaces. Lets "Charge B" match "ChargeBee".
 */
function buildNGram(words: string[]): string {
  return words
    .map((w) =>
      w
        .trim()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
        .toLowerCase(),
    )
    .join('');
}

/**
 * Find the best matching custom word for a candidate (already lowercased /
 * punctuation-stripped).
 *
 * Score = normalized Levenshtein distance (`dist / max_len`), discounted to
 * 30% of its value when the two words share a Soundex code (phonetic boost).
 * Skips candidates whose length differs from a custom word by more than 25%
 * (min 2 chars) to avoid over-matching n-grams against short words.
 *
 * @returns The best-matching original custom word and its score, or `undefined`.
 */
function findBestMatch(
  candidate: string,
  customWords: ReadonlyArray<{ word: string; normalized: string }>,
  threshold: number,
): { word: string; score: number } | undefined {
  if (candidate.length === 0 || candidate.length > 50) return undefined;

  let bestWord: string | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const { word, normalized: target } of customWords) {
    const lenDiff = Math.abs(candidate.length - target.length);
    const maxLen = Math.max(candidate.length, target.length);
    const maxAllowedDiff = Math.max(maxLen * 0.25, 2);
    if (lenDiff > maxAllowedDiff) continue;

    const dist = levenshtein(candidate, target);
    const score = maxLen > 0 ? dist / maxLen : 1;
    const combined = soundexMatch(candidate, target) ? score * 0.3 : score;

    if (combined < threshold && combined < bestScore) {
      bestWord = word;
      bestScore = combined;
    }
  }

  return bestWord === undefined ? undefined : { word: bestWord, score: bestScore };
}

/**
 * Correct words in `text` toward the closest entry in `customWords`.
 *
 * Greedily tries n-grams of length 3 → 1 at each position (longest first),
 * preserves the original word's capitalization pattern and surrounding
 * punctuation, and leaves unmatched words untouched.
 */
export function applyCustomWords(
  text: string,
  customWords: string[],
  threshold: number = DEFAULT_WORD_CORRECTION_THRESHOLD,
): string {
  if (customWords.length === 0) return text;

  const normalizedCustomWords = customWords.map((word) => ({
    word,
    normalized: word.toLowerCase().replace(/\s+/g, ''),
  }));

  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const result: string[] = [];
  let i = 0;

  while (i < words.length) {
    let matched = false;

    for (let n = Math.min(3, words.length - i); n >= 1; n--) {
      const ngramWords = words.slice(i, i + n);
      const firstWord = ngramWords[0];
      const lastWord = ngramWords[n - 1];
      if (firstWord === undefined || lastWord === undefined) continue;
      const ngram = buildNGram(ngramWords);
      const best = findBestMatch(ngram, normalizedCustomWords, threshold);
      if (best) {
        const prefix = leadingPunctuation(firstWord);
        const suffix = trailingPunctuation(lastWord);
        result.push(prefix + preserveCase(firstWord, best.word) + suffix);
        i += n;
        matched = true;
        break;
      }
    }

    if (!matched) {
      const word = words[i];
      if (word === undefined) break;
      result.push(word);
      i += 1;
    }
  }

  return result.join(' ');
}

/** Apply the capitalization pattern of `original` onto `replacement`. */
function preserveCase(original: string, replacement: string): string {
  if (/^\p{Lu}.*\p{Lu}/u.test(original)) return replacement.toUpperCase();
  if (/^\p{Lu}/u.test(original)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/** Non-alphanumeric prefix of a word (e.g. `"..."` for `"...hello"`). */
function leadingPunctuation(word: string): string {
  const match = word.match(/^[^\p{L}\p{N}]+/u);
  return match ? match[0] : '';
}

/** Non-alphanumeric suffix of a word (e.g. `"?"` for `"hello?"`). */
function trailingPunctuation(word: string): string {
  const match = word.match(/[^\p{L}\p{N}]+$/u);
  return match ? match[0] : '';
}

// ---------------------------------------------------------------------------
// Filler words & stutter collapse
// ---------------------------------------------------------------------------

/**
 * Filler/disfluency words per language.
 *
 * Carefully scoped: words that are real words in some languages are excluded
 * there — e.g. "um" means "a/an" in Portuguese and is NOT a filler in `pt`;
 * "ha" means "has" in Spanish and is NOT a filler in `es`.
 */
export function fillerWordsForLanguage(lang: string): readonly string[] {
  const base = lang.split(/[-_]/)[0];
  switch (base) {
    case 'en':
      return [
        'uh',
        'um',
        'uhm',
        'umm',
        'uhh',
        'uhhh',
        'ah',
        'hmm',
        'hm',
        'mmm',
        'mm',
        'mh',
        'eh',
        'ehh',
        'ha',
      ];
    case 'es':
      return ['ehm', 'mmm', 'hmm', 'hm'];
    case 'pt':
      return ['ahm', 'hmm', 'mmm', 'hm'];
    case 'fr':
      return ['euh', 'hmm', 'hm', 'mmm'];
    case 'de':
      return ['äh', 'ähm', 'hmm', 'hm', 'mmm'];
    case 'it':
      return ['ehm', 'hmm', 'mmm', 'hm'];
    case 'cs':
      return ['ehm', 'hmm', 'mmm', 'hm'];
    case 'pl':
      return ['hmm', 'mmm', 'hm'];
    case 'tr':
      return ['hmm', 'mmm', 'hm'];
    case 'ru':
    case 'uk':
      return ['хм', 'ммм', 'hmm', 'mmm'];
    case 'ar':
    case 'ja':
    case 'ko':
    case 'zh':
      return ['hmm', 'mmm'];
    case 'vi':
      return ['hmm', 'mmm', 'hm'];
    default:
      // Conservative universal fallback — excludes "um", "eh", "ha" because
      // they are real words in several languages.
      return ['uh', 'uhm', 'umm', 'uhh', 'uhhh', 'ah', 'hmm', 'hm', 'mmm', 'mm', 'mh', 'ehh'];
  }
}

/**
 * Collapse 3+ consecutive repetitions of the same alphabetic word to one.
 * Case-insensitive; preserves the first occurrence's casing. Leaves pairs.
 */
function collapseStutters(text: string): string {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return text;

  const result: string[] = [];
  let i = 0;
  while (i < words.length) {
    const word = words[i];
    if (word === undefined) break;
    if (/^\p{L}+$/u.test(word)) {
      let count = 1;
      const normalizedWord = word.toLowerCase();
      while (words[i + count]?.toLowerCase() === normalizedWord) {
        count += 1;
      }
      result.push(word);
      i += count >= 3 ? count : 1;
    } else {
      result.push(word);
      i += 1;
    }
  }
  return result.join(' ');
}

/**
 * Filter raw transcription text: remove filler words and collapse stutters.
 *
 * Filler removal is whole-word, case-insensitive, and trims a trailing comma
 * or period. Whitespace is normalized and the result trimmed.
 */
export function filterTranscriptionOutput(text: string, options: FilterOptions): string {
  const fillers =
    options.customFillerWords === null
      ? fillerWordsForLanguage(options.language)
      : options.customFillerWords;

  let filtered = text;
  for (const filler of fillers) {
    if (!filler) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(filler)}\\b[,.]?`, 'giu');
    filtered = filtered.replace(pattern, '');
  }

  filtered = collapseStutters(filtered);
  filtered = filtered.replace(/\s{2,}/gu, ' ').trim();
  return filtered;
}

/** Escape a string for safe inclusion in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run the full post-processing pipeline on raw transcription text.
 *
 * Order matters: correct custom words first (so filler filtering sees the
 * intended vocabulary), then strip fillers and stutters.
 *
 * @param text       Raw transcription text.
 * @param config     Custom-word list, correction threshold, filler override.
 * @param language   Spoken-language code used to select default filler words.
 */
export function postProcessText(
  text: string,
  config: TextPostProcessConfig,
  language: string,
): string {
  if (!text) return text;
  const corrected =
    config.customWords.length > 0
      ? applyCustomWords(text, config.customWords, config.wordCorrectionThreshold)
      : text;
  return filterTranscriptionOutput(corrected, {
    language,
    customFillerWords: config.customFillerWords,
  });
}
