<div align="center">
  <img src="public/favicon.svg" alt="LU YUME logo" width="64" height="64" />

  <h1>LU YUME — Speech-to-Text</h1>

  <p>
    Browser speech-to-text transcription powered by
    <strong>Groq Whisper</strong>. Record your voice, get instant text —
    zero backend, cross-platform.
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white" alt="Vite" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-4.x-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
    <img src="https://img.shields.io/badge/License-MIT-green" alt="License" />
  </p>

  <img src="https://img.shields.io/badge/PRs-welcome-brightgreen" alt="PRs welcome" />
</div>

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [API Key Setup](#api-key-setup)
- [Scripts](#scripts)
- [Testing](#testing)
- [License](#license)

---

## Features

- **Real-time transcription** — Record audio from the microphone and send it to Groq Whisper for instant speech-to-text conversion.
- **Translation mode** — Switch between transcription (same language) and translation (to English) with a single dropdown.
- **Custom vocabulary** — Define domain terms, names, and acronyms; they're fed to Whisper as the initial prompt and fuzzy-corrected afterward.
- **Fuzzy + filler correction** — Post-processing fixes near-matches against your vocabulary (Levenshtein + Soundex) and strips language-aware filler words and stutters.
- **Silence trimming** — Leading/trailing silence is removed before transcription (fail-open) for lower latency and fewer hallucinations.
- **LLM polish (optional)** — An optional Groq chat pass cleans up punctuation, capitalization, and disfluencies via a strict JSON schema.
- **Transcript summaries** — Generate same-language summaries from the current editable text with `openai/gpt-oss-20b`; each exact text snapshot keeps up to 10 local generations.
- **Noise suppression** — DSP filter chain or AI-backed RNNoise suppression on the captured audio.
- **Waveform visualization** — Live audio waveform rendered on a `<canvas>` element during recording.
- **Silence detection** — Automatically stops recording after a configurable silence threshold.
- **Transcription history** — Persistent sidebar with full CRUD: restore past transcriptions, delete individual entries, or clear all history.
- **Metadata panel** — When using `verbose_json` format, displays detected language, confidence, segment timestamps, and duration.
- **Output toolbar** — Copy to clipboard, clear text, or download as `.txt`.
- **Dark / Light theme** — Toggle between themes with system preference detection. Choice persists across sessions.
- **Keyboard shortcuts** — OS-aware shortcuts (Cmd on macOS, Ctrl elsewhere) for record start/stop.
- **Local key storage** — API key stored in the browser's `localStorage`, never in the JS bundle.
- **Network resilience** — 30s timeout, automatic retry with exponential backoff on 429/503/504, typed error classification.
- **Cross-platform** — Runs in any modern browser.

---

## Architecture

LU YUME is a **TypeScript SPA** (Vite + Tailwind 4) that handles all UI and audio logic in the browser.

The SPA follows a **modular event-driven architecture** built around a typed `EventBus`. No module imports another module directly — they communicate exclusively through events, adhering to the **Dependency Inversion Principle**.

A dedicated **platform bridge** (`src/platform/`) abstracts credential and settings storage behind a `Platform` interface, making it testable in isolation.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full diagram, module map, and dependency inversion rule.

---

## Tech Stack

| Layer            | Technology                        | Purpose                                        |
| ---------------- | --------------------------------- | ---------------------------------------------- |
| Language         | TypeScript 6.x                    | Type-safe development (strict mode)            |
| Build tool       | Vite 8.x                          | Fast dev server and optimized production build |
| Styling          | Tailwind CSS 4.x                  | Utility-first CSS with design system tokens    |
| Testing          | Vitest 4.x + MSW 2.x              | Unit tests + HTTP mocking                      |
| Linting          | ESLint 10 + typescript-eslint 8   | Static analysis with type-aware rules          |
| Formatting       | Prettier                          | Consistent code style                          |
| Pre-commit hooks | Husky + lint-staged (configured¹) | Lint/format on staged files — see note below   |
| API              | Groq Whisper API                  | Speech-to-text / translation                   |
| Credential store | localStorage                      | Browser-side API key storage                   |
| Audio            | MediaRecorder + Web Audio         | Microphone capture and real-time analysis      |

> ¹ `lint-staged` is configured in `package.json`, but **no `.husky/pre-commit`
> hook is committed**, so it never runs automatically. Run the gate manually
> before considering work done: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm install -g pnpm` or via [corepack][corepack])
- A **Groq API key** — get one at [console.groq.com](https://console.groq.com)

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/speech-to-text.git
cd speech-to-text

# Install dependencies
pnpm install
```

### Development

```bash
pnpm dev
```

Opens the SPA at `http://localhost:1420`. Microphone permission is requested on
first launch. The `WebBridge` stores the API key in `localStorage`.

### Production Build

```bash
pnpm build
```

Runs lint + typecheck and outputs the optimized SPA to `dist/`. **Do not**
deploy this publicly with a Groq key loaded — the key is stored client-side.

---

## Project Structure

```
speech-to-text/
├── public/
│   ├── favicon.svg                # LU YUME brand icon
│   └── icons.svg                  # Shared SVG sprite
├── src/
│   ├── api/
│   │   ├── groq-client.ts         # Groq Whisper API client (timeout, retry, Zod)
│   │   ├── llm-postprocessor.ts   # Optional LLM polish pass (Groq chat, JSON schema)
│   │   └── summary-client.ts       # Transcript summary client (Groq chat, JSON schema)
│   ├── audio/
│   │   ├── audio-analyzer.ts      # Web Audio API real-time analyzer
│   │   ├── audio-processor.ts     # DSP filter chain + RNNoise suppression
│   │   ├── audio-store.ts         # IndexedDB audio-clip store
│   │   ├── recorder.ts            # MediaRecorder wrapper + guard
│   │   ├── recording-timer.ts     # Elapsed time tracker (with dispose)
│   │   ├── silence-trimmer.ts     # Strips leading/trailing silence (decode→trim→WAV)
│   │   └── waveform-visualizer.ts # Canvas waveform renderer
│   ├── core/
│   │   ├── event-bus.ts           # Typed pub/sub event system
│   │   └── transcription-session.ts # Pipeline lifecycle state machine
│   ├── platform/                  # Credential + settings storage abstraction
│   │   ├── api-key-schema.ts      # Zod validation for gsk_ keys
│   │   ├── platform.ts            # Platform interface + detectPlatform() factory
│   │   └── web-bridge.ts          # Browser impl (localStorage)
│   ├── ui/
│   │   ├── history-card.ts        # Single history entry renderer
│   │   ├── metadata-panel.ts      # Verbose JSON metadata display
│   │   ├── renderer.ts            # Full app DOM layout builder
│   │   ├── sidebar.ts             # Floating history panel
│   │   ├── summary-panel.ts        # Summary generation history renderer
│   │   └── toast.ts               # Non-blocking notification toasts
│   ├── utils/
│   │   ├── clipboard.ts           # Clipboard API wrapper
│   │   ├── history-repo.ts        # CRUD over storage history
│   │   ├── keyboard.ts            # Global shortcut manager
│   │   ├── os-detect.ts           # Platform detection (macOS vs other)
│   │   ├── settings.ts            # Reads UI state into typed config
│   │   ├── storage.ts             # Type-safe storage wrapper (stt_ prefix)
│   │   ├── summary-repo.ts        # Summary histories keyed by exact source text
│   │   ├── string-distance.ts     # Levenshtein + Soundex (fuzzy matching)
│   │   ├── text-postprocess.ts    # Custom-word correction + filler/stutter cleanup
│   │   ├── theme.ts               # Light/dark theme manager
│   │   ├── time-ago.ts            # Relative time formatter (Spanish)
│   │   └── transcription-config.ts # Prompt assembly + post-process config slicing
│   ├── main.ts                    # Composition root / entry point
│   ├── style.css                  # Design system tokens + Tailwind
│   └── types.ts                   # Shared type definitions
├── tests/
│   ├── helpers/
│   │   ├── setup.ts               # jsdom polyfills (localStorage)
│   │   └── msw-handlers.ts        # Default MSW handlers for Groq API
│   └── unit/
│       ├── *.test.ts              # 100+ unit tests
├── index.html                     # SPA shell
├── vite.config.ts                 # Vite config
├── vitest.config.ts               # Vitest config + coverage thresholds
├── eslint.config.js               # ESLint flat config (type-aware)
├── package.json
└── tsconfig.json                  # strict: true
```

---

## Keyboard Shortcuts

| Action          | macOS       | Linux / Windows |
| --------------- | ----------- | --------------- |
| Start recording | `Cmd` + `R` | `Ctrl` + `R`    |
| Stop recording  | `Cmd` + `R` | `Ctrl` + `R`    |

Shortcuts adapt to the selected recording mode:

- **Toggle mode** — Shortcut starts recording; press again to stop.
- **Push-to-talk mode** — Hold `Cmd`/`Ctrl` + `Space` to record; release to stop.

---

## API Key Setup

On first launch the app shows a modal prompting you to paste your Groq API
key. The key is validated (`gsk_` prefix, ≥ 44 characters) and stored in the
browser's `localStorage`. You can also set it from the devtools console:

```javascript
await import('./src/platform/web-bridge').then((b) =>
  new b.WebBridge().setApiKey('gsk_your_key_here'),
);
```

Get a key at [console.groq.com](https://console.groq.com/keys).

---

## Scripts

| Command              | Description                                        |
| -------------------- | -------------------------------------------------- |
| `pnpm dev`           | Start the Vite dev server.                         |
| `pnpm build`         | Lint + typecheck + build the web SPA into `dist/`. |
| `pnpm lint`          | Run ESLint (type-aware rules).                     |
| `pnpm lint:fix`      | Run ESLint with auto-fix.                          |
| `pnpm typecheck`     | Run `tsc --noEmit` (strict mode).                  |
| `pnpm test`          | Run Vitest unit tests once.                        |
| `pnpm test:watch`    | Run Vitest in watch mode.                          |
| `pnpm test:coverage` | Run tests with V8 coverage report.                 |
| `pnpm format`        | Format all files with Prettier.                    |
| `pnpm audit`         | Check for known dependency vulnerabilities.        |

---

## Testing

The project uses **Vitest** with **jsdom** for DOM APIs and **MSW** for HTTP
mocking. Coverage thresholds: 90% lines/statements/functions, 80% branches.

```bash
pnpm test           # run all tests
pnpm test:coverage  # run with coverage report
```

See [CONTRIBUTING.adoc](CONTRIBUTING.adoc) for how to add new tests.

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.

[corepack]: https://nodejs.org/api/corepack.html
