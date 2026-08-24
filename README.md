<div align="center">
  <img src="public/favicon.svg" alt="LU YUME logo" width="64" height="64" />

  <h1>LU YUME — Speech-to-Text</h1>

  <p>
    Browser-based speech-to-text: transcribe through <strong>Groq Whisper</strong>
    or fully <strong>on-device</strong> with local Whisper models. Record your
    voice, get instant text — zero backend, fully client-side, cross-platform.
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

## Overview

LU YUME is a **TypeScript SPA** (Vite + Tailwind 4) that captures microphone
audio in the browser and transcribes it through a swappable method/provider
layer — Groq Whisper by default, your own Cloudflare Whisper worker, or
Whisper models running **fully locally** in the browser (Transformers.js +
ONNX Runtime Web). It also offers translation, AI noise suppression, fuzzy
post-correction, optional LLM polish, transcript summaries, a Pluma writing
surface, local metrics, an on-device benchmark, and a cosmetic access gate —
all without a backend.

> Credentials **never** ship in the JS bundle. Each user supplies them at
> runtime and they are stored in their browser's `localStorage`. See
> [SECURITY.md](SECURITY.md) for the full threat model.

For the modular event-driven architecture, the `EventBus` coupling rule, and
the platform-bridge pattern, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Features

- **Real-time transcription & translation** — record audio and send it to Groq Whisper; switch between transcribing (same language) and translating (to English) from the UI.
- **Local, on-device transcription** — download Whisper models from a versioned catalog and run them in the browser (Transformers.js + ONNX Runtime Web, WebGPU with automatic WASM fallback). Audio never leaves the device.
- **Model manager** — downloads with progress, cancellation and verification; atomic updates, deletion, reconciliation after browser eviction, one active model, cross-tab locks, and idle memory release.
- **Access gate** — a client-side access phrase unlocks the app once per load; cosmetic by design (no backend, no user accounts).
- **On-device benchmark** — run the bundled ES/EN corpus to measure WER and RTF per model, and export the results as JSON.
- **Swappable transcription methods & providers** — pick the method (Remote API vs Local in the browser) and, for remote, between the Groq API and your own Cloudflare Whisper worker (adapter pattern); activation is manual from Settings and each credential lives in the browser.
- **Custom vocabulary & fuzzy correction** — define domain terms, names, and acronyms; they're passed to Whisper as a prompt and fuzzy-corrected afterward (Levenshtein + Soundex).
- **Filler / stutter cleanup** — language-aware stripping of filler words and repeated syllables after transcription.
- **Silence trimming** — leading/trailing silence is removed before transcription (fail-open) for lower latency and fewer hallucinations.
- **Noise suppression** — DSP filter chain or AI-backed RNNoise suppression on captured audio.
- **LLM polish (optional)** — a Groq chat pass cleans punctuation, capitalization, and disfluencies via a strict JSON schema.
- **Transcript summaries** — generate same-language summaries from the current text with `openai/gpt-oss-20b`; each exact text snapshot keeps up to 10 local generations.
- **Pluma writer** — a persistent Markdown surface (Milkdown editor) with dictation append and AI selection refine, stored in its own IndexedDB database.
- **History & metrics** — up to 100 recent transcriptions with local word, transcription, and audio-minute metrics, plus an Inicio dashboard.
- **Quality-of-life** — live waveform, silence detection, dark/light theme with system detection, OS-aware keyboard shortcuts, and toast notifications.
- **Network resilience** — 30s timeout, automatic retry with exponential backoff on 429 / 503 / 504, and typed error classification.

---

## Quick Start

### 1. Prerequisites

| Tool                | Version | Notes                                             |
| ------------------- | ------- | ------------------------------------------------- |
| Node.js             | ≥ 20    | LTS recommended                                   |
| pnpm                | ≥ 9     | `npm install -g pnpm` or via [corepack][corepack] |
| Docker _(optional)_ | ≥ 24    | Only for the containerized deployment             |

### 2. Get a Groq API key

1. Open [**console.groq.com/keys**](https://console.groq.com/keys).
2. Sign in and create a new API key. It always starts with `gsk_` and is at
   least 44 characters long.
3. Copy the key — you will paste it into the app on first launch.

> The key is **free tier–eligible** and rate-limited by Groq, not by this app.
> With the remote method the app only talks to `https://api.groq.com`; the
> local method adds explicit Hugging Face model downloads (see
> [SECURITY.md](SECURITY.md)).

### 3. Run the app

Pick **one** of the three paths below.

#### A. Local development (Vite)

```bash
git clone https://github.com/zademy/lu-yume-speech.git
cd lu-yume-speech
pnpm install
pnpm dev
```

The dev server opens at **http://localhost:1420**. On first use, the app asks
you to choose an access phrase, then prompts for the Groq key; microphone
permission is requested the first time you record. Inicio is available without
a key; Dictar requires either a Groq key (remote method) or a downloaded
local model (local method).

#### B. Pre-built image from GHCR (no build required)

```bash
docker pull ghcr.io/zademy/lu-yume-speech:latest
docker run --rm -p 127.0.0.1:8080:8080 ghcr.io/zademy/lu-yume-speech:latest
```

Open **http://localhost:8080**. The image is multi-platform
(`linux/amd64` + `linux/arm64`) and serves only static files through
unprivileged Nginx. No Groq key is baked in — configure it in the browser.

#### C. Build the container locally

```bash
git clone https://github.com/zademy/lu-yume-speech.git
cd lu-yume-speech
docker compose up --build -d
```

Open **http://localhost:8080**. Useful when you want to test local changes
inside the production runtime.

```bash
docker compose ps        # status + health
docker compose logs -f app   # follow logs
docker compose down      # stop and remove
```

---

## Access gate

On first launch the app asks you to choose an **access phrase** (trimmed,
≥ 4 characters). Every subsequent load shows a full-screen gate that must be
unlocked with that phrase before the app is revealed — once per load, with no
inactivity re-lock.

- The phrase is hashed client-side (SHA-256 with a random salt via Web Crypto,
  compared in constant time) and persisted as the `gate` credential in
  `localStorage`, through the same Platform seam as provider credentials.
- Change it from **Ajustes → Access phrase** by confirming the current one.
  There is no "remove gate" affordance — resetting means clearing site data.
- It is **cosmetic by design**: it filters passers-by, not someone who
  inspects the bundle or opens DevTools. See
  [ADR 0003](docs/adr/0003-puerta-acceso-cosmetica-sin-backend.md).

---

## Deployment

### Production build (no Docker)

```bash
pnpm build    # runs ESLint → Prettier check → tsc → vite build
```

Output lands in `dist/` — a static SPA suitable for any static host (Nginx,
Caddy, S3 + CloudFront, Vercel, Netlify, GitHub Pages, etc.). Serve `index.html`
as the SPA fallback and set long-lived `Cache-Control` on `/assets/` (the
filenames are content-hashed). The bundled `nginx.conf` is a ready-to-use
reference: it pins the security headers (`X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Permissions-Policy`), enables gzip, exposes `/healthz`,
and applies immutable caching to hashed assets.

> **Do not deploy this publicly with a Groq key loaded into the bundle.** The
> key is client-side by design; each end user must paste their own.

### Content Security Policy

The bundle ships **no inline scripts** — the theme bootstrap is an external
same-origin script — so a strict CSP works out of the box.
[SECURITY.md](SECURITY.md) carries the full recommended policy. When local
models are in use, `connect-src` must also allow `huggingface.co` plus its
LFS/Xet CDN redirect hosts (`*.aws.cdn.hf.co`, `cdn-lfs*.huggingface.co`),
and `script-src` needs `'wasm-unsafe-eval'` for the same-origin ONNX Runtime
WASM binaries.

### Container image hardening

The provided `compose.yaml` runs the image with:

- `read_only: true` root filesystem
- `cap_drop: ALL` and `security_opt: no-new-privileges:true`
- `tmpfs` mounts for `/tmp` and `/var/cache/nginx`
- Port bound to `127.0.0.1:8080` (loopback only) — change to `0.0.0.0:8080` or
  put behind a reverse proxy if you need remote access
- Built-in `healthcheck` against `http://127.0.0.1:8080/healthz`

### Pre-built image tags

| Git reference | Action                                 | Tag(s) produced               |
| ------------- | -------------------------------------- | ----------------------------- |
| `develop`     | Quality checks only                    | —                             |
| `releases`    | Multi-platform build, no registry push | —                             |
| `main`        | Publish + promote                      | `YYYY.MM.DD.N`, then `latest` |

- `latest` always points to the newest successful build on `main`.
- `YYYY.MM.DD.N` uses the UTC build date plus the GitHub Actions run number
  (e.g. `2026.08.09.42`). Docker tags do not allow `+`, so the run number uses
  a period separator.
- Reruns keep their original date/tag — they never overwrite an existing tag.
- Promotion to `latest` is serialized.
- Release Please also emits a Semantic Versioning tag (`vMAJOR.MINOR.PATCH`)
  for GitHub Releases on `main`. The SemVer tag is **not** published as a
  Docker tag.
- Published images omit SBOM and provenance attestations to avoid untagged
  attestation manifests in GHCR. GHCR may still show internal `sha256:*` child
  manifests for `linux/amd64` and `linux/arm64`; these are content digests
  required by the multi-platform image, not pullable version tags.

---

## API Key (Groq)

| Topic                | Detail                                                 |
| -------------------- | ------------------------------------------------------ |
| Where to get one     | [console.groq.com/keys](https://console.groq.com/keys) |
| Format               | starts with `gsk_`, ≥ 44 characters                    |
| Where it's stored    | `localStorage` under `stt_groq_api_key`                |
| Where it's validated | `src/platform/api-key.schema.ts` (Zod)                 |
| Network egress       | `https://api.groq.com` only                            |
| Bundled in JS?       | **No.** Each user supplies it at runtime.              |

On first launch the app shows a modal prompting for the key. You can also set
or rotate it from **Ajustes → Groq connection**, or programmatically from the
devtools console:

```javascript
await import('./src/platform/web-bridge').then((b) =>
  new b.WebBridge().setCredential('groq', 'gsk_your_key_here'),
);
```

The Groq key also powers the AI-over-text features (LLM polish, summaries,
selection refine) regardless of the active transcription method — with the
local method, locally transcribed text is only sent to Groq after you
explicitly authorize it (off by default).

See [SECURITY.md](SECURITY.md) before touching anything credential-, secret-,
or network-related.

---

## Transcription methods & providers

Transcription runs behind a two-level hierarchy configured in
**Ajustes → Transcription**:

- **Method** — `Remote (API)` or `Local (in the browser)`. Each method keeps
  its own independent preferences; switching methods never silently changes
  them, and the local method never falls back to a remote provider.
- **Provider** _(remote method only)_ — which remote service to talk to.

Both methods speak through the same `TranscriptionProvider` seam
(`src/api/transcription-provider.ts`, adapter pattern). Three clients ship
today — Groq, a Cloudflare Whisper worker, and the local engine — and adding
a fourth means one class plus one entry in the registry in `src/main.ts`; see
[ADR 0002](docs/adr/0002-adapter-proveedores-transcripcion.md). A remote
option without its credential is disabled, and deleting the active
credential auto-switches to the other provider when available.

| Provider             | Credential             | Storage key         | Notes                                             |
| -------------------- | ---------------------- | ------------------- | ------------------------------------------------- |
| Groq API (default)   | Groq API key           | `stt_groq_api_key`  | transcription, translation, all tuning knobs      |
| Cloudflare Whisper   | Worker bearer token    | `stt_worker_token`  | transcription only; fixed model `whisper-large-v3-turbo` |
| Local engine         | — none —               | —                   | on-device Whisper; see [Local transcription](#local-transcription-on-device) |

### Cloudflare Whisper (bring your own worker)

Cloudflare's free tier lets you run Whisper (`@cf/openai/whisper-large-v3-turbo`)
on Workers AI behind your own Worker. Rolling out your own instance gives you
a personal URL + token, and the app never shares quota with anyone else.

1. **Create the worker** — follow the
   [Cloudflare Workers get-started guide](https://developers.cloudflare.com/workers/get-started/guide/)
   and the [Workers AI Whisper model reference](https://developers.cloudflare.com/workers-ai/models/whisper-large-v3-turbo/)
   to expose a `POST /transcribe` endpoint that forwards raw audio to the
   model and returns plain text. The full HTTP contract this app expects
   (auth, `?lang=`, formats, errors, limits) is documented in
   [API.md](API.md).
2. **Set the worker token** — `npx wrangler secret put AUTH_TOKEN`. Pick any
   opaque value (≥ 8 characters); the worker checks it as a Bearer token.
3. **Configure the app** — **Ajustes → Cloudflare Whisper**: paste the token,
   adjust the base URL if your worker lives on a custom domain (must be
   `https:`), then activate the provider in the Transcription card.

> **CORS**: the worker must answer `OPTIONS` preflights with
> `Access-Control-Allow-Origin` (the browser sends one because of the
> `Authorization` header) and include CORS headers on every response,
> including errors. Your app origin (e.g. `http://localhost:1420`) must be
> allowed.

While Cloudflare Whisper is active, translation and the Groq-only knobs
(model, prompt, temperature, response format, timestamps) are disabled in the
UI; the language selector keeps every option and `auto` simply lets the worker
apply its server-side default.

---

## Local transcription (on-device)

The local engine runs Whisper **inside the browser** — a dedicated Worker
loads quantized ONNX weights through Transformers.js and ONNX Runtime Web.
Backend policy is `auto` by default (WebGPU when available, WASM fallback);
you can also force WASM-only from **Ajustes → Local models**. Every local
transcription records its provenance: model id, pinned revision, and the
backend that actually ran.

### Model catalog

The catalog ships inside the app (version 3), is read-only, and pins each
entry to an immutable Hugging Face revision with its exact artifacts and
sizes — nothing about the catalog is fetched remotely, and no download ever
exceeds a 2 GB hard cap. All models transcribe Spanish and English with
language auto-detection and can translate non-English speech to English.

| Model                                  | Size     | Backend          | Memory tier | Notes                          |
| -------------------------------------- | -------- | ---------------- | ----------- | ------------------------------ |
| Whisper Tiny                           | ~99 MB   | WASM             | light       | smallest download              |
| Whisper Base                           | ~145 MB  | WASM             | light       | suggested for modest hardware  |
| Whisper Small                          | ~302 MB  | WASM             | medium      | **recommended** first download |
| Whisper Medium                         | ~684 MB  | WASM             | high        |                                |
| Whisper Large v3 Turbo                 | ~762 MB  | WebGPU required  | high        |                                |
| Whisper Large v3                       | ~1.23 GB | WebGPU required  | very-high   | highest precision              |
| Whisper Large v3 Turbo Lite Fast       | ~564 MB  | WebGPU required  | high        | experimental                   |
| Whisper Large v3 Turbo Lite Accurate   | ~631 MB  | WebGPU required  | high        | experimental                   |
| Whisper Large v3 Lite Fast             | ~1.02 GB | WebGPU required  | very-high   | experimental                   |
| Whisper Large v3 Lite Accurate         | ~1.10 GB | WebGPU required  | very-high   | experimental                   |

Experimental entries (the Lite family) warn before the first download, are
never auto-selected, keep their benchmarks separate, and may be withdrawn
from the catalog without touching already-downloaded weights.

### Downloads, lifecycle, and memory

- **Explicit downloads only** — nothing is fetched until you click Download.
  Progress, cancellation, and verification are built in; a model becomes
  usable only after its artifacts verify.
- **Storage** — artifact bytes land in a dedicated versioned Cache API cache;
  logical state and benchmark measurements live in IndexedDB. The browser may
  evict cached artifacts under space pressure; the engine reconciles records
  on startup and demotes partial or evicted models.
- **Lifecycle** — update atomically to a new pinned revision, delete with one
  click, and keep exactly one **active model** used for the next local
  transcription.
- **Cross-tab safety** — Web Locks (with a `localStorage` heartbeat fallback)
  serialize downloads and inference across tabs.
- **Memory management** — the resident model lives in a dedicated Worker and
  is freed after a configurable idle window (default 30 minutes).

### Privacy

With the local method, audio and text are processed on the device and never
sent to a remote provider. The AI-over-text features (LLM polish, summaries,
selection refine) still use the Groq key — locally transcribed **text** is
only sent if you explicitly authorize it in Ajustes; the authorization is off
by default. See [SECURITY.md](SECURITY.md).

---

## Benchmarks

Each catalog card's precision/speed labels come from a **measured, on-device
benchmark** — not vendor claims. Published results (v1; macOS, Chrome 151,
WebGPU, 16 GB RAM):

| Model                  | Backend | WER ES | WER EN | WER global | RTF  | Cold load |
| ---------------------- | ------- | ------ | ------ | ---------- | ---- | --------- |
| whisper-base           | webgpu  | 4.38 % | 1.47 % | 2.72 %     | 0.059 | 1.4 s   |
| whisper-base           | wasm    | 4.38 % | 1.47 % | 2.72 %     | 0.323 | 1.1 s   |
| whisper-small          | webgpu  | 1.52 % | 1.47 % | 1.49 %     | 0.096 | 3.0 s   |
| whisper-small          | wasm    | 1.52 % | 1.47 % | 1.49 %     | 1.321 | 2.2 s   |
| whisper-large-v3-turbo | webgpu  | 1.52 % | 2.97 % | 2.35 %     | 0.272 | 9.0 s   |

Labels: accuracy `high` ≤ 8 %, `medium` ≤ 20 %, `low` > 20 % global WER;
speed `fast` ≤ 0.5, `balanced` 0.5–1.5, `slow` ≥ 1.5 RTF.

To reproduce: the versioned corpus (7 ES/EN clips, some with noise, WAV PCM
mono 16 kHz) ships in `public/benchmark-corpus/` and regenerates via
`scripts/benchmark/generate-corpus.sh`. Run **Ajustes → Local models → Run
diagnostics** to cold-load the active model, transcribe the corpus, and
compute per-language/global WER, RTF, and heap peak on your own hardware —
results are stored locally and exportable as JSON. Full method, thresholds,
and caveats: [docs/benchmark.md](docs/benchmark.md).

---

## Scripts

| Command              | Description                                                           |
| -------------------- | --------------------------------------------------------------------- |
| `pnpm dev`           | Start the Vite dev server.                                            |
| `pnpm build`         | Lint + format check + typecheck + Vite production build into `dist/`. |
| `pnpm preview`       | Preview the production build locally.                                 |
| `pnpm lint`          | Run ESLint (type-aware rules).                                        |
| `pnpm lint:fix`      | Run ESLint with auto-fix.                                             |
| `pnpm typecheck`     | Run `tsc --noEmit` (strict mode).                                     |
| `pnpm test`          | Run Vitest unit tests once.                                           |
| `pnpm test:watch`    | Run Vitest in watch mode.                                             |
| `pnpm test:coverage` | Run tests with V8 coverage report.                                    |
| `pnpm format`        | Format all files with Prettier.                                       |
| `pnpm format:check`  | Verify formatting without writing.                                    |
| `pnpm audit`         | Check production dependencies for known vulnerabilities.              |

> **No pre-commit hook is committed** (`.husky/pre-commit` is absent), so
> `lint-staged` never runs automatically. Run the gate yourself before
> declaring work done: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.

---

## Keyboard Shortcuts

| Action                 | macOS           | Linux / Windows  |
| ---------------------- | --------------- | ---------------- |
| Start / stop recording | `Cmd` + `R`     | `Ctrl` + `R`     |
| Push-to-talk _(hold)_  | `Cmd` + `Space` | `Ctrl` + `Space` |

Shortcuts adapt to the selected recording mode:

- **Toggle mode** — shortcut starts recording; press again to stop.
- **Push-to-talk mode** — hold the shortcut to record; release to stop.

---

## Testing

The project uses **Vitest** with **jsdom** for DOM APIs and **MSW** for HTTP
mocking. Coverage thresholds: **90%** lines/statements/functions and **80%**
branches.

```bash
pnpm test           # run all unit tests
pnpm test:coverage  # run with V8 coverage report
```

See [CONTRIBUTING.adoc](CONTRIBUTING.adoc) for the test layout, MSW handler
patterns, and the localStorage / IndexedDB polyfill conventions.

---

## Releases

Pushes to `main` use **Release Please** to maintain a release pull request
assembled from [Conventional Commits](https://www.conventionalcommits.org/).
Merging that PR creates the GitHub Release, its `vMAJOR.MINOR.PATCH` tag, and
the generated changelog; the same workflow publishes the calendar-versioned
GHCR image and updates `latest`.

Write commit subjects in this form and use the body for additional context:

```text
feat(summary): add Markdown export

Explain the user-visible behavior, motivation, or migration notes here.
```

- `fix:`, `perf:`, and `revert:` produce a patch version.
- `feat:` produces a minor version.
- Add `!` after the type or a `BREAKING CHANGE:` footer for a major version.
- `docs:`, `refactor:`, `test:`, `build:`, `ci:`, and `chore:` stay hidden
  unless they declare a breaking change.

To override the auto-generated changelog entry for a squash-merged PR, add this
block to its description:

```text
BEGIN_COMMIT_OVERRIDE
feat: describe the release note shown to users
END_COMMIT_OVERRIDE
```

The repository must allow GitHub Actions to create pull requests under
**Settings → Actions → General → Workflow permissions**. Because the workflow
uses the built-in `GITHUB_TOKEN`, GitHub does not start a second CI run for
the bot-created release PR; quality checks still run on `main` before the
release is created.

---

## License

This project is licensed under the **MIT License**. See the [LICENSE](LICENSE)
file for details.

[corepack]: https://nodejs.org/api/corepack.html
