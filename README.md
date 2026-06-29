<div align="center">
  <img src="public/favicon.svg" alt="LU YUME logo" width="64" height="64" />

  <h1>LU YUME — Speech-to-Text</h1>

  <p>
    Desktop speech-to-text transcription powered by
    <strong>Groq Whisper</strong>. Record your voice, get instant text —
    native keychain security, zero backend, cross-platform.
  </p>

  <p>
    <img src="https://img.shields.io/badge/TypeScript-6.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript" />
    <img src="https://img.shields.io/badge/Vite-8.x-646CFF?logo=vite&logoColor=white" alt="Vite" />
    <img src="https://img.shields.io/badge/Tauri-2.x-FFC131?logo=tauri&logoColor=white" alt="Tauri" />
    <img src="https://img.shields.io/badge/Tailwind_CSS-4.x-06B6D4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS" />
    <img src="https://img.shields.io/badge/Rust-stable-DEA584?logo=rust&logoColor=white" alt="Rust" />
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
- **Waveform visualization** — Live audio waveform rendered on a `<canvas>` element during recording.
- **Silence detection** — Automatically stops recording after a configurable silence threshold.
- **Transcription history** — Persistent sidebar with full CRUD: restore past transcriptions, delete individual entries, or clear all history.
- **Metadata panel** — When using `verbose_json` format, displays detected language, confidence, segment timestamps, and duration.
- **Output toolbar** — Copy to clipboard, clear text, or download as `.txt`.
- **Dark / Light theme** — Toggle between themes with system preference detection. Choice persists across sessions.
- **Keyboard shortcuts** — OS-aware shortcuts (Cmd on macOS, Ctrl elsewhere) for record start/stop.
- **Keychain security** — API key stored in the OS-native credential store (macOS Keychain / Windows Credential Manager). Never in the JS bundle.
- **Network resilience** — 30s timeout, automatic retry with exponential backoff on 429/503/504, typed error classification.
- **Cross-platform** — Desktop installers for Windows (MSI/NSIS) and macOS (DMG).

---

## Architecture

LU YUME is a **Tauri 2** desktop app: a Rust shell providing native keychain and file-system access, wrapping a TypeScript SPA that handles all UI and audio logic.

The SPA follows a **modular event-driven architecture** built around a typed `EventBus`. No module imports another module directly — they communicate exclusively through events, adhering to the **Dependency Inversion Principle**.

A dedicated **platform bridge** (`src/platform/`) is the only layer that talks to Tauri. The rest of the app depends on a `Platform` interface, making it testable in isolation and swappable between desktop and browser.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full diagram, module map, dependency inversion rule, CSP details, and how to add new Tauri commands.

---

## Tech Stack

| Layer             | Technology                          | Purpose                                            |
| ----------------- | ----------------------------------- | -------------------------------------------------- |
| Desktop shell     | Tauri 2.x (Rust)                    | Native webview, keychain, file-system, installers   |
| Language          | TypeScript 6.x                      | Type-safe development (strict mode)                 |
| Build tool        | Vite 8.x                            | Fast dev server and optimized production build      |
| Styling           | Tailwind CSS 4.x                    | Utility-first CSS with design system tokens         |
| Testing           | Vitest 2.x + MSW 2.x                | Unit tests + HTTP mocking                           |
| Linting           | ESLint 10 + typescript-eslint 8     | Static analysis with type-aware rules               |
| Formatting        | Prettier                            | Consistent code style                               |
| Pre-commit hooks  | Husky + lint-staged                 | Run lint/format on staged files before commit       |
| API               | Groq Whisper API                    | Speech-to-text / translation                        |
| Credential store  | OS keychain (keyring crate)         | Secure API key storage                              |
| Audio             | MediaRecorder + Web Audio           | Microphone capture and real-time analysis           |

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9 (`npm install -g pnpm` or via [corepack][corepack])
- **Rust** stable — install via [rustup][rustup]
- **Tauri system dependencies** — see the [Tauri prerequisites guide][tauri-prereq]
  - macOS: Xcode Command Line Tools
  - Windows: Microsoft Visual C++ Build Tools + WebView2
- A **Groq API key** — get one at [console.groq.com](https://console.groq.com)

### Installation

```bash
# Clone the repository
git clone https://github.com/<your-username>/speech-to-text.git
cd speech-to-text

# Install dependencies
pnpm install
```

### Desktop Development (recommended)

```bash
pnpm tauri dev
```

This launches the Tauri development shell with hot module replacement. The
app opens in a native window. Microphone permission is requested on first launch.

### Web-Only Development (fallback)

```bash
pnpm dev
```

Opens the SPA at `http://localhost:5173`. Useful for quick UI iteration without
Rust compilation. In this mode, the `WebBridge` stores the API key in
`localStorage` — this is a **development convenience only**, not a production path.

### Production Build (desktop installers)

```bash
pnpm tauri build
```

Produces native installers:

- Windows: `src-tauri/target/release/bundle/msi/*.msi` and `nsis/*.exe`
- macOS: `src-tauri/target/release/bundle/dmg/*.dmg`

### Web Build (not for distribution with a real key)

```bash
pnpm build
```

Output goes to `dist/`. **Do not** deploy this publicly with a Groq key loaded —
use the Tauri desktop build instead.

---

## Project Structure

```
speech-to-text/
├── public/
│   ├── favicon.svg                # LU YUME brand icon
│   └── icons.svg                  # Shared SVG sprite
├── src/
│   ├── api/
│   │   └── groq-client.ts         # Groq Whisper API client (timeout, retry, Zod)
│   ├── audio/
│   │   ├── audio-analyzer.ts      # Web Audio API real-time analyzer
│   │   ├── recorder.ts            # MediaRecorder wrapper + guard
│   │   ├── recording-timer.ts     # Elapsed time tracker (with dispose)
│   │   └── waveform-visualizer.ts # Canvas waveform renderer
│   ├── core/
│   │   └── event-bus.ts           # Typed pub/sub event system
│   ├── platform/                  # ← The ONLY layer that imports @tauri-apps/api
│   │   ├── api-key-schema.ts      # Zod validation for gsk_ keys
│   │   ├── platform.ts            # Platform interface + detectPlatform() factory
│   │   ├── tauri-bridge.ts        # Desktop impl (keychain via Tauri commands)
│   │   └── web-bridge.ts          # Dev fallback impl (localStorage)
│   ├── ui/
│   │   ├── history-card.ts        # Single history entry renderer
│   │   ├── metadata-panel.ts      # Verbose JSON metadata display
│   │   ├── renderer.ts            # Full app DOM layout builder
│   │   ├── sidebar.ts             # Floating history panel
│   │   └── toast.ts               # Non-blocking notification toasts
│   ├── utils/
│   │   ├── clipboard.ts           # Clipboard API wrapper
│   │   ├── history-repo.ts        # CRUD over storage history
│   │   ├── keyboard.ts            # Global shortcut manager
│   │   ├── os-detect.ts           # Platform detection (macOS vs other)
│   │   ├── settings.ts            # Reads UI state into typed config
│   │   ├── storage.ts             # Type-safe storage wrapper (stt_ prefix)
│   │   ├── theme.ts               # Light/dark theme manager
│   │   └── time-ago.ts            # Relative time formatter (Spanish)
│   ├── main.ts                    # Composition root / entry point
│   ├── style.css                  # Design system tokens + Tailwind
│   └── types.ts                   # Shared type definitions
├── src-tauri/                     # Rust backend
│   ├── src/
│   │   ├── commands/
│   │   │   ├── api_key.rs         # keychain get/set/has/delete
│   │   │   ├── settings.rs        # JSON settings load/save
│   │   │   └── mod.rs
│   │   ├── config.rs              # paths + keyring constants
│   │   ├── error.rs               # AppError enum
│   │   ├── lib.rs                 # Tauri builder + command registration
│   │   └── main.rs                # Entry point
│   ├── capabilities/default.json  # Permission allowlist
│   ├── icons/                     # App icons (all platforms)
│   ├── tauri.conf.json            # App config + CSP
│   └── Cargo.toml
├── tests/
│   ├── helpers/
│   │   ├── setup.ts               # jsdom polyfills (localStorage)
│   │   └── msw-handlers.ts        # Default MSW handlers for Groq API
│   └── unit/
│       ├── *.test.ts              # 100+ unit tests
├── index.html                     # SPA shell
├── vite.config.ts                 # Vite config (Tauri-aware)
├── vitest.config.ts               # Vitest config + coverage thresholds
├── eslint.config.js               # ESLint flat config (type-aware)
├── package.json
└── tsconfig.json                  # strict: true
```

---

## Keyboard Shortcuts

| Action          | macOS           | Linux / Windows  |
| --------------- | --------------- | ---------------- |
| Start recording | `Cmd` + `R`     | `Ctrl` + `R`     |
| Stop recording  | `Cmd` + `R`     | `Ctrl` + `R`     |

Shortcuts adapt to the selected recording mode:

- **Toggle mode** — Shortcut starts recording; press again to stop.
- **Push-to-talk mode** — Hold `Cmd`/`Ctrl` + `Space` to record; release to stop.

---

## API Key Setup

**Desktop app (recommended):** The key is stored in the OS keychain. In Phase 1
(current), set it via the browser devtools console in `pnpm tauri dev`:

```javascript
// In the app's devtools console
await window.__TAURI_INTERNALS__.invoke('api_key_set', { key: 'gsk_your_key_here' });
```

In Phase 2, an in-app settings dialog will handle this with a proper UI.

**Web dev mode:** Run `await import('./src/platform/web-bridge').then(b => new b.WebBridge().setApiKey('gsk_your_key'))` from the console, or the app will show an error toast prompting you to set a key.

Get a key at [console.groq.com](https://console.groq.com/keys).

---

## Scripts

| Command                | Description                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `pnpm dev`             | Start the Vite dev server (web-only fallback).                     |
| `pnpm tauri dev`       | Start the Tauri desktop dev shell with HMR (recommended).          |
| `pnpm build`           | Lint + typecheck + build the web SPA into `dist/`.                 |
| `pnpm tauri build`     | Build native desktop installers (MSI/DMG).                         |
| `pnpm lint`            | Run ESLint (type-aware rules).                                     |
| `pnpm lint:fix`        | Run ESLint with auto-fix.                                          |
| `pnpm typecheck`       | Run `tsc --noEmit` (strict mode).                                  |
| `pnpm test`            | Run Vitest unit tests once.                                        |
| `pnpm test:watch`      | Run Vitest in watch mode.                                          |
| `pnpm test:coverage`   | Run tests with V8 coverage report.                                 |
| `pnpm format`          | Format all files with Prettier.                                    |
| `pnpm audit`           | Check for known dependency vulnerabilities.                        |

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
[rustup]: https://rustup.rs/
[tauri-prereq]: https://tauri.app/start/prerequisites/
