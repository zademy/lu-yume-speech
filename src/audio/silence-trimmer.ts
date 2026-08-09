/**
 * Silence trimming — strips leading/trailing silence from a recording before
 * it is sent for transcription.
 *
 * Less audio means lower latency and fewer Whisper hallucinations on quiet
 * tails ("thank you", "bye bye"). Leading/trailing silence is removed while
 * speech in the middle is always preserved.
 *
 * Architecture: the pure DSP primitives (`rms`, `dbToLinear`, `findSpeechBounds`)
 * and the WAV encoder (`encodeWav`) are deterministic and fully unit-testable.
 * Only the thin `trimSilence` wrapper touches the browser's decode API, and it
 * fails open — on any decode error or fully-silent input it returns the
 * original blob untouched so transcription never breaks.
 *
 * SRP: this module only reshapes audio buffers — it knows nothing about the
 * event bus, settings, or transcription API.
 */

/** Options for the silence-trimming wrapper. */
export interface TrimOptions {
  /** Frames quieter than this (dBFS, negative) count as silence. */
  thresholdDb: number;
  /** Silence kept around the first/last speech frame so words aren't clipped. */
  paddingMs: number;
  /** Analysis window length in milliseconds (default 20 ms). */
  frameMs?: number;
}

/** A speech region expressed as half-open sample indices. */
export interface SpeechBounds {
  start: number;
  end: number;
}

/** Convert a dBFS value to linear amplitude (0–1). `-40 dB` ≈ `0.01`. */
export function dbToLinear(db: number): number {
  return Math.pow(10, db / 20);
}

/** Root-mean-square amplitude (0–1) of a slice of float samples. */
export function rms(samples: Float32Array, start: number, length: number): number {
  let sum = 0;
  const end = Math.min(start + length, samples.length);
  for (let i = start; i < end; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  const count = Math.max(end - start, 0);
  return count === 0 ? 0 : Math.sqrt(sum / count);
}

/**
 * Find the half-open `[start, end)` sample range that contains all speech.
 *
 * Scans fixed-size frames from both ends; a frame counts as speech when its
 * RMS exceeds the threshold. Returns `null` when the whole buffer is silent.
 * The result is padded by `paddingMs` (clamped to the buffer) so trimming
 * never clips the onset or tail of a word.
 */
export function findSpeechBounds(
  samples: Float32Array,
  sampleRate: number,
  options: TrimOptions,
): SpeechBounds | null {
  if (samples.length === 0 || sampleRate <= 0) return null;

  const frameMs = options.frameMs ?? 20;
  const frameSize = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const threshold = dbToLinear(options.thresholdDb);
  const padding = Math.round((sampleRate * options.paddingMs) / 1000);

  const frameCount = Math.ceil(samples.length / frameSize);
  let firstSpeech = -1;
  let lastSpeech = -1;
  for (let f = 0; f < frameCount; f++) {
    if (rms(samples, f * frameSize, frameSize) > threshold) {
      if (firstSpeech < 0) firstSpeech = f;
      lastSpeech = f;
    }
  }

  if (firstSpeech < 0) return null; // entirely silent

  const start = Math.max(0, firstSpeech * frameSize - padding);
  const end = Math.min(samples.length, (lastSpeech + 1) * frameSize + padding);
  return { start, end };
}

/**
 * Encode mono float PCM (`-1..1`) as a 16-bit little-endian WAV `ArrayBuffer`.
 *
 * Pure and deterministic: identical input always yields identical bytes, so
 * the header layout and data length are unit-testable without audio hardware.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const byteRate = sampleRate * 2; // 16-bit mono
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(view, 36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeString(view: DataView, offset: number, value: string): void {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

/**
 * Decode a recorded blob, strip leading/trailing silence, and re-encode as WAV.
 *
 * Fails open: if decoding is unavailable, the format is unsupported, or the
 * whole clip is silent, the original blob is returned unchanged so the caller's
 * transcription is never blocked by trimming.
 */
export async function trimSilence(blob: Blob, options: TrimOptions): Promise<Blob> {
  // Treat both constructors as optionally-present so the runtime availability
  // check is reflected in the types (the DOM lib declares them unconditionally).
  const g = globalThis as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  const Ctx = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctx) return blob;

  let ctx: AudioContext | undefined;
  try {
    ctx = new Ctx();
    const arrayBuffer = await blob.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuffer);
    const data = decoded.getChannelData(0);
    const bounds = findSpeechBounds(data, decoded.sampleRate, options);
    if (!bounds) return blob; // entirely silent — let the model say so
    const trimmed = data.subarray(bounds.start, bounds.end);
    const wav = encodeWav(trimmed, decoded.sampleRate);
    return new Blob([wav], { type: 'audio/wav' });
  } catch {
    return blob; // decode unsupported or failed — pass the original through
  } finally {
    void ctx?.close().catch(() => {});
  }
}
