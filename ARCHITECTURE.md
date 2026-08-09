# Architecture

LU YUME is a browser speech-to-text application built as a TypeScript SPA (Vite + TypeScript + Tailwind 4).

## 1. High-level diagram

```
┌─────────────────────────────────────────────────────┐
│                   Browser (SPA)                      │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │           src/platform/ (bridge layer)        │    │
│  │                                               │    │
│  │  detectPlatform() ──── WebBridge              │    │
│  │                                               │    │
│  │  Platform interface:                          │    │
│  │    getApiKey / setApiKey / deleteApiKey       │    │
│  │    hasApiKey                                  │    │
│  │    loadSettings / saveSettings                │    │
│  └──────────────────┬───────────────────────────┘    │
│                     │                                 │
│  ┌──────────────────▼───────────────────────────┐    │
│  │          localStorage (stt_ prefixed keys)    │    │
│  └──────────────────────────────────────────────┘    │
│                                                       │
│  ┌──────────────────────────────────────────────┐    │
│  │              main.ts (composition root)        │    │
│  │  injects platform + apiKey into GroqClient     │    │
│  └──────────────────┬───────────────────────────┘    │
│                     │                                 │
│  ┌──────────────────▼───────────────────────────┐    │
│  │           EventBus (typed pub/sub)             │    │
│  └──┬──────┬──────┬──────┬──────┬──────┬────────┘    │
│     │      │      │      │      │      │              │
│  ┌──▼─┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼────┐        │
│  │audio│ │API │ │ UI │ │util│ │hist│ │theme│         │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └──────┘        │
└─────────────────────────────────────────────────────┘
```

## 2. Module map

| Directory       | Responsibility                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/core/`     | `EventBus` (typed pub/sub) + `TranscriptionSession` (pipeline lifecycle state machine). The backbone; all inter-module communication flows through the bus.                                                                                            |
| `src/audio/`    | `Recorder`, `AudioAnalyzer`, `RecordingTimer`, `WaveformVisualizer`, `AudioProcessor` (DSP + RNNoise), `AudioStore` (IndexedDB clips), `SilenceTrimmer` (decode→trim→WAV, fail-open).                                                                  |
| `src/api/`      | `GroqClient` (Groq Whisper: timeout, retry, Zod, typed errors) + `llm-postprocessor` (optional Groq chat polish) + `summary-client` (manual text summaries). Chat outputs use strict JSON schemas.                                                       |
| `src/platform/` | `Platform` interface + `WebBridge`. **The only layer that touches credential/settings storage.**                                                                                                                                                       |
| `src/ui/`       | `Renderer`, `Sidebar`, `HistoryCard`, `MetadataPanel`, `Toast`. DOM construction.                                                                                                                                                                      |
| `src/utils/`    | `Storage`, `HistoryRepo`, `Settings`, `Keyboard`, `Clipboard`, `Theme`, `OSDetect`, `TimeAgo`, `StringDistance` (Levenshtein + Soundex), `TextPostprocess` (custom-word correction + filler/stutter cleanup), `TranscriptionConfig` (prompt assembly). |
| `src/main.ts`   | Composition root. Wires all modules, owns lifecycle, global error handlers.                                                                                                                                                                            |
| `src/types.ts`  | Shared types + constants (`EventMap`, `TranscriptionResult`, `GroqError`, `GroqApiError`).                                                                                                                                                             |
| `tests/`        | Vitest unit tests. Pure-logic modules tested in isolation; MSW for network mocking.                                                                                                                                                                    |

## 3. The Dependency Inversion rule

**No module under `src/` may touch credential or settings storage directly except through `src/platform/`.**

The rest of the application talks to `Platform` — a plain TypeScript interface defined in `src/platform/platform.ts`:

```typescript
export interface Platform {
  hasApiKey(): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  deleteApiKey(): Promise<void>;
  loadSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;
}
```

`main.ts` calls `detectPlatform()` once at startup. The factory returns the
cached `WebBridge` (localStorage-backed). All consumers receive the `Platform`
interface — they never know which concrete bridge is active.

This means:

- Tests can inject a mock `Platform`.
- Swapping the credential store (e.g., to a remote vault or IndexedDB)
  requires only a new `Platform` implementation — zero changes to business
  logic.

## 4. Network egress

The only network egress is `https://api.groq.com` (Groq Whisper API, and — when
LLM post-processing or transcript summary generation is requested — the Groq
chat completions endpoint under the same origin). If the SPA is deployed behind a web server, a
`Content-Security-Policy` header such as
`default-src 'self'; connect-src 'self' https://api.groq.com` is recommended to
pin this down.

## 5. Transcription pipeline

The composition root drives a single named lifecycle object —
`TranscriptionSession` (`src/core/transcription-session.ts`) — that owns the
`idle → recording → processing → idle` state machine and the one audio buffer
awaiting its result. Replacing the former implicit `lastBlob` closure, it makes
a rapid re-record surface the overwritten buffer (instead of silently dropping
it) and prevents a failed take's audio from leaking into a later success.

Per recording, the pipeline runs, in order:

1. **Capture + suppress** — `Recorder` → `AudioProcessor` (DSP filters / RNNoise).
2. **Trim silence** — `SilenceTrimmer` strips leading/trailing silence before
   transcription (fail-open: returns the original blob if decoding is unavailable
   or the clip is fully silent).
3. **Assemble prompt** — `buildPrompt` merges the user's custom vocabulary into
   the Whisper initial prompt.
4. **Transcribe** — `GroqClient.transcribe` against `api.groq.com`.
5. **Correct text** — `postProcessText` runs fuzzy custom-word correction
   (Levenshtein + Soundex) and language-aware filler/stutter cleanup.
6. **Polish (optional)** — when enabled, `postProcessWithLlm` sends the text to
   the Groq chat model under a strict `{ "transcription": string }` JSON schema;
   any failure falls back to the corrected text.
7. **Persist** — output to the textarea, history entry (`HistoryRepo`) + audio
   clip (`AudioStore`), and clipboard.

Steps 2–6 are each independently toggleable via the quality settings in
`AppSettings`.

## 6. Transcript summary flow

Summary generation is independent from the transcription pipeline and never
resends audio. The composition root snapshots the current editable textarea,
passes only that text and the injected API key to `generateSummary`, then stores
the schema-bound overview and key points in `SummaryRepo`. Histories are keyed
by exact source text; editing the textarea hides the previous history without
deleting it. Each source keeps its 10 newest generations.

## 7. How to add a new Platform capability

1. **TypeScript wrapper** — Add a method to `Platform` in `platform.ts`, then
   implement it in `WebBridge` (via the `stt_`-prefixed storage helpers).

   ```typescript
   // platform.ts
   export interface Platform {
     // ...existing methods...
     myAction(arg: string): Promise<string>;
   }

   // web-bridge.ts
   async myAction(arg: string): Promise<string> {
     // storage-backed implementation
   }
   ```

2. **Test** — Add a unit test for the new `WebBridge` path under
   `tests/unit/web-bridge.test.ts`.
