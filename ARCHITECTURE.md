# Architecture

LU YUME is a desktop speech-to-text application built with **Tauri 2** (Rust shell + native WebView) wrapping a TypeScript SPA (Vite + TypeScript + Tailwind 4).

## 1. High-level diagram

```
┌─────────────────────────────────────────────────────┐
│                   Tauri Shell (Rust)                  │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ api_key_*   │  │ settings_*   │  │  shell/dialog │ │
│  │ commands    │  │ commands     │  │  plugins      │ │
│  └──────┬──────┘  └──────┬───────┘  └──────────────┘ │
│         │                 │                           │
│  ┌──────▼──────┐  ┌──────▼───────┐                    │
│  │  keyring    │  │ settings.json│                    │
│  │ (OS keychain│  │ ($APPDATA/   │                    │
│  │  / cred mgr)│  │  lu-yume/)   │                    │
│  └─────────────┘  └──────────────┘                    │
│         │                 │                           │
│         ▼                 ▼                           │
│    ━━━━━━━━━━━ invoke() IPC ━━━━━━━━━━━              │
│         │                 │                           │
└─────────┼─────────────────┼───────────────────────────┘
          │                 │
┌─────────▼─────────────────▼───────────────────────────┐
│                   WebView (SPA)                        │
│                                                       │
│  ┌──────────────────────────────────────────────┐     │
│  │           src/platform/ (bridge layer)        │     │
│  │                                               │     │
│  │  detectPlatform() ──┬── TauriBridge           │     │
│  │                     └── WebBridge (dev only)  │     │
│  │                                               │     │
│  │  Platform interface:                          │     │
│  │    getApiKey / setApiKey / deleteApiKey       │     │
│  │    hasApiKey / isDesktop                      │     │
│  │    loadSettings / saveSettings                │     │
│  └──────────────────┬──────────────────────────┘     │
│                     │                                 │
│  ┌──────────────────▼──────────────────────────┐     │
│  │              main.ts (composition root)       │     │
│  │  injects platform + apiKey into GroqClient    │     │
│  └──────────────────┬──────────────────────────┘     │
│                     │                                 │
│  ┌──────────────────▼──────────────────────────┐     │
│  │           EventBus (typed pub/sub)            │     │
│  └──┬──────┬──────┬──────┬──────┬──────┬───────┘     │
│     │      │      │      │      │      │              │
│  ┌──▼─┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼──┐ ┌─▼────┐        │
│  │audio│ │API │ │ UI │ │util│ │hist│ │theme│        │
│  └────┘ └────┘ └────┘ └────┘ └────┘ └─────┘        │
└─────────────────────────────────────────────────────┘
```

## 2. Module map

| Directory              | Responsibility                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `src/core/`            | `EventBus` — typed pub/sub. The backbone; all inter-module communication flows through it.        |
| `src/audio/`           | `Recorder`, `AudioAnalyzer`, `RecordingTimer`, `WaveformVisualizer`. Microphone capture + visualization. |
| `src/api/`             | `GroqClient` — HTTP client for Groq Whisper with timeout, retry, Zod validation, typed errors.   |
| `src/platform/`        | `Platform` interface + `TauriBridge` / `WebBridge`. **The only layer that touches Tauri APIs.**  |
| `src/ui/`              | `Renderer`, `Sidebar`, `HistoryCard`, `MetadataPanel`, `Toast`. DOM construction.                |
| `src/utils/`           | `Storage`, `HistoryRepo`, `Settings`, `Keyboard`, `Clipboard`, `Theme`, `OSDetect`, `TimeAgo`.   |
| `src/main.ts`          | Composition root. Wires all modules, owns lifecycle, global error handlers.                      |
| `src/types.ts`         | Shared types + constants (`EventMap`, `TranscriptionResult`, `GroqError`, `GroqApiError`).       |
| `src-tauri/src/`       | Rust backend: Tauri commands, keyring integration, settings file I/O.                            |
| `src-tauri/src/commands/` | `api_key.rs` (4 commands), `settings.rs` (2 commands).                                       |
| `tests/`               | Vitest unit tests. Pure-logic modules tested in isolation; MSW for network mocking.              |

## 3. The Dependency Inversion rule

**No module under `src/` may import `@tauri-apps/api` except `src/platform/tauri-bridge.ts`.**

The rest of the application talks to `Platform` — a plain TypeScript interface defined in `src/platform/platform.ts`:

```typescript
export interface Platform {
  isDesktop(): boolean;
  hasApiKey(): Promise<boolean>;
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  deleteApiKey(): Promise<void>;
  loadSettings(): Promise<unknown>;
  saveSettings(settings: unknown): Promise<void>;
}
```

`main.ts` calls `detectPlatform()` once at startup. The factory checks for
`'__TAURI_INTERNALS__' in window` and returns a `TauriBridge` (desktop) or
`WebBridge` (browser dev fallback). All consumers receive the `Platform`
interface — they never know which concrete bridge is active.

This means:

- Tests can inject a mock `Platform` without Tauri.
- The SPA can run in a plain browser during development.
- Swapping the credential store (e.g., to a remote vault) requires only a new
  `Platform` implementation — zero changes to business logic.

## 4. Content Security Policy

CSP is enforced by Tauri in `src-tauri/tauri.conf.json`:

```
default-src 'self';
connect-src 'self' https://api.groq.com ipc: http://ipc.localhost
```

- `'self'` covers all bundled JS, CSS, fonts, and images.
- `https://api.groq.com` is the only network egress.
- `ipc:` and `http://ipc.localhost` enable Tauri's IPC channel.
- No `unsafe-inline`, no `unsafe-eval`, no third-party CDN origins.

**Tailwind 4 note:** Tailwind 4 with the `@tailwindcss/vite` plugin injects
styles at build time (no runtime `<style>` injection in production). The CSP
above works without a nonce. If a future change introduces runtime style
injection, add a `style-src 'self' 'nonce-<generated>'` directive and pass the
nonce from Rust via `tauri::WebviewWindowBuilder`.

## 5. How to add a new Tauri command

1. **Rust** — Write the command in `src-tauri/src/commands/<area>.rs`:

   ```rust
   #[tauri::command]
   pub fn my_command(arg: String) -> Result<String, AppError> {
       // ...
       Ok(result)
   }
   ```

2. **Register** — Add it to the `generate_handler!` list in `src-tauri/src/lib.rs`:

   ```rust
   .invoke_handler(tauri::generate_handler![
       commands::api_key::api_key_get,
       commands::api_key::api_key_set,
       // ...
       commands::my_area::my_command,
   ])
   ```

3. **Capability** — If the command needs filesystem or other restricted access,
   declare it in `src-tauri/capabilities/default.json`.

4. **TypeScript wrapper** — Add a method to `Platform` in `platform.ts`, then
   implement it in both `TauriBridge` (via `invoke()`) and `WebBridge` (via
   localStorage or a no-op).

   ```typescript
   // platform.ts
   export interface Platform {
     // ...existing methods...
     myAction(arg: string): Promise<string>;
   }

   // tauri-bridge.ts
   async myAction(arg: string): Promise<string> {
     return invoke<string>('my_command', { arg });
   }

   // web-bridge.ts
   async myAction(_arg: string): Promise<string> {
     throw new Error('my_command is only available in the desktop app');
   }
   ```

5. **Test** — Add a unit test for the web-bridge fallback path. The Tauri path
   is validated by the integration build in CI.
