# Tauri Phase 1 — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert LU YUME from a browser-only SPA into a shippable cross-platform desktop app (Windows + macOS) via Tauri, while resolving the three critical audit findings: API key exposure, missing TypeScript strictness, and absent network resilience — plus a baseline test suite, documented bug fixes, and unified pnpm tooling.

**Architecture:** The existing Vite + TS + Tailwind 4 SPA is kept intact and loaded by a Tauri shell. A new isolated `src/platform/` module is the ONLY layer that talks to the Rust backend (keychain, settings file). All existing modules continue to communicate through the typed `EventBus`. The `GroqClient` stops reading `import.meta.env` / `prompt()` / `sessionStorage` and receives the API key via dependency injection from the platform bridge.

**Tech Stack:** TypeScript (strict), Vite 8, Tailwind 4, Vitest + jsdom + msw + @testing-library/dom, Zod, ESLint (type-aware), Prettier, pnpm 9, Husky. Rust (stable) + Tauri 2 + keyring + serde + dirs + thiserror.

## Global Constraints

Copied verbatim from the approved spec (`docs/superpowers/specs/2026-06-28-tauri-migration-design.md`):

- **pnpm only** — the repo ships `pnpm-lock.yaml`; npm scripts in README/CI must be replaced.
- **`tsconfig.json` must set `"strict": true`, `"noUncheckedIndexedAccess": true`, and `"lib": ["ES2023","DOM","DOM.Iterable"]`.**
- **API key never reaches the JS bundle** — after build, `grep -rn 'VITE_GROQ' dist/` MUST return empty.
- **No `prompt()` or `confirm()` in shipped code paths** within Fase 1 scope, the onboarding/settings modal replacements land in Fase 2; for Fase 1 the bridge supplies the key and a console-error + toast is shown if missing.
- **Allowlist in `tauri.conf.json`**: only `fs` (scoped to app config dir), `dialog` (save/open), `http` (allowlist `api.groq.com`). No `shell`, no `process`, no `path` arbitrary.
- **Key rotation**: before merging the final task, revoke `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` at https://console.groq.com/keys (it lives in plaintext in the local `.env`).
- **Commit style**: Conventional Commits in English, matching existing history (`feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`).
- **Frequent commits**: every task ends with a commit; TDD red→green→refactor→commit.

---

## File Structure

New / modified files in Phase 1:

```
speech-to-text/
├── .env                                    ← DELETE (Task 13)
├── .github/workflows/ci.yml                ← REWRITE (Task 14)
├── README.md                               ← UPDATE (Task 13)
├── SECURITY.md                             ← REWRITE (Task 13)
├── ARCHITECTURE.md                         ← NEW (Task 13)
├── CONTRIBUTING.adoc                       ← UPDATE (Task 13)
├── docs/superpowers/plans/                 ← (this file lives here)
├── index.html                              ← MODIFY theme script (Task 7)
├── package.json                            ← MODIFY scripts/deps (Tasks 1, 11)
├── pnpm-lock.yaml                          ← regenerates on install
├── tsconfig.json                           ← MODIFY strict (Task 1)
├── vite.config.ts                          ← MODIFY for Tauri (Task 11)
├── vitest.config.ts                        ← NEW (Task 1)
├── eslint.config.js                        ← MODIFY type-aware (Task 1)
├── src/
│   ├── api/groq-client.ts                  ← REFACTOR resilience (Task 9) + inject key (Task 12)
│   ├── audio/recorder.ts                   ← MODIFY guard (Task 8)
│   ├── audio/recording-timer.ts            ← MODIFY add dispose() (Task 8)
│   ├── core/event-bus.ts                   ← (unchanged; tests in Task 3)
│   ├── main.ts                             ← MODIFY wire bridge + cleanup + error handler (Task 12)
│   ├── platform/                           ← NEW directory (Task 11/12)
│   │   ├── platform.ts                     ← interface + factory (Task 12)
│   │   ├── tauri-bridge.ts                 ← Tauri invoke wrappers (Task 12)
│   │   ├── web-bridge.ts                   ← localStorage fallback (Task 12)
│   │   └── api-key.schema.ts               ← Zod (Task 12)
│   ├── types.ts                            ← MODIFY add GroqError union (Task 9)
│   ├── ui/renderer.ts                      ← (unchanged in Phase 1)
│   ├── utils/storage.ts                    ← MODIFY error classification (Task 6)
│   └── utils/theme.ts                      ← MODIFY prefix constant (Task 7)
├── src-tauri/                              ← NEW (Task 11)
│   ├── .gitignore
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── capabilities/default.json
│   ├── icons/                              ← placeholder icons
│   └── src/
│       ├── main.rs
│       ├── error.rs
│       ├── config.rs
│       └── commands/
│           ├── mod.rs
│           ├── api_key.rs
│           └── settings.rs
└── tests/                                  ← NEW test root (Task 1+)
    ├── unit/
    │   ├── event-bus.test.ts
    │   ├── storage.test.ts
    │   ├── history-repo.test.ts
    │   ├── settings.test.ts
    │   ├── time-ago.test.ts
    │   ├── os-detect.test.ts
    │   └── groq-client.test.ts
    └── helpers/
        ├── setup.ts                        ← jsdom setup
        └── msw-handlers.ts                 ← shared msw handlers
```

Responsibilities:
- `src/platform/*` — sole IPC surface with the OS. `platform.ts` exposes a `Platform` interface and a `detectPlatform()` factory returning a `TauriBridge` or `WebBridge`. Other modules never import `@tauri-apps/api` directly.
- `src-tauri/src/commands/api_key.rs` — keychain CRUD via `keyring` crate.
- `src/api/groq-client.ts` — HTTP only; no env/storage/prompt access. Receives `{ apiKey, signal }` per call.
- `tests/` — co-located by type (`unit/`). Integration tests land in Phase 2.

---

## Task 1: Tooling foundation (pnpm, Vitest, strict tsconfig, type-aware ESLint)

**Files:**
- Create: `vitest.config.ts`, `tests/helpers/setup.ts`
- Modify: `tsconfig.json`, `eslint.config.js`, `package.json`
- Test: `tests/unit/sanity.test.ts` (smoke check)

**Interfaces:**
- Produces: `pnpm test`, `pnpm typecheck`, `pnpm test:coverage`, `pnpm lint` (with type-aware rules)

- [ ] **Step 1: Pin Node/pnpm engines and add scripts in `package.json`**

Add to `package.json` (merge into existing keys; keep `devDependencies` as-is for now):

```json
{
  "scripts": {
    "dev": "vite",
    "build": "eslint src && prettier --check \"src/**/*.ts\" \"*.html\" \"*.json\" \"src/**/*.css\" && tsc && vite build",
    "preview": "vite preview",
    "format": "prettier --write \"src/**/*.ts\" \"*.html\" \"*.json\" \"src/**/*.css\"",
    "format:check": "prettier --check \"src/**/*.ts\" \"*.html\" \"*.json\" \"src/**/*.css\"",
    "prepare": "husky",
    "lint": "eslint src",
    "lint:fix": "eslint src --fix",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "audit": "pnpm audit --prod"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@tailwindcss/vite": "^4.3.0",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@types/node": "^22.10.0",
    "@typescript-eslint/eslint-plugin": "^8.59.2",
    "@typescript-eslint/parser": "^8.59.2",
    "@vitest/coverage-v8": "^2.1.8",
    "eslint": "^10.3.0",
    "globals": "^17.6.0",
    "husky": "^9.1.7",
    "jsdom": "^25.0.1",
    "lint-staged": "^17.0.4",
    "msw": "^2.7.0",
    "prettier": "3.8.3",
    "tailwindcss": "^4.3.0",
    "typescript": "~6.0.2",
    "typescript-eslint": "^8.59.2",
    "vite": "^8.0.10",
    "vitest": "^2.1.8",
    "zod": "^3.24.1"
  },
  "engines": {
    "node": ">=20",
    "pnpm": ">=9"
  },
  "packageManager": "pnpm@9.15.0"
}
```

- [ ] **Step 2: Rewrite `tsconfig.json` with strict mode**

```jsonc
{
  "compilerOptions": {
    "target": "es2023",
    "module": "esnext",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["vite/client", "node"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,

    "noEmit": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Rewrite `eslint.config.js` to be type-aware**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri', 'node_modules', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }]
    }
  }
);
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/helpers/setup.ts'],
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/types.ts', 'src/**/*.d.ts'],
      thresholds: { lines: 90, functions: 90, statements: 90, branches: 80 }
    }
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }
});
```

- [ ] **Step 5: Create `tests/helpers/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/dom';

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
```

- [ ] **Step 6: Write smoke test `tests/unit/sanity.test.ts`**

```ts
import { describe, it, expect } from 'vitest';

describe('vitest setup', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });

  it('has jsdom DOM', () => {
    expect(window.document).toBeDefined();
  });

  it('has localStorage', () => {
    localStorage.setItem('x', '1');
    expect(localStorage.getItem('x')).toBe('1');
  });
});
```

- [ ] **Step 7: Install and verify**

Run:
```bash
pnpm install
pnpm typecheck
pnpm test
```
Expected: `pnpm typecheck` may report new errors from strict mode (capture them; they are fixed across Tasks 3–9). `pnpm test` runs 3 passing tests. If `typecheck` has errors, list them but DO NOT silence — they will be resolved in subsequent tasks. Commit anyway (the tooling is correct; the code fixes follow).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json eslint.config.js vitest.config.ts tests/
git commit -m "chore: add Vitest, strict tsconfig, type-aware ESLint, pnpm scripts"
```

---

## Task 2: Fix all `as any` / strict-mode violations (no behavior change)

**Files:**
- Modify: `src/audio/audio-analyzer.ts`, `src/audio/waveform-visualizer.ts`, `src/types.ts`, and any file flagged by `pnpm typecheck`
- Test: `pnpm typecheck` is the test

**Interfaces:**
- Consumes: strict tsconfig from Task 1
- Produces: `pnpm typecheck` exits 0

- [ ] **Step 1: Capture the current strict-mode errors**

Run: `pnpm typecheck 2>&1 | tee /tmp/strict-baseline.txt`
Read the output. Typical issues expected (from the audit):
- `src/audio/audio-analyzer.ts`: `Uint8Array<ArrayBuffer>` cast `as any` — TS 6.0 generic instantiation.
- `src/audio/waveform-visualizer.ts`: same `Uint8Array` pattern.
- `src/api/groq-client.ts`: `import.meta.env.VITE_GROQ_API_KEY as string | undefined` (will be removed in Task 12 but must compile now).
- Possible `noUncheckedIndexedAccess` complaints on `arr[i]` patterns.

- [ ] **Step 2: Fix the `Uint8Array<ArrayBuffer>` pattern**

In `src/audio/audio-analyzer.ts` and `src/audio/waveform-visualizer.ts`, replace the `as any` casts with a typed helper. Add to `src/types.ts`:

```ts
/**
 * Typed alias for the analyser byte data shape used by Web Audio.
 * TS 6.0 tracks the generic parameter; this alias keeps call sites clean.
 */
export type AnalyserByteData = Uint8Array<ArrayBuffer>;
```

At each call site that previously did `new Uint8Array(...) as any`, change to:

```ts
const data: AnalyserByteData = new Uint8Array(analyser.frequencyBinCount);
```

If TS still complains about the constructor instantiation, use:

```ts
const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount)) as AnalyserByteData;
```

- [ ] **Step 3: Fix `noUncheckedIndexedAccess` fallout**

For each `arr[i]` access flagged, add an explicit undefined guard:

```ts
const item = arr[i];
if (item === undefined) continue; // or throw, depending on semantics
```

Do NOT use `!` non-null assertions — they defeat the purpose of the check.

- [ ] **Step 4: Fix the `import.meta.env` cast temporarily**

In `src/api/groq-client.ts`, change:
```ts
const envKey = import.meta.env.VITE_GROQ_API_KEY as string | undefined;
```
to:
```ts
const envKey: string | undefined = import.meta.env.VITE_GROQ_API_KEY;
```
(Keeps it compiling; the whole line is removed in Task 12.)

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint`
Expected: both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "refactor: satisfy strict tsconfig (typed Uint8Array, no unchecked access)"
```

---

## Task 3: Characterization tests for `EventBus`

**Files:**
- Test: `tests/unit/event-bus.test.ts`
- Read-only: `src/core/event-bus.ts`

**Interfaces:**
- Produces: confidence to refactor near `EventBus` later (it stays unchanged in Phase 1, but tests lock its contract).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../src/core/event-bus';

type TestEvents = {
  'ping': { value: number };
  'void-event': void;
};

describe('EventBus', () => {
  it('delivers emitted payload to subscribers', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    bus.on('ping', spy);
    bus.emit('ping', { value: 42 });
    expect(spy).toHaveBeenCalledWith({ value: 42 });
  });

  it('supports void events', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    bus.on('void-event', spy);
    bus.emit('void-event', undefined);
    expect(spy).toHaveBeenCalledWith(undefined);
  });

  it('unsubscribe function removes the listener', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    const unsub = bus.on('ping', spy);
    unsub();
    bus.emit('ping', { value: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('listeners fire in subscription order', () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];
    bus.on('ping', () => order.push('first'));
    bus.on('ping', () => order.push('second'));
    bus.emit('ping', { value: 0 });
    expect(order).toEqual(['first', 'second']);
  });

  it('a throwing listener does not break siblings', () => {
    const bus = new EventBus<TestEvents>();
    const ok = vi.fn();
    bus.on('ping', () => { throw new Error('boom'); });
    bus.on('ping', ok);
    bus.emit('ping', { value: 0 });
    expect(ok).toHaveBeenCalled();
  });

  it('clear(event?) removes listeners', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();
    bus.on('ping', spy);
    bus.clear('ping');
    bus.emit('ping', { value: 0 });
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm test tests/unit/event-bus.test.ts`
Expected: 6 passing. If any fail, the audit was wrong about the contract — inspect `src/core/event-bus.ts` and adjust the tests to match actual behavior (these are characterization tests, not new behavior).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/event-bus.test.ts
git commit -m "test: characterize EventBus contract (emit/on/off/clear/ordering)"
```

---

## Task 4: Tests for `storage.ts` and `history-repo.ts`

**Files:**
- Test: `tests/unit/storage.test.ts`, `tests/unit/history-repo.test.ts`
- Read-only: `src/utils/storage.ts`, `src/utils/history-repo.ts`

**Interfaces:**
- Produces: locked prefix `stt_`, FIFO eviction, schema expectations (drives Task 6).

- [ ] **Step 1: `storage.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { load, save, remove } from '../../src/utils/storage';

describe('storage wrapper', () => {
  beforeEach(() => localStorage.clear());

  it('save then load round-trips JSON', () => {
    save('key', { a: 1 });
    expect(load<{ a: number }>('key')).toEqual({ a: 1 });
    expect(localStorage.getItem('stt_key')).toBe('{"a":1}');
  });

  it('load returns null for missing key', () => {
    expect(load('missing')).toBeNull();
  });

  it('remove deletes the underlying key', () => {
    save('key', 1);
    remove('key');
    expect(localStorage.getItem('stt_key')).toBeNull();
  });

  it('load returns null on corrupt JSON (no throw)', () => {
    localStorage.setItem('stt_bad', '{not json');
    expect(load('bad')).toBeNull();
  });

  it('save swallows quota errors gracefully (does not throw)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(() => save('k', 'v')).not.toThrow();
    spy.mockRestore();
  });
});
```

Import `vi` at the top: `import { describe, it, expect, beforeEach, vi } from 'vitest';`.

- [ ] **Step 2: `history-repo.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { addEntry, getEntries, removeEntry, clearHistory } from '../../src/utils/history-repo';
import type { HistoryEntry } from '../../src/types';

const entry = (i: number): HistoryEntry => ({
  id: `id-${i}`,
  text: `text-${i}`,
  timestamp: 1700000000000 + i,
  language: 'es',
  model: 'whisper-large-v3-turbo'
}) as HistoryEntry;

describe('history-repo', () => {
  beforeEach(() => localStorage.clear());

  it('addEntry prepends (newest first)', () => {
    addEntry(entry(1));
    addEntry(entry(2));
    expect(getEntries()[0]?.id).toBe('id-2');
  });

  it('FIFO evicts oldest beyond HISTORY_MAX_ENTRIES', () => {
    for (let i = 0; i < 105; i++) addEntry(entry(i));
    expect(getEntries()).toHaveLength(100);
    // newest 100 survive (i=5..104), i=0..4 evicted
    expect(getEntries().some(e => e.id === 'id-0')).toBe(false);
    expect(getEntries().some(e => e.id === 'id-104')).toBe(true);
  });

  it('removeEntry deletes by id', () => {
    addEntry(entry(1));
    removeEntry('id-1');
    expect(getEntries()).toHaveLength(0);
  });

  it('clearHistory empties the list', () => {
    addEntry(entry(1));
    addEntry(entry(2));
    clearHistory();
    expect(getEntries()).toHaveLength(0);
  });

  it('survives corrupt stored data (returns empty)', () => {
    localStorage.setItem('stt_history_entries', 'corrupt{');
    expect(getEntries()).toEqual([]);
  });
});
```

If `history-repo.ts` export names differ, inspect the source and adjust imports to match.

- [ ] **Step 3: Run and commit**

Run: `pnpm test tests/unit/storage.test.ts tests/unit/history-repo.test.ts`
Expected: all pass. If `HISTORY_MAX_ENTRIES` differs from 100, update the test number.

```bash
git add tests/unit/storage.test.ts tests/unit/history-repo.test.ts
git commit -m "test: characterize storage wrapper and history-repo CRUD/eviction"
```

---

## Task 5: Tests for `settings.ts`, `time-ago.ts`, `os-detect.ts`

**Files:**
- Test: `tests/unit/settings.test.ts`, `tests/unit/time-ago.test.ts`, `tests/unit/os-detect.test.ts`
- Read-only: `src/utils/settings.ts`, `src/utils/time-ago.ts`, `src/utils/os-detect.ts`

- [ ] **Step 1: `settings.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildTranscriptionOptions } from '../../src/utils/settings';

describe('settings', () => {
  it('clamps temperature to [0, 1]', () => {
    // Call with explicit values mirroring how main.ts builds options.
    // If the function signature differs, adjust — the assertion is the contract.
    const cold = buildTranscriptionOptions({ temperature: -5, model: 'whisper-large-v3-turbo', language: 'es', responseFormat: 'json', translate: false, verbose: false });
    const hot = buildTranscriptionOptions({ temperature: 99, model: 'whisper-large-v3-turbo', language: 'es', responseFormat: 'json', translate: false, verbose: false });
    expect(cold.temperature).toBe(0);
    expect(hot.temperature).toBe(1);
  });

  it('returns a frozen object', () => {
    const opts = buildTranscriptionOptions({ temperature: 0.5, model: 'whisper-large-v3-turbo', language: 'es', responseFormat: 'json', translate: false, verbose: false });
    expect(Object.isFrozen(opts)).toBe(true);
  });
});
```

If `buildTranscriptionOptions` reads directly from the DOM instead of taking an argument, rewrite the test to construct a DOM fixture with `document.body.innerHTML = '<select id="model">...</select>'` before calling, and assert on the parsed output. Inspect `src/utils/settings.ts` first to pick the right shape.

- [ ] **Step 2: `time-ago.test.ts`**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatTimeAgo } from '../../src/utils/time-ago';

const NOW = 1_700_000_000_000; // fixed reference

afterEach(() => vi.useRealTimers());

describe('time-ago (es)', () => {
  it('returns "ahora" for < 60s', () => {
    vi.stubGlobal('Date', class extends Date { getTime() { return NOW + 5_000; } });
    expect(formatTimeAgo(NOW)).toMatch(/ahora/i);
  });

  it('returns minutes for < 60m', () => {
    vi.stubGlobal('Date', class extends Date { getTime() { return NOW + 5 * 60_000; } });
    expect(formatTimeAgo(NOW)).toMatch(/5 min/);
  });

  it('returns hours for < 24h', () => {
    vi.stubGlobal('Date', class extends Date { getTime() { return NOW + 2 * 3_600_000; } });
    expect(formatTimeAgo(NOW)).toMatch(/2 horas?/);
  });

  it('returns days for < 7d', () => {
    vi.stubGlobal('Date', class extends Date { getTime() { return NOW + 3 * 86_400_000; } });
    expect(formatTimeAgo(NOW)).toMatch(/3 días?/);
  });

  it('returns absolute date for >= 7d', () => {
    vi.stubGlobal('Date', class extends Date { getTime() { return NOW + 10 * 86_400_000; } });
    expect(formatTimeAgo(NOW)).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}|\w+ \d{1,2}/);
  });
});
```

Inspect `src/utils/time-ago.ts` for the exact export name and Spanish strings; align the regexes.

- [ ] **Step 3: `os-detect.test.ts`**

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { detectPlatform } from '../../src/utils/os-detect';

const ua = (s: string) => Object.defineProperty(navigator, 'userAgent', { value: s, configurable: true });

afterEach(() => ua(''));

describe('os-detect', () => {
  it('detects macOS', () => {
    ua('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15');
    expect(detectPlatform()).toMatch(/mac/i);
  });

  it('detects Windows', () => {
    ua('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(detectPlatform()).toMatch(/win/i);
  });

  it('detects Linux', () => {
    ua('Mozilla/5.0 (X11; Linux x86_64)');
    expect(detectPlatform()).toMatch(/linux/i);
  });

  it('detects iOS', () => {
    ua('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    expect(detectPlatform()).toMatch(/ios|ip/i);
  });

  it('detects Android', () => {
    ua('Mozilla/5.0 (Linux; Android 14; Pixel 8)');
    expect(detectPlatform()).toMatch(/android/i);
  });
});
```

Adjust the export name `detectPlatform` to match `src/utils/os-detect.ts`.

- [ ] **Step 4: Run and commit**

Run: `pnpm test`
Expected: all green.

```bash
git add tests/unit/
git commit -m "test: characterize settings, time-ago, os-detect"
```

---

## Task 6: Fix `storage.ts` silent error classification

**Files:**
- Modify: `src/utils/storage.ts`
- Test: extend `tests/unit/storage.test.ts`

**Interfaces:**
- Produces: `load`/`save` distinguish `QuotaExceededError` from parse errors and log warnings.

- [ ] **Step 1: Add failing tests for the new behavior**

Append to `tests/unit/storage.test.ts`:

```ts
it('save logs a console.warn on quota error', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError');
  });
  save('k', 'v');
  expect(warnSpy).toHaveBeenCalled();
  expect(warnSpy.mock.calls[0]?.[0]).toMatch(/quota|storage/i);
  setSpy.mockRestore();
  warnSpy.mockRestore();
});

it('load logs a console.warn on corrupt JSON', () => {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  localStorage.setItem('stt_bad', '{not json');
  load('bad');
  expect(warnSpy).toHaveBeenCalled();
  warnSpy.mockRestore();
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm test tests/unit/storage.test.ts`
Expected: 2 new tests fail (current code swallows silently).

- [ ] **Step 3: Update `src/utils/storage.ts`**

Replace the catch blocks. The current code is roughly:

```ts
export function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`stt_${key}`);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}
```

Change to:

```ts
export function load<T>(key: string): T | null {
  const fullKey = `stt_${key}`;
  try {
    const raw = localStorage.getItem(fullKey);
    if (raw === null) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[storage] failed to parse "${fullKey}":`, err);
    return null;
  }
}

export function save<T>(key: string, value: T): void {
  const fullKey = `stt_${key}`;
  try {
    localStorage.setItem(fullKey, JSON.stringify(value));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      console.warn(`[storage] quota exceeded writing "${fullKey}"`);
    } else {
      console.warn(`[storage] unexpected error writing "${fullKey}":`, err);
    }
  }
}

export function remove(key: string): void {
  localStorage.removeItem(`stt_${key}`);
}
```

- [ ] **Step 4: Verify green**

Run: `pnpm test tests/unit/storage.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/utils/storage.ts tests/unit/storage.test.ts
git commit -m "fix(storage): classify QuotaExceeded vs corrupt JSON with warnings"
```

---

## Task 7: Fix theme prefix bug (`stt_theme`)

**Files:**
- Modify: `src/utils/theme.ts`, `index.html`
- Test: `tests/unit/theme.test.ts` (new)

**Interfaces:**
- Produces: `STORAGE_KEY = 'theme'` used via `storage.ts` (which adds `stt_` prefix). The `index.html` no-flash script reads `localStorage.getItem('stt_theme')`.

- [ ] **Step 1: Inspect current theme.ts to find the storage key constant**

Run: `grep -n "theme" src/utils/theme.ts | head -20`
Note the current `STORAGE_KEY` value (likely `'theme'`).

- [ ] **Step 2: Write the failing test**

`tests/unit/theme.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
// Adjust import to actual export name (ThemeManager class or functions)
import { STORAGE_KEY } from '../../src/utils/theme';

describe('theme storage key', () => {
  beforeEach(() => localStorage.clear());

  it('uses the prefixed key when persisted', () => {
    // The contract: whatever ThemeManager writes must be readable by
    // the index.html no-flash script at localStorage.getItem('stt_theme').
    // storage.save() adds the 'stt_' prefix automatically.
    expect(STORAGE_KEY).toBe('theme'); // unprefixed; storage layer adds stt_
  });
});
```

If the export is inside a class, expose the key as a module-level `export const STORAGE_KEY = 'theme'` and import it.

- [ ] **Step 3: Fix `index.html` no-flash script**

Open `index.html`. Find the inline bootstrap script (around line 23) that reads the theme. Change:

```js
const stored = localStorage.getItem('theme');
```

to:

```js
const stored = localStorage.getItem('stt_theme');
```

Keep the rest of the script (system-preference fallback, applying `dark` class).

- [ ] **Step 4: Verify `STORAGE_KEY` value in theme.ts matches `'theme'`**

If `theme.ts` uses a different key (e.g. `'userTheme'`), change it to `STORAGE_KEY = 'theme'` so the prefixed value is `stt_theme`, matching the fixed `index.html`. Run the full test suite.

Run: `pnpm test tests/unit/theme.test.ts && pnpm typecheck`

- [ ] **Step 5: Manual smoke check**

Run: `pnpm dev`, open the app, toggle theme, reload — the theme must persist across reload with no flash. (This is a manual verification step; record the result in the commit body.)

- [ ] **Step 6: Commit**

```bash
git add src/utils/theme.ts index.html tests/unit/theme.test.ts
git commit -m "fix(theme): align no-flash script with stt_ storage prefix"
```

---

## Task 8: Add `navigator.mediaDevices` guard, `RecordingTimer.dispose()`

**Files:**
- Modify: `src/audio/recorder.ts`, `src/audio/recording-timer.ts`
- Test: `tests/unit/recorder.test.ts` (new, guard only — full audio is integration-tested in Phase 2)

**Interfaces:**
- Produces: `MicNotSupportedError` thrown from `Recorder.init()` when `navigator.mediaDevices` is undefined. `RecordingTimer.dispose()` for cleanup.

- [ ] **Step 1: Add `MicNotSupportedError` to `src/types.ts`**

```ts
export class MicNotSupportedError extends Error {
  constructor(message = 'MediaRecorder/navigator.mediaDevices not available in this context (requires HTTPS or localhost).') {
    super(message);
    this.name = 'MicNotSupportedError';
  }
}
```

- [ ] **Step 2: Write failing test for the guard**

`tests/unit/recorder.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Recorder } from '../../src/audio/recorder';
import { MicNotSupportedError } from '../../src/types';

describe('Recorder.init guard', () => {
  it('throws MicNotSupportedError when mediaDevices is undefined', async () => {
    const original = navigator.mediaDevices;
    // @ts-expect-error deliberate deletion for the test
    delete navigator.mediaDevices;
    const recorder = new Recorder({} as never); // bus injected lazily; adjust ctor signature to match
    await expect(recorder.init()).rejects.toBeInstanceOf(MicNotSupportedError);
    Object.defineProperty(navigator, 'mediaDevices', { value: original, configurable: true });
  });
});
```

If the `Recorder` constructor takes the bus, pass a stub: `new Recorder({ on: () => () => {}, emit: () => {}, off: () => {}, clear: () => {} } as never)`. Inspect `src/audio/recorder.ts` for the real constructor signature and adjust.

- [ ] **Step 3: Add the guard in `src/audio/recorder.ts`**

At the top of `init()`:

```ts
public async init(): Promise<void> {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    throw new MicNotSupportedError();
  }
  // ... existing implementation
}
```

Import `MicNotSupportedError` from `../types`.

- [ ] **Step 4: Add `dispose()` to `src/audio/recording-timer.ts`**

```ts
public dispose(): void {
  this.stop();
  // any additional teardown the class needs
}
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm test tests/unit/recorder.test.ts && pnpm typecheck`

```bash
git add src/audio/recorder.ts src/audio/recording-timer.ts src/types.ts tests/unit/recorder.test.ts
git commit -m "fix(audio): guard navigator.mediaDevices, add RecordingTimer.dispose()"
```

---

## Task 9: Network resilience in `groq-client.ts` (timeout, abort, retry, Zod, typed errors)

**Files:**
- Modify: `src/api/groq-client.ts`, `src/types.ts`
- Test: `tests/unit/groq-client.test.ts` (new), `tests/helpers/msw-handlers.ts` (new)

**Interfaces:**
- Produces:
  - `GroqError` union type in `src/types.ts`.
  - `GroqClient.transcribe(blob, options, signal?)` — accepts an optional external `AbortSignal`.
  - Internal: 30s timeout, 3 retries on 429/503/504 with exponential backoff + jitter.

- [ ] **Step 1: Add typed errors + Zod schema to `src/types.ts`**

```ts
export type GroqError =
  | ({ kind: 'auth' } & ErrorPayload)
  | ({ kind: 'rate-limit'; retryAfterMs?: number } & ErrorPayload)
  | ({ kind: 'network' } & ErrorPayload)
  | ({ kind: 'parse' } & ErrorPayload)
  | ({ kind: 'server'; status: number } & ErrorPayload);

interface ErrorPayload { message: string; cause?: unknown; }

export class GroqApiError extends Error {
  constructor(public readonly detail: GroqError) {
    super(detail.message);
    this.name = 'GroqApiError';
    if (detail.cause !== undefined) this.cause = detail.cause;
  }
}
```

- [ ] **Step 2: Create `tests/helpers/msw-handlers.ts`**

```ts
import { http, HttpResponse } from 'msw';

const GROQ = 'https://api.groq.com/openai/v1/audio/transcriptions';

export const handlers = [
  http.post(GROQ, async ({ request }) => {
    const auth = request.headers.get('Authorization');
    if (!auth || auth === 'Bearer invalid') {
      return HttpResponse.json({ error: { message: 'Invalid API key' } }, { status: 401 });
    }
    return HttpResponse.json({ text: 'hello world' });
  })
];
```

- [ ] **Step 3: Write failing tests**

`tests/unit/groq-client.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from '../helpers/msw-handlers';
import { GroqClient } from '../../src/api/groq-client';
import { GroqApiError } from '../../src/types';

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const opts = { model: 'whisper-large-v3-turbo', language: 'es', temperature: 0, responseFormat: 'json', translate: false, verbose: false } as const;

describe('GroqClient', () => {
  it('returns parsed text on 200', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const client = new GroqClient({} as never, 'gsk_test-key');
    const result = await client.transcribe(blob, opts);
    expect(result.text).toBe('hello world');
  });

  it('throws GroqApiError kind=auth on 401', async () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const client = new GroqClient({} as never, 'invalid');
    await expect(client.transcribe(blob, opts)).rejects.toMatchObject({ detail: { kind: 'auth' } });
  });

  it('aborts when external signal fires', async () => {
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', async () => {
        await new Promise(r => setTimeout(r, 5000));
        return HttpResponse.json({ text: 'late' });
      })
    );
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const ctrl = new AbortController();
    const client = new GroqClient({} as never, 'gsk_test-key');
    setTimeout(() => ctrl.abort(), 50);
    await expect(client.transcribe(blob, opts, ctrl.signal)).rejects.toMatchObject({
      detail: { kind: 'network' }
    });
  });

  it('retries 429 then succeeds', async () => {
    let attempts = 0;
    server.use(
      http.post('https://api.groq.com/openai/v1/audio/transcriptions', () => {
        attempts++;
        if (attempts < 3) return HttpResponse.json({ error: { message: 'rate' } }, { status: 429, headers: { 'Retry-After': '0' } });
        return HttpResponse.json({ text: 'ok' });
      })
    );
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const client = new GroqClient({} as never, 'gsk_test-key');
    const result = await client.transcribe(blob, opts);
    expect(result.text).toBe('ok');
    expect(attempts).toBe(3);
  });
});
```

Note: constructor signature changes in Step 4 — `new GroqClient(bus, apiKey)` instead of resolving internally.

- [ ] **Step 4: Rewrite `src/api/groq-client.ts`**

```ts
import { z } from 'zod';
import type { EventBus } from '../core/event-bus';
import type { EventMap, GroqError, TranscriptionOptions, TranscriptionResult } from '../types';
import { GroqApiError } from '../types';

const TRANSCRIPTION_SCHEMA = z.object({
  text: z.string().default(''),
  // verbose fields optional — extend as needed in Phase 3
}).passthrough();

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const RETRYABLE = new Set([429, 503, 504]);

export class GroqClient {
  constructor(
    private readonly bus: EventBus<EventMap>,
    private readonly apiKey: string
  ) {}

  async transcribe(blob: Blob, options: TranscriptionOptions, externalSignal?: AbortSignal): Promise<TranscriptionResult> {
    if (!this.apiKey) {
      const err: GroqError = { kind: 'auth', message: 'Falta la API key de Groq. Ábrela desde Ajustes.' };
      this.bus.emit('transcription:error', err);
      throw new GroqApiError(err);
    }

    const url = options.translate
      ? 'https://api.groq.com/openai/v1/audio/translations'
      : 'https://api.groq.com/openai/v1/audio/transcriptions';

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      // chain external signal
      if (externalSignal) {
        if (externalSignal.aborted) ctrl.abort();
        else externalSignal.addEventListener('abort', () => ctrl.abort(), { once: true });
      }

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.apiKey}` },
          body: this.buildFormData(blob, options),
          signal: ctrl.signal
        });

        if (res.ok) {
          const parsed = TRANSCRIPTION_SCHEMA.safeParse(await res.json().catch(() => ({})));
          if (!parsed.success) {
            throw new GroqApiError({ kind: 'parse', message: 'Respuesta inesperada del servidor.', cause: parsed.error });
          }
          const result = parsed.data as TranscriptionResult;
          this.bus.emit('transcription:success', result);
          return result;
        }

        const status = res.status;
        const body = await res.json().catch(() => ({}));
        const msg = (body?.error?.message as string | undefined) ?? `HTTP ${status}`;

        if (RETRYABLE.has(status) && attempt < MAX_RETRIES) {
          const retryAfter = Number(res.headers.get('Retry-After') ?? 0);
          const backoff = (retryAfter || Math.pow(2, attempt)) * 1000;
          const jitter = Math.random() * 250;
          await new Promise(r => setTimeout(r, backoff + jitter));
          continue;
        }

        const kind: GroqError['kind'] = status === 401 || status === 403 ? 'auth'
          : status === 429 ? 'rate-limit'
          : status >= 500 ? 'server' : 'network';
        const err: GroqError = kind === 'rate-limit'
          ? { kind, message: msg, retryAfterMs: retryAfter * 1000 }
          : kind === 'server'
            ? { kind, message: msg, status }
            : { kind, message: msg };
        this.bus.emit('transcription:error', err);
        throw new GroqApiError(err);
      } catch (e) {
        if (e instanceof GroqApiError) throw e;
        if (e instanceof DOMException && e.name === 'AbortError') {
          if (externalSignal?.aborted) {
            const err: GroqError = { kind: 'network', message: 'Transcripción cancelada.', cause: e };
            this.bus.emit('transcription:error', err);
            throw new GroqApiError(err);
          }
          if (attempt < MAX_RETRIES) continue; // timeout, retry
          const err: GroqError = { kind: 'network', message: 'Tiempo de espera agotado.', cause: e };
          this.bus.emit('transcription:error', err);
          throw new GroqApiError(err);
        }
        const err: GroqError = { kind: 'network', message: 'Error de red.', cause: e };
        this.bus.emit('transcription:error', err);
        throw new GroqApiError(err);
      } finally {
        clearTimeout(timeout);
      }
    }
    // unreachable, but TS needs a return
    throw new GroqApiError({ kind: 'network', message: 'Reintentos agotados.' });
  }

  private buildFormData(blob: Blob, o: TranscriptionOptions): FormData {
    const fd = new FormData();
    fd.append('file', blob, 'audio.webm');
    fd.append('model', o.model);
    fd.append('temperature', String(o.temperature));
    fd.append('response_format', o.verbose ? 'verbose_json' : o.responseFormat);
    if (!o.translate && o.language) fd.append('language', o.language);
    return fd;
  }
}
```

- [ ] **Step 5: Run tests, iterate until green**

Run: `pnpm test tests/unit/groq-client.test.ts`
Expected: 4 passing. If `TranscriptionOptions` shape differs, align the `buildFormData` field names with `src/types.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/api/groq-client.ts src/types.ts tests/unit/groq-client.test.ts tests/helpers/msw-handlers.ts
git commit -m "feat(groq): timeout, abort, retry/backoff, Zod validation, typed errors"
```

---

## Task 10: Verify coverage threshold met; address gaps

**Files:**
- Modify: any pure module with < 90% coverage
- Test: add cases as needed

- [ ] **Step 1: Run coverage**

Run: `pnpm test:coverage`
Read the `coverage/index.html` (or terminal summary). Targets: lines/functions/statements ≥ 90%, branches ≥ 80% across `src/**` (excluding `main.ts`, `types.ts`).

- [ ] **Step 2: Fill gaps**

For any file below threshold, add focused tests. Common gaps expected:
- `history-repo.ts` eviction edge (exactly at limit).
- `settings.ts` defaults when DOM fields missing.
- `os-detect.ts` unknown userAgent fallback.

- [ ] **Step 3: Commit**

```bash
git add tests/
git commit -m "test: close coverage gaps to meet 90% threshold"
```

---

## Task 11: Scaffold the Tauri shell

**Files:**
- Create: `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`, `src-tauri/src/main.rs`, `src-tauri/.gitignore`, `src-tauri/icons/` (placeholder)
- Modify: `package.json` (scripts + `@tauri-apps/cli` devDep), `vite.config.ts`

**Interfaces:**
- Produces: `pnpm tauri dev` launches the desktop app loading the existing SPA. No keychain commands yet (Task 12 wires them).

- [ ] **Step 1: Install Tauri CLI and APIs**

Run:
```bash
pnpm add -D @tauri-apps/cli@^2
pnpm tauri --version   # sanity check
```
If `pnpm tauri` complains about Rust toolchain, install via https://rustup.rs (document in README — Task 13).

- [ ] **Step 2: Add scripts to `package.json`**

```json
"tauri": "tauri",
"tauri:dev": "tauri dev",
"tauri:build": "tauri build"
```

- [ ] **Step 3: Adjust `vite.config.ts` for Tauri**

```ts
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [tailwindcss()],
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
    watch: { ignored: ['**/src-tauri/**'] }
  }
});
```

- [ ] **Step 4: Create `src-tauri/Cargo.toml`**

```toml
[package]
name = "lu-yume"
version = "0.1.0"
description = "LU YUME — Speech-to-Text desktop app"
edition = "2021"
rust-version = "1.77"

[lib]
name = "lu_yume_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
keyring = "3"
dirs = "5"
thiserror = "1"

[features]
custom-protocol = ["tauri/custom-protocol"]
```

- [ ] **Step 5: Create `src-tauri/build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 6: Create `src-tauri/src/main.rs` (stub, commands wired in Task 12)**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lu_yume_lib::run()
}
```

Create `src-tauri/src/lib.rs`:

```rust
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").expect("main window");
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: Create `src-tauri/tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "LU YUME",
  "version": "0.1.0",
  "identifier": "com.lu-yume.speech-to-text",
  "build": {
    "beforeDevCommand": "pnpm dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "pnpm build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      { "title": "LU YUME — Speech-to-Text", "width": 1024, "height": 720, "minWidth": 640, "minHeight": 480, "resizable": true, "fullscreen": false }
    ],
    "security": {
      "csp": "default-src 'self'; img-src 'self' data: asset: https://asset.localhost; style-src 'self'; script-src 'self'; connect-src 'self' https://api.groq.com ipc: http://ipc.localhost"
    }
  },
  "bundle": {
    "active": true,
    "targets": ["msi", "nsis", "dmg", "appimage"],
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"]
  }
}
```

Note: CSP `'unsafe-inline'` is avoided. If Tailwind 4 runtime injects inline styles and the app breaks, run with CSP violation reports to identify the leak, then either move styles to a compiled stylesheet or add a nonce. Document the resolution in `ARCHITECTURE.md` (Task 13).

- [ ] **Step 8: Create `src-tauri/capabilities/default.json`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window — least privilege.",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-open",
    "dialog:allow-open",
    "dialog:allow-save",
    "event:default"
  ]
}
```

(`fs` and `http` scopes are added in Task 12 alongside the keychain/settings commands that need them.)

- [ ] **Step 9: Create placeholder icons and `.gitignore`**

Generate placeholder icons using `pnpm tauri icon public/favicon.svg` (Tauri CLI produces the full icon set). If the source SVG is unsuitable, create a 1024×1024 PNG first.

`src-tauri/.gitignore`:
```
/target
/gen/schemas
```

- [ ] **Step 10: Smoke run**

Run: `pnpm tauri dev`
Expected: a desktop window opens, loads the SPA, the existing UI renders. Microphone permission prompt may appear on first record. The transcription will fail with `kind: 'auth'` because the keychain commands aren't wired yet (Task 12). This is expected.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/ package.json pnpm-lock.yaml vite.config.ts
git commit -m "feat(tauri): scaffold desktop shell (Rust backend, CSP, capabilities)"
```

---

## Task 12: Rust keychain commands + TS platform bridge + wire main.ts

**Files:**
- Create: `src-tauri/src/error.rs`, `src-tauri/src/config.rs`, `src-tauri/src/commands/mod.rs`, `src-tauri/src/commands/api_key.rs`, `src-tauri/src/commands/settings.rs`, `src/platform/platform.ts`, `src/platform/tauri-bridge.ts`, `src/platform/web-bridge.ts`, `src/platform/api-key.schema.ts`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/capabilities/default.json`, `src/api/groq-client.ts`, `src/main.ts`

**Interfaces:**
- Produces:
  - Rust `#[tauri::command]`: `api_key_get`, `api_key_set`, `api_key_has`, `api_key_delete`, `settings_load`, `settings_save`.
  - TS `Platform` interface: `getApiKey(): Promise<string | null>`, `setApiKey(key: string): Promise<void>`, `hasApiKey(): Promise<boolean>`, `deleteApiKey(): Promise<void>`, `loadSettings(): Promise<AppSettings | null>`, `saveSettings(s: AppSettings): Promise<void>`, `isDesktop(): boolean`.
  - `detectPlatform()` factory returning the right implementation.
  - `GroqClient` constructor: `new GroqClient(bus, apiKey)` — `apiKey` supplied by `main.ts` from the bridge.
  - `main.ts` global error handlers, full cleanup, async boot that awaits the key.

- [ ] **Step 1: Add `fs` scope to `src-tauri/capabilities/default.json`**

Append to the `permissions` array:
```json
"fs:allow-read-file",
"fs:allow-write-file",
{
  "identifier": "fs:scope",
  "allow": [{ "path": "$APPDATA/lu-yume/*" }, { "path": "$APPCONFIG/lu-yume/*" }]
}
```

- [ ] **Step 2: Create `src-tauri/src/error.rs`**

```rust
use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("keyring error: {0}")]
    Keyring(#[from] keyring::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("not found")]
    NotFound,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.to_string().as_ref())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
```

- [ ] **Step 3: Create `src-tauri/src/config.rs`**

```rust
use std::path::PathBuf;

pub fn app_config_dir() -> PathBuf {
    let mut p = dirs::config_dir().expect("no config dir on this platform");
    p.push("lu-yume");
    std::fs::create_dir_all(&p).ok();
    p
}

pub fn settings_path() -> PathBuf {
    app_config_dir().join("settings.json")
}

pub const KEYRING_SERVICE: &str = "lu-yume";
pub const KEYRING_USER: &str = "groq-api-key";
```

- [ ] **Step 4: Create `src-tauri/src/commands/api_key.rs`**

```rust
use crate::config::{KEYRING_SERVICE, KEYRING_USER};
use crate::error::Result;
use keyring::Entry;

fn entry() -> Result<Entry> {
    Ok(Entry::new(KEYRING_SERVICE, KEYRING_USER)?)
}

#[tauri::command]
pub fn api_key_has() -> bool {
    entry().and_then(|e| e.get_password().map(|p| !p.is_empty())).unwrap_or(false)
}

#[tauri::command]
pub fn api_key_get() -> Option<String> {
    entry().ok()?.get_password().ok().filter(|p| !p.is_empty())
}

#[tauri::command]
pub fn api_key_set(key: String) -> Result<()> {
    let e = entry()?;
    e.set_password(&key)?;
    Ok(())
}

#[tauri::command]
pub fn api_key_delete() -> Result<()> {
    match entry()?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.into()),
    }
}
```

- [ ] **Step 5: Create `src-tauri/src/commands/settings.rs`**

```rust
use crate::config::settings_path;
use crate::error::Result;
use serde_json::Value;

#[tauri::command]
pub fn settings_load() -> Result<Option<Value>> {
    let path = settings_path();
    if !path.exists() { return Ok(None); }
    let raw = std::fs::read_to_string(path)?;
    let v: Value = serde_json::from_str(&raw)?;
    Ok(Some(v))
}

#[tauri::command]
pub fn settings_save(value: Value) -> Result<()> {
    let path = settings_path();
    let s = serde_json::to_string_pretty(&value)?;
    std::fs::write(path, s)?;
    Ok(())
}
```

- [ ] **Step 6: Create `src-tauri/src/commands/mod.rs` and wire in `lib.rs`**

`src-tauri/src/commands/mod.rs`:
```rust
pub mod api_key;
pub mod settings;
```

Update `src-tauri/src/lib.rs` to register the commands:

```rust
use tauri::Manager;

mod commands;
mod config;
mod error;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::api_key::api_key_get,
            commands::api_key::api_key_set,
            commands::api_key::api_key_has,
            commands::api_key::api_key_delete,
            commands::settings::settings_load,
            commands::settings::settings_save,
        ])
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").expect("main window");
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 7: Create `src/platform/api-key.schema.ts`**

```ts
import { z } from 'zod';

export const apiKeySchema = z.string().regex(/^gsk_[A-Za-z0-9]{40,}$/u, 'Groq API key debe tener formato gsk_…');
export type ApiKey = z.infer<typeof apiKeySchema>;
```

- [ ] **Step 8: Create `src/platform/platform.ts`**

```ts
import type { AppSettings } from '../types';

export interface Platform {
  isDesktop(): boolean;
  hasApiKey(): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  deleteApiKey(): Promise<void>;
  loadSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;
}

let cached: Platform | undefined;

export async function detectPlatform(): Promise<Platform> {
  if (cached) return cached;
  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  cached = isTauri
    ? await import('./tauri-bridge').then(m => new m.TauriBridge())
    : await import('./web-bridge').then(m => new m.WebBridge());
  return cached;
}
```

- [ ] **Step 9: Create `src/platform/tauri-bridge.ts`**

```ts
import { invoke } from '@tauri-apps/api/core';
import type { Platform } from './platform';
import type { AppSettings } from '../types';
import { apiKeySchema } from './api-key.schema';

export class TauriBridge implements Platform {
  isDesktop(): boolean { return true; }

  async hasApiKey(): Promise<boolean> {
    return invoke<boolean>('api_key_has');
  }

  async getApiKey(): Promise<string | null> {
    const key = await invoke<string | null>('api_key_get');
    return key ?? null;
  }

  async setApiKey(key: string): Promise<void> {
    apiKeySchema.parse(key);
    await invoke('api_key_set', { key });
  }

  async deleteApiKey(): Promise<void> {
    await invoke('api_key_delete');
  }

  async loadSettings(): Promise<AppSettings | null> {
    return invoke<AppSettings | null>('settings_load');
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await invoke('settings_save', { value: settings });
  }
}
```

Install the runtime dep: `pnpm add @tauri-apps/api@^2`.

- [ ] **Step 10: Create `src/platform/web-bridge.ts` (dev/test fallback only)**

```ts
import type { Platform } from './platform';
import type { AppSettings } from '../types';
import { save, load, remove } from '../utils/storage';

const KEY = 'groq_api_key'; // uses stt_ prefix via storage.ts

export class WebBridge implements Platform {
  isDesktop(): boolean { return false; }

  async hasApiKey(): Promise<boolean> {
    return Boolean(load<string>(KEY));
  }

  async getApiKey(): Promise<string | null> {
    return load<string>(KEY);
  }

  async setApiKey(key: string): Promise<void> {
    save(KEY, key);
  }

  async deleteApiKey(): Promise<void> {
    remove(KEY);
  }

  async loadSettings(): Promise<AppSettings | null> {
    return load<AppSettings>('settings');
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    save('settings', settings);
  }
}
```

This bridge is the ONLY place that still touches the API key via storage — now consistently prefixed via `storage.ts`. Documented in `ARCHITECTURE.md` (Task 13) as the dev/web fallback (the supported product path is desktop via `TauriBridge`).

- [ ] **Step 11: Refactor `src/api/groq-client.ts` constructor signature**

(Already done in Task 9 Step 4 — the constructor is `new GroqClient(bus, apiKey)`. Verify no leftover references to `import.meta.env`, `prompt`, or `sessionStorage`.)

Run: `grep -nE "import\.meta\.env|prompt\(|sessionStorage" src/api/groq-client.ts`
Expected: empty.

- [ ] **Step 12: Refactor `src/main.ts` boot sequence**

Find the `GroqClient` instantiation in `main.ts` and replace with:

```ts
const platform = await detectPlatform();
const apiKey = await platform.getApiKey();
const groqClient = new GroqClient(bus, apiKey ?? '');
if (!apiKey) {
  console.warn('[main] No Groq API key configured. Transcription will fail until set.');
  // Phase 2 will surface an onboarding modal here; for Phase 1 we only warn.
}
```

Add a top-level `try/catch` around `main()` and global handlers:

```ts
async function main(): Promise<void> {
  try {
    // ...existing bootstrap...
  } catch (err) {
    console.error('[main] bootstrap failed:', err);
    // best-effort UI feedback
    document.body.insertAdjacentHTML('beforeend',
      `<div role="alert" style="position:fixed;bottom:1rem;right:1rem;background:#dc2626;color:#fff;padding:1rem;border-radius:8px;z-index:9999">No se pudo iniciar la app. Revisa la consola.</div>`);
  }
}

window.addEventListener('error', (e) => console.error('[window error]', e.error));
window.addEventListener('unhandledrejection', (e) => console.error('[unhandled rejection]', e.reason));

void main();
```

Update the `unload` cleanup to be complete:

```ts
const onResize = () => { /* existing resize handler body */ };
window.addEventListener('resize', onResize);

window.addEventListener('unload', () => {
  window.removeEventListener('resize', onResize);
  keyboard.dispose();          // assuming keyboard.ts exposes dispose; if it returns a cleanup fn, call that
  visualizer.stop();
  timer.dispose();
  analyzer.dispose();
  recorder.dispose();
  bus.clear();
});
```

(If `keyboard.ts` returns a cleanup function from an `init()` call, store it and call it instead of `.dispose()` — inspect the source.)

- [ ] **Step 13: Delete `.env`**

Run: `rm .env`

- [ ] **Step 14: Run and verify**

Run: `pnpm typecheck && pnpm test && pnpm tauri dev`

In the Tauri window, no API key is set yet — the warn fires. Set a test key via the OS keychain using a tiny Rust test or via the Tauri devtools console:

```js
await window.__TAURI__.core.invoke('api_key_set', { key: 'gsk_<test-key>' })
```

Then reload and record audio. Transcription should succeed against Groq (with a real test key).

- [ ] **Step 15: Verify the bundle is clean**

Run: `pnpm build && grep -rn 'VITE_GROQ\|gsk_' dist/ || echo "CLEAN"`
Expected: `CLEAN`.

- [ ] **Step 16: Commit**

```bash
git add src-tauri/ src/platform/ src/api/groq-client.ts src/main.ts package.json pnpm-lock.yaml
git rm .env
git commit -m "feat(platform): Rust keychain commands + TS bridge, wire GroqClient via DI"
```

---

## Task 13: Rewrite `SECURITY.md`, `README.md`, add `ARCHITECTURE.md`, update `CONTRIBUTING.adoc`

**Files:**
- Rewrite: `SECURITY.md`, `README.md`
- Create: `ARCHITECTURE.md`
- Modify: `CONTRIBUTING.adoc`

- [ ] **Step 1: Rewrite `SECURITY.md`**

Replace the false claim about localStorage. New content must state:
- The API key is stored in the OS-native credential store (macOS Keychain / Windows Credential Manager) via Tauri's keyring backend, never in `localStorage`/`sessionStorage`, never in the JS bundle.
- The web/dev fallback uses `localStorage` under the `stt_groq_api_key` key but is NOT a supported product path.
- CSP is enforced by Tauri (`default-src 'self'`).
- No backend server; the only network egress is `https://api.groq.com` (allowlisted).
- Reporting process unchanged (GitHub private vulnerability reporting, 48h ack, 5 business days initial assessment).
- **Rotation note:** the key `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` that was previously in a local `.env` must be revoked before this commit lands.

- [ ] **Step 2: Rewrite `README.md`**

Update:
- Badges: TypeScript 6.x (or 5.6 if spike downgraded), Vite 8.x, Tauri 2.x, Tailwind 4.x.
- Add "Prerequisites": Node ≥ 20, pnpm ≥ 9, Rust stable (rustup), system deps for Tauri (https://tauri.app/start/prerequisites/).
- Replace all `npm install` / `npm run X` with `pnpm install` / `pnpm X`.
- Add `pnpm tauri dev` and `pnpm tauri build` sections.
- Document the API key setup: Settings dialog in-app (Phase 2), or for first run in Phase 1 the devtools console snippet.
- Update the project structure block to include `src-tauri/`, `src/platform/`, `tests/`, `vitest.config.ts`.

- [ ] **Step 3: Create `ARCHITECTURE.md`**

Sections:
1. High-level diagram (Tauri shell → SPA → platform bridge → Rust commands → keychain/FS).
2. Module map (what lives where).
3. The Dependency Inversion rule (no module imports Tauri except `platform/*`).
4. CSP resolution note (if Tailwind 4 needed a nonce, document it here).
5. How to add a new Tauri command (Rust `#[tauri::command]` + register in `lib.rs` + capability + TS wrapper in `tauri-bridge.ts`).

- [ ] **Step 4: Update `CONTRIBUTING.adoc`**

Append sections:
- "Running tests" (`pnpm test`, `pnpm test:coverage`).
- "Adding a pure-module test" (mirror the patterns in `tests/unit/`).
- "Adding a Tauri command" (link to ARCHITECTURE.md).

- [ ] **Step 5: Commit**

```bash
git add SECURITY.md README.md ARCHITECTURE.md CONTRIBUTING.adoc
git commit -m "docs: rewrite SECURITY (keychain truth), README (pnpm/Tauri), add ARCHITECTURE"
```

---

## Task 14: Rewrite CI for pnpm, typecheck, tests, audit, desktop matrix

**Files:**
- Rewrite: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace the workflow**

```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test:coverage
      - run: pnpm audit --prod || true
      - uses: actions/upload-artifact@v4
        with: { name: coverage, path: coverage/ }
      - run: pnpm build

  desktop-build:
    needs: quality
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            rust-target: x86_64-pc-windows-msvc
          - os: macos-latest
            rust-target: aarch64-apple-darwin
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with: { targets: ${{ matrix.rust-target }} }
      - uses: Swatinem/rust-cache@v2
        with: { workspaces: 'src-tauri -> target' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm tauri build --target ${{ matrix.rust-target }}
      - uses: actions/upload-artifact@v4
        with:
          name: bundle-${{ matrix.os }}
          path: |
            src-tauri/target/*/release/bundle/**/*.msi
            src-tauri/target/*/release/bundle/**/*.exe
            src-tauri/target/*/release/bundle/**/*.dmg
```

- [ ] **Step 2: Verify locally if possible**

Run: `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build`
Expected: all green locally; CI will validate desktop-build on push.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: pnpm, typecheck, coverage, audit, Windows+macOS Tauri build matrix"
```

---

## Task 15: Pre-merge verification — exit criteria for Phase 1

**Files:** none (verification only)

- [ ] **Step 1: Run the full local gate**

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
grep -rn 'VITE_GROQ\|gsk_' dist/ && { echo "BUNDLE LEAK"; exit 1; } || echo "BUNDLE CLEAN"
pnpm tauri build
```

Expected: all green, bundle clean, installers produced under `src-tauri/target/*/release/bundle/`.

- [ ] **Step 2: Confirm key rotation done**

Manually verify at https://console.groq.com/keys that the key `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` has been revoked. If not, revoke it now.

- [ ] **Step 3: Confirm coverage thresholds met**

Open `coverage/index.html`. Every file under `src/` (except `main.ts`, `types.ts`) must show ≥ 90% lines/functions/statements and ≥ 80% branches.

- [ ] **Step 4: Confirm no `prompt()`/`confirm()` in shipped UI paths**

Run: `grep -rnE 'window\.(prompt|confirm)\s*\(' src/`
Expected: empty (onboarding/settings replacements land in Phase 2; for Phase 1 the bridge supplies the key and a console-error + toast is shown if missing).

- [ ] **Step 5: Open a PR**

Push `develop` (or a feature branch off it), open a PR with the body referencing the spec at `docs/superpowers/specs/2026-06-28-tauri-migration-design.md` and this plan. List the exit-criteria checks as the PR checklist.

---

## Self-Review (run by the planner after writing this plan)

**Spec coverage check** — every section of the spec's Phase 1 maps to a task:
- §3.1 Tauri migration → Task 11
- §3.2 API key architecture → Task 12
- §3.3 strict TS → Tasks 1, 2
- §3.4 network resilience → Task 9
- §3.5 bug fixes (theme, cleanup, error handler, recorder guard, SECURITY.md, storage errors, key inconsistency) → Tasks 6, 7, 8, 12, 13
- §3.6 tests baseline → Tasks 3, 4, 5, 9, 10
- §3.7 dep audit (TS spike, pnpm, badges) → Tasks 1, 13 (TS spike folded into Task 2 — if Task 2 reveals blocking TS 6.0 friction, halt and downgrade to TS 5.6 before continuing)
- §3.8 exit criteria → Task 15

**Placeholder scan** — no TBDs; all steps carry concrete code or exact commands.

**Type consistency** — `GroqError` / `GroqApiError` defined once in Task 9 Step 1, used consistently. `Platform` interface defined in Task 12 Step 8, implemented identically by both bridges. `detectPlatform()` factory matches the import sites in `main.ts`. `STORAGE_KEY = 'theme'` (unprefixed; `storage.ts` adds `stt_`) matches `index.html` reading `stt_theme`.

**Known risks carried forward**:
1. If TS 6.0.2 blocks type-aware ESLint in Task 1, downgrade to TS 5.6 (document in ARCHITECTURE.md).
2. If Tailwind 4 runtime inline styles violate CSP, add a nonce or precompile — resolve in Task 11 Step 10, document in Task 13.
3. If `Recorder` / `keyboard` constructor or init signatures differ from what Tasks 8/12 assume, adjust the test stubs to match the real source.
