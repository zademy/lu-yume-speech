/**
 * Decodificación de audio del Motor local — Blob → PCM mono 16 kHz.
 *
 * Whisper expects mono 16 kHz Float32 PCM. The main thread decodes the
 * recorded Blob (post silence-trim) with the browser's own resampler via two
 * `OfflineAudioContext` passes: decode at the blob's native rate, then render
 * down to a single channel at 16 kHz. Decoding stays off the worker so the
 * inference thread only ever touches PCM — and so the provider can be unit
 * tested with a fake decoder (jsdom has no Web Audio).
 */

/** Samples per second Whisper requires. */
export const WHISPER_SAMPLE_RATE = 16_000;

/** Decoder port consumed by the provider (production: browser Web Audio). */
export type AudioDecoderPort = (blob: Blob) => Promise<{ audio: Float32Array; duration: number }>;

/**
 * Production decoder: Blob → mono 16 kHz `Float32Array` + duration seconds.
 * Throws whatever `decodeAudioData` throws for undecodable input.
 */
export const decodeAudioTo16kMono: AudioDecoderPort = async (blob: Blob) => {
  // Pass 1: decode the compressed blob into an AudioBuffer (native rate).
  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new OfflineAudioContext(1, 1, 44_100);
  const buffer = await decodeContext.decodeAudioData(arrayBuffer);

  // Pass 2: render the buffer through a 16 kHz mono context so the browser
  // resamples (and mixes N channels down to 1) with its own filter quality.
  const frames = Math.max(1, Math.ceil(buffer.duration * WHISPER_SAMPLE_RATE));
  const renderContext = new OfflineAudioContext(1, frames, WHISPER_SAMPLE_RATE);
  const source = renderContext.createBufferSource();
  source.buffer = buffer;
  source.connect(renderContext.destination);
  source.start();
  const rendered = await renderContext.startRendering();

  // Copy out of the AudioBuffer: the transferring postMessage detaches it.
  return {
    audio: new Float32Array(rendered.getChannelData(0)),
    duration: rendered.duration,
  };
};
