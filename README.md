<div align="center">
  <img src="public/favicon.svg" alt="LU YUME logo" width="64" height="64" />

  <h1>LU YUME — Speech-to-Text</h1>

  <p>
    Browser-based speech-to-text transcription powered by
    <strong>Groq Whisper</strong>. Record your voice, get instant text —
    zero backend, fully client-side, cross-platform.
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
audio in the browser and transcribes it through a swappable provider layer —
Groq Whisper by default, or your own Cloudflare Whisper worker. It also
offers translation, AI noise suppression, fuzzy post-correction, optional LLM
polish, transcript summaries, a Pluma writing surface, and local metrics — all
without a backend.

> Credentials **never** ship in the JS bundle. Each user supplies them at
> runtime and they are stored in their browser's `localStorage`. See
> [SECURITY.md](SECURITY.md) for the full threat model.

For the modular event-driven architecture, the `EventBus` coupling rule, and
the platform-bridge pattern, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Features

- **Real-time transcription & translation** — record audio and send it to Groq Whisper; switch between transcribing (same language) and translating (to English) from the UI.
- **Swappable transcription providers** — pick between the Groq API and your own Cloudflare Whisper worker (adapter pattern); activation is manual from Settings and each credential lives in the browser.
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
> Network egress is `https://api.groq.com` only.

### 3. Run the app

Pick **one** of the three paths below.

#### A. Local development (Vite)

```bash
git clone https://github.com/zademy/lu-yume-speech.git
cd lu-yume-speech
pnpm install
pnpm dev
```

The dev server opens at **http://localhost:1420**. On first use, the app
prompts for the Groq key; microphone permission is requested the first time
you record. Inicio is available without a key; Dictar requires one.

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
selection refine) regardless of the active transcription provider.

See [SECURITY.md](SECURITY.md) before touching anything credential-, secret-,
or network-related.

---

## Transcription providers

The app speaks to transcription backends through a shared
`TranscriptionProvider` seam (`src/api/transcription-provider.ts`, adapter
pattern). Two clients ship today — adding a third means one class plus one
entry in the registry in `src/main.ts`; see
[ADR 0002](docs/adr/0002-adapter-proveedores-transcripcion.md). You pick the
active one from **Ajustes → Transcription → Provider**; an option without its
credential is disabled, and deleting the active credential auto-switches to
the other provider when available.

| Provider             | Credential             | Storage key         | Notes                                             |
| -------------------- | ---------------------- | ------------------- | ------------------------------------------------- |
| Groq API (default)   | Groq API key           | `stt_groq_api_key`  | transcription, translation, all tuning knobs      |
| Cloudflare Whisper   | Worker bearer token    | `stt_worker_token`  | transcription only; fixed model `whisper-large-v3-turbo` |

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
