# AGENTS.md

`speech-to-text` — TypeScript SPA (Vite + Tailwind). Microphone capture, DSP + RNNoise suppression, transcription/translation via the Groq Whisper API. API key lives in browser localStorage; there is no backend.

## Commands

Package manager is **pnpm** (lockfile is `pnpm-lock.yaml`; `npm`/`yarn` break it). Node ≥ 20, pnpm ≥ 9.

| Task | Command |
| --- | --- |
| Dev | `pnpm dev` |
| Typecheck | `pnpm typecheck` |
| Lint | `pnpm lint` (`pnpm lint:fix` to autofix) |
| Format check | `pnpm format:check` (`pnpm format` to write) |
| Unit tests | `pnpm test` (`pnpm test:watch` to watch) |
| Coverage | `pnpm test:coverage` |
| Full gate | `pnpm build` (eslint + prettier --check + tsc + vite build) |

**No pre-commit hook is active** — `.husky/pre-commit` is absent, so `lint-staged` never runs. Run the gate yourself before declaring work done: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.

## Architecture invariants

These are the rules easy to violate silently. All four come from `ARCHITECTURE.md`; restated here because every change touches them.

- **EventBus-only coupling.** Modules never import each other. All inter-module communication flows through the typed `EventBus` (`src/core/event-bus.ts`) — emit and listen, do not reach into another module's internals. `src/main.ts` is the **sole** composition root; only it wires modules together.
- **Platform seam.** `src/platform/` (`Platform` interface + `WebBridge`) is the **only** layer that touches credential/settings storage. A new capability means: add a method to `Platform` and implement it in `WebBridge`. See `ARCHITECTURE.md §5` for the full recipe.
- **Dependency injection for the key.** `GroqClient` receives the API key from `main.ts`, never reads storage itself.
- **Strict, no `any`, JSDoc.** TypeScript strict mode. No `any` — shared types go in `src/types.ts`, local types near the owning module. Every module carries a file-level JSDoc stating its single responsibility; maintain this on edits.

## Credentials

The Groq key is stored in browser `localStorage` under `stt_groq_api_key` via the `WebBridge` — **never** in the JS bundle or env vars shipped to the client. Network egress: `https://api.groq.com`, the configured Cloudflare Whisper worker, and explicit Hugging Face model downloads (see `SECURITY.md`). See `SECURITY.md` before touching anything credential-, secret-, or network-related.

## Tests

Pure modules are tested in isolation under `tests/unit/`. HTTP is mocked with MSW (`tests/helpers/msw-handlers.ts` — see `groq-client.test.ts` for usage). `localStorage`/`sessionStorage` polyfills load automatically via `vitest.config.ts`. When you add a platform method, unit-test the `WebBridge` path. Coverage thresholds enforced in CI: **90%** lines/functions/statements, **80%** branches.

## Commits

Conventional Commits — `feat`, `fix`, `docs`, `refactor`, `test`, `ci`, `chore`, with an optional scope: `feat(audio): ...`, `fix(groq-client): ...`. Imperative mood.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues on this repo, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical triage roles (`bug`/`enhancement` categories; `needs-triage`/`needs-info`/`ready-for-agent`/`ready-for-human`/`wontfix` states) map 1:1 to GitHub labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: glossary in `CONTEXT.md`, decisions in `docs/adr/`. See `docs/agents/domain.md`.

## Reach these docs

| When | Read |
| --- | --- |
| Touching module boundaries, the platform bridge, or adding a Platform capability | `ARCHITECTURE.md` |
| Anything involving the API key, secrets, or network egress | `SECURITY.md` |
| Environment setup, detailed code style, MSW/storage test patterns, commit format | `CONTRIBUTING.adoc` |
| Product features, keyboard shortcuts, user-facing scripts reference | `README.md` |
