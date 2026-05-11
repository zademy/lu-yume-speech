<div align="center">
  <img src="public/favicon.svg" alt="LU YUME logo" width="64" height="64" />
  <h1>LU YUME — Speech to Text</h1>
  <p><strong>Browser-based voice dictation powered by Groq Whisper</strong></p>

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![ESLint](https://img.shields.io/badge/ESLint-10-4B32C3?logo=eslint&logoColor=white)](https://eslint.org/)
[![Prettier](https://img.shields.io/badge/Prettier-3-F7B93E?logo=prettier&logoColor=black)](https://prettier.io/)
[![Groq](https://img.shields.io/badge/Groq_Whisper-API-F55036?logo=groq&logoColor=white)](https://groq.com/)

</div>

---

## What is this?

LU YUME is a single-page web application that turns your microphone input into text in real time. It sends your audio to the [Groq Whisper API](https://console.groq.com/) for transcription or translation, then copies the result to your clipboard automatically.

No backend, no database, no server — just a static site that runs entirely in the browser.

## Features

- **Voice transcription** — record audio and get text back in the original language
- **Translation mode** — translate any spoken language to English
- **Real-time waveform** — live audio visualization while recording
- **Silence detection** — auto-stops after 3 seconds of silence
- **Push-to-talk and toggle modes** — choose your preferred recording style
- **Keyboard shortcut** — `Alt+Space` (macOS) / `Ctrl+Space` (others)
- **Transcription history** — sidebar with up to 100 past entries stored in `localStorage`
- **Dark mode** — light, dark, or system preference
- **Auto-copy** — transcribed text is copied to clipboard automatically
- **Download as `.txt`** — export your transcriptions
- **Configurable** — model selection, language, temperature, response format, context prompt
- **Accessibility** — focus rings, semantic HTML, reduced-motion support

## Tech Stack

| Layer      | Technology                                                    |
| ---------- | ------------------------------------------------------------- |
| Language   | TypeScript 6                                                  |
| Build      | Vite 8                                                        |
| Styling    | Tailwind CSS 4 (via `@tailwindcss/vite` plugin)               |
| Linting    | ESLint 10 + typescript-eslint                                 |
| Formatting | Prettier 3                                                    |
| Pre-commit | Husky 9 + lint-staged                                         |
| API        | [Groq Whisper](https://console.groq.com/) (OpenAI-compatible) |

## Architecture

The application follows a modular, event-driven architecture with strict separation of concerns:

```
src/
├── api/
│   └── groq-client.ts        # Groq API HTTP client
├── audio/
│   ├── audio-analyzer.ts     # Web Audio API RMS + waveform data
│   ├── recorder.ts           # MediaRecorder wrapper
│   ├── recording-timer.ts    # Elapsed time tracker
│   └── waveform-visualizer.ts # Canvas waveform renderer
├── core/
│   └── event-bus.ts          # Typed publish/subscribe event system
├── ui/
│   ├── history-card.ts       # Single history entry component
│   ├── metadata-panel.ts     # Transcription metadata display
│   ├── renderer.ts           # Full DOM layout builder
│   ├── sidebar.ts            # Transcription history panel
│   └── toast.ts              # Toast notification system
├── utils/
│   ├── clipboard.ts          # Clipboard API helper
│   ├── history-repo.ts       # localStorage CRUD for history
│   ├── keyboard.ts           # OS-aware keyboard shortcut manager
│   ├── os-detect.ts          # Platform detection utility
│   ├── settings.ts           # DOM → typed settings reader
│   ├── storage.ts            # localStorage wrapper
│   ├── theme.ts              # Light/dark theme manager
│   └── time-ago.ts           # Relative time formatter
├── main.ts                   # Composition root — wires all modules
├── style.css                 # Design system tokens + Tailwind import
└── types.ts                  # Shared type definitions and constants
```

**Key design principle:** No module imports another module directly. All inter-module communication flows through a typed `EventBus` (Dependency Inversion Principle). `main.ts` is the only file that knows about every module.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [pnpm](https://pnpm.io/) (or npm/yarn)
- A [Groq API key](https://console.groq.com/)

### Install

```bash
git clone <your-repo-url>
cd speech-to-text
pnpm install
```

### Configure

Create a `.env` file in the project root:

```env
VITE_GROQ_API_KEY=your_groq_api_key_here
```

> If no key is configured in `.env`, the app will prompt you for one on first use and store it in `sessionStorage` for the duration of the browser session.

### Run

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build

```bash
pnpm build
```

Runs ESLint, Prettier check, TypeScript compilation, and Vite production build in sequence. Output goes to `dist/`.

### Preview Production Build

```bash
pnpm preview
```

## Available Scripts

| Script              | Description                                         |
| ------------------- | --------------------------------------------------- |
| `pnpm dev`          | Start dev server with HMR                           |
| `pnpm build`        | Lint → format check → type check → production build |
| `pnpm preview`      | Preview the production build locally                |
| `pnpm lint`         | Run ESLint on `src/`                                |
| `pnpm lint:fix`     | Run ESLint with auto-fix                            |
| `pnpm format`       | Format all source files with Prettier               |
| `pnpm format:check` | Check formatting without writing                    |

## Whisper Models

The app supports two Groq Whisper models:

| Model                    | Description                     |
| ------------------------ | ------------------------------- |
| `whisper-large-v3-turbo` | Faster, lower latency (default) |
| `whisper-large-v3`       | Higher accuracy, slower         |

## Supported Languages

Auto-detect, Spanish, English, French, German, Portuguese, Italian, Japanese, Korean, Chinese, Russian, Arabic, Hindi, Dutch, Polish, Swedish, Turkish, Ukrainian.

## Rate Limits (Groq Free Tier)

- 20 requests/min
- 2,000 requests/day
- ~8 hours of audio/day

Check your limits at [console.groq.com/settings/limits](https://console.groq.com/settings/limits).
