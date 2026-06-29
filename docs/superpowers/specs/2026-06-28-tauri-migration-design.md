# LU YUME → App Desktop Multiplataforma con Tauri

**Estado:** Aprobado (fase de diseño cerrada)
**Fecha:** 2026-06-28
**Autor:** Sesión de brainstorming con el usuario
**Branch objetivo:** `develop` (actual) → feature branches por fase

---

## 1. Contexto y Decisiones

LU YUME es hoy una SPA browser-based de speech-to-text con Groq Whisper (Vite + TS 6.0.2 + Tailwind 4, arquitectura modular event-driven con `EventBus` tipado, 3.403 LOC TS, 0 dependencias de runtime).

Una auditoría exhaustiva reveló tres problemas críticos que bloquean cualquier despliegue público y comprometen la mantenibilidad:

1. **API key expuesta:** el prefijo `VITE_GROQ_API_KEY` hace que Vite incruste la key en el bundle JS servido. Hoy existe además una key real (`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`) en `.env` local en plaintext.
2. **Tipos cosméticos:** `tsconfig.json` sin `strict: true`. Los `as any`/`as string` son parches.
3. **Sin resiliencia de red:** fetch a Groq sin `AbortController`, sin timeout, sin retry. Un request colgado deja la UI en "procesando" eterno.

Adicionalmente: 0 tests, bugs (theme prefix mismatch, cleanup incompleto en unload, sin error handler global), `SECURITY.md` con afirmaciones incorrectas, dependencias bleeding-edge con fricción (TS 6.0.2 vs typescript-eslint 8.x), `prompt()`/`confirm()` bloqueantes.

### Decisiones del usuario

- **Modelo de distribución:** App de escritorio (no web pública).
- **Runtime:** **Tauri** (Rust + webview nativo). Razones: encaja con el stack Vite+TS actual sin reescribir, binarios ~15x más pequeños que Electron, modelo de seguridad por allowlist, plugin oficial para keychain del SO, soporte Windows/macOS/Linux.
- **Alcance UI/features:** Pulir UI existente + features pro (export multi-formato, atajos configurables, dictado continuo, VAD avanzado, búsqueda en historial, tags/colecciones).
- **Estrategia:** **Fases incrementales shipeables** (4 fases). Cada fase valida antes de avanzar.

### Regla de scope (importante)

Este spec cubre la arquitectura transversal + **detalle completo de Fase 1** (el plan de implementación inmediato). **Fases 2 y 3 se detallan como outlines** y se planifican con su propio ciclo spec→plan cuando la fase anterior esté shipeable. Evita planificar trabajo speculative.

---

## 2. Arquitectura General

### Modelo de capas

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (SPA actual, sin reescribir)                  │
│  Vite + TS + Tailwind 4 + EventBus modular              │
│  ─────────────────────────────────────────              │
│  Nuevo: platform/tauri-bridge.ts (única IPC con el SO)  │
└──────────────────────┬──────────────────────────────────┘
                       │ invoke()  ← único canal
┌──────────────────────┴──────────────────────────────────┐
│  Backend Rust (mínimo, solo lo que necesita el SO)      │
│  - keychain: get/set/delete API key                     │
│  - settings file (JSON serializado)                     │
│  - (Fase 3 opcional) http streaming proxy si hace falta │
└──────────────────────┬──────────────────────────────────┘
                       │
              OS Keychain / FS local
        (Windows Credential Manager / macOS Keychain)
```

### Principios

1. **El frontend sigue siendo 100% browser-compatible.** Tauri carga el mismo `dist/`. El wrapper no secuestra la app; el bridge es un módulo aislado.
2. **Dependency Inversion preservada.** Ningún módulo actual importa Tauri directamente. Solo `platform/tauri-bridge.ts` habla con el backend; los demás lo consumen vía `EventBus` o inyección.
3. **Seguridad por allowlist de Tauri.** Capabilities estrictamente necesarios: `fs` (solo app config dir), `http` (allowlist solo `api.groq.com`), `dialog` (save/open). Sin `shell`, sin `process`, sin `path` arbitrario. CSP estricta.
4. **El `GroqClient` deja de leer `import.meta.env`.** La API key se pide vía el bridge al keychain del SO. Fin del problema del prefijo `VITE_`.

### Qué cambia vs qué se queda

| Componente                  | Cambio                                                                                                    |
| --------------------------- | --------------------------------------------------------------------------------------------------------- |
| `groq-client.ts`            | Eliminar `resolveApiKey()` con `import.meta.env`/`prompt()`. Key inyectada desde bridge.                   |
| `theme.ts` + `index.html`   | Fix bug del prefijo (`stt_theme`). Script anti-flash alineado.                                            |
| `main.ts`                   | Cleanup completo + error handler global.                                                                  |
| `tsconfig.json`             | `strict: true` + `DOM.Iterable` + fix casts `as any`.                                                     |
| `utils/storage.ts`          | Eliminar key `groq_api_key` sin prefijo (todo pasa por keychain).                                         |
| `recorder.ts`               | Guard de `navigator.mediaDevices`.                                                                        |
| **Todo lo demás**           | **Sin reescribir.** La arquitectura modular actual es buena.                                              |

### Nuevos módulos

- `src/platform/tauri-bridge.ts` — único punto de contacto con Tauri. Métodos: `getApiKey()`, `setApiKey()`, `hasApiKey()`, `deleteApiKey()`, `loadSettings()`, `saveSettings()`.
- `src/platform/platform.ts` — interfaz que abstrae "¿estoy en Tauri o en browser puro?" (modo web BYO-key legacy vs modo desktop keychain, mismo código frontend).
- `src-tauri/` — proyecto Rust: `main.rs`, `commands/`, `Cargo.toml`, `tauri.conf.json`, `capabilities/`.

---

## 3. Fase 1 — Cimientos (DETALLE COMPLETO, plan de implementación inmediato)

Resuelve los 3 problemas críticos y deja el repo shipeable como app desktop básica con la UI actual.

### 3.1 Migración a Tauri

Estructura nueva:

```
speech-to-text/
├── src/                    ← frontend actual (sin reescribir)
├── src-tauri/              ← NUEVO
│   ├── src/
│   │   ├── main.rs         ← entry, registra comandos
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── api_key.rs  ← get/set/delete con crate keyring
│   │   │   └── settings.rs ← load/save config JSON
│   │   ├── config.rs       ← paths, app dirs (crate dirs)
│   │   └── error.rs        ← tipos de error tipados
│   ├── Cargo.toml          ← deps: tauri, keyring, serde, dirs, thiserror
│   ├── tauri.conf.json     ← app metadata, allowlist, CSP
│   ├── capabilities/
│   │   └── default.json    ← permisos least-privilege
│   └── icons/              ← multi-res Windows .ico + macOS .icns
├── package.json            ← añade scripts tauri
└── vite.config.ts          ← ajuste para Tauri (base, clearScreen:false)
```

- `tauri.conf.json`: `withGlobalTauri: true`, `security.csp` estricta, `bundle.targets: ["msi","nsis","dmg","appimage"]`.
- **Allowlist mínimo:** `fs` (solo app config dir, scope restringido), `dialog` (save/open para export Fase 3), `http` (allowlist solo `api.groq.com`). **No** `shell`, **no** `process`, **no** `path` arbitrario.

### 3.2 Arquitectura de API key (resuelve crítico #1)

```
[Onboarding UI] ──invoke──▶ [Rust: setApiKey] ──▶ [macOS Keychain / Win Credential Manager]
                                                                  │
[App boot] ───────invoke──▶ [Rust: hasApiKey/getApiKey] ◀─────────┘
                                                                  │
[User: delete] ──invoke──▶ [Rust: deleteApiKey] ◀─────────────────┘
```

- `groq-client.ts` ya no toca `import.meta.env`, ni `prompt()`, ni `sessionStorage`. Recibe la key por inyección desde `main.ts`, que la pide al bridge.
- **Rotación de la key leakada:** revocar `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` en https://console.groq.com/keys **antes del merge de Fase 1**.
- **`.env` y `VITE_GROQ_API_KEY` se eliminan del flujo.** `.env.example` también se elimina — el modo-dev sin Tauri ya no se soporta (la app es desktop). Reduce complejidad.

### 3.3 Strict TypeScript (resuelve crítico #3)

`tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    "strict": true,                    // ← antes ausente
    "noUncheckedIndexedAccess": true,  // ← arr[i] es T | undefined
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],  // ← antes sin DOM.Iterable
    // ...resto igual (target, module, verbatimModuleSyntax, etc.)
  }
}
```

- Fix los ~15 `as any`/`as string` que aparecerán (estimado). Particularmente los `Uint8Array<ArrayBuffer>` en `audio-analyzer.ts:127` y `waveform-visualizer.ts` (TS 6.0 generics).
- Habilitar `eslint-plugin` type-aware rules: `recommended-type-checked` + `recommended-type-checked` strict.

### 3.4 Resiliencia de red (resuelve crítico #2)

`groq-client.ts` refactorizado:

- **Timeout 30s:** `AbortController` con `setTimeout`. Cancela fetch si Groq no responde.
- **Usuario puede cancelar:** botón "Cancelar" en UI emite evento que aborta el controller.
- **Retry con backoff:** 3 reintentos en 429/503/504 con backoff exponencial (1s, 2s, 4s) + jitter. Sin retry en 4xx client errors.
- **Validación de respuesta:** schema Zod para `TranscriptionResult`. Si la API devuelve shape raro, lanza error tipado.
- **Errores tipados:** `GroqError` union: `AuthError | RateLimitError | NetworkError | ParseError | ServerError`. Cada uno con mensaje user-facing.

### 3.5 Fixes de bugs detectados

- **Bug theme prefix** (`theme.ts` vs `index.html:23`): unificar a `stt_theme`. Script anti-flash lee `localStorage.getItem('stt_theme')`.
- **Cleanup incompleto en `unload`** (`main.ts:123`): añadir `visualizer.stop()`, `timer.dispose()`, `bus.clear()`, guardar referencia al listener `resize` para removerlo.
- **`main()` sin error handler global:** envolver en `try/catch`, añadir `window.addEventListener('error', ...)` y `unhandledrejection`. Renderizar toast o pantalla de error si el bootstrap falla.
- **`recorder.ts` sin guard `navigator.mediaDevices`:** throw tipado `MicNotSupportedError` si no existe.
- **`SECURITY.md` corregido:** documentar keychain como almacenamiento real, eliminar mención falsa de localStorage, documentar CSP, mencionar rotación.
- **`storage.ts` errores silenciosos:** distinguir `QuotaExceededError` de `SyntaxError` (JSON corrupto), loguear warning.
- **Inconsistencia keys storage:** eliminar `groq_api_key` sin prefijo, todo pasa por keychain.

### 3.6 Tests baseline (red de seguridad inmediata)

| Suite                | Tipo | Cubre                                                                                 |
| -------------------- | ---- | ------------------------------------------------------------------------------------- |
| `event-bus.test.ts`    | Unit | emit/on/off/clear, orden de listeners, error isolation, memory (off remueve ref)      |
| `storage.test.ts`      | Unit | load/save/remove, prefix `stt_`, quota error, JSON corrupto, SSR guard (no `window`)  |
| `history-repo.test.ts` | Unit | add/get/remove/clear, FIFO eviction a límite 100, schema inválido, idempotencia       |
| `settings.test.ts`     | Unit | parseo de DOM → TranscriptionOptions, clamp temperature [0,1], defaults               |
| `time-ago.test.ts`     | Unit | ahora, minutos, horas, días, fecha, edge cases (timestamp futuro)                     |
| `os-detect.test.ts`    | Unit | user agents Windows/macOS/Linux/iOS/Android                                           |
| `groq-client.test.ts`  | Unit | buildFormData, parseResponse, mapeo de errores HTTP, retry logic con fetch mock (msw) |

- **Stack:** Vitest + @testing-library/dom + msw (mock service worker) para HTTP.
- **Meta:** 100% cobertura sobre módulos puros. CI corre tests en cada PR.

### 3.7 Audit de dependencias

- **Spike TS 6.0.2 vs typescript-eslint 8.x (1h):** confirmar compatibilidad; los `as any` son síntoma. Si fricción real, downgrade a TS 5.6 estable. Documentar decisión.
- **Unificar npm → pnpm** (lockfile `pnpm-lock.yaml` ya existe, pero README y CI usan npm hoy). Unificar a pnpm en toda la documentación y CI.
- `pnpm audit` + `pnpm outdated` en cada fase.
- Renovar badges del README (hoy mienten: dicen TS 5.x/Vite 6.x, realidad TS 6.x/Vite 8.x).

### 3.8 Criterio de salida de Fase 1

- `pnpm tauri build` produce instaladores firmables para Windows y macOS.
- API key nunca toca el bundle JS (verificado con `grep -rn 'VITE_GROQ' dist/` → vacío).
- `tsc --noEmit` pasa con `strict:true`.
- Cobertura > 90% en módulos puros.
- CI verde: lint + typecheck + test + build.
- `SECURITY.md` corregido y auditado.

---

## 4. Fase 2 — UI Pulida (OUTLINE, se detalla al llegar)

### 4.1 Onboarding de API key
Modal no-bloqueante multi-paso (bienvenida → cómo obtener key → input + validar cliente `^gsk_[A-Za-z0-9]{40,}$` + validar servidor ping `/models` → confirmación). `role="dialog"`, `aria-modal="true"`, foco trapado, Esc para cerrar. Nuevo módulo `src/ui/onboarding-modal.ts`.

### 4.2 Settings page (reemplaza settings dispersos)
Drawer lateral con secciones: Transcripción (modelo, idioma, formato, temperature slider, translate, verbose), Grabación (modo, silencio threshold/duration, atajo), Audio (Fase 3), API key (estado, cambiar, eliminar), Apariencia (tema, idioma UI para preparar i18n), Datos (export/import/limpiar historial). Persistencia via `saveSettings()` del bridge Rust. Nuevo módulo `src/ui/settings-drawer.ts`.

### 4.3 Diálogos no-bloqueantes
Reemplazar `confirm()` en `sidebar.ts:102` con `ConfirmDialog` modal asíncrono `Promise<boolean>`. Reutilizable: `confirmDialog({ title, message, confirmLabel, danger })`. Nuevo módulo `src/ui/confirm-dialog.ts`. `grep -rn 'prompt(\|confirm(' src/` debe dar 0.

### 4.4 Feedback de estados
Extender `StatusUpdate` con `phase: 'idle'|'recording'|'processing'|'error'|'needs-key'|'needs-mic'`. Overlay procesando con botón Cancelar (abort controller Fase 1). Toast con tipo de error + CTA "Reintentar"/"Abrir Settings". Empty states persistentes para needs-key y needs-mic.

### 4.5 Accesibilidad WCAG AA
- `<label for="output" class="sr-only">Transcripción</label>` para textarea.
- Toast `setAttribute('aria-live','polite')` + `role="status"`.
- `role="main"`, `role="complementary"` sidebar, `role="toolbar"`.
- `:focus-visible` ring consistente (token `--focus-ring`).
- Auditoría `@axe-core/playwright` en CI (0 violaciones serious/critical).
- Respetar `prefers-reduced-motion` en `style.css` (hoy declarado pero no implementado).
- Página `?` help overlay con tabla de atajos OS-aware.

### 4.6 Auto-update y PWA-like
Tauri updater plugin: firma releases, auto-update silencioso con notificación. Versión visible en settings, changelog modal tras update.

### 4.7 Self-host fonts + CSP estricta
Eliminar Google Fonts de `index.html`. Bundlizar Inter + JetBrains Mono en `public/fonts/` con `@font-face`. CSP: `default-src 'self'; script-src 'self'; style-src 'self'` (investigar nonce para Tailwind 4 en Fase 1 — si Tailwind 4 precompila sin inline styles, target estricto; fallback nonce documentado), `connect-src 'self' https://api.groq.com`, `img-src 'self' data:`.

### 4.8 Criterio de salida Fase 2
- Onboarding funcional, sin `prompt()` en código.
- Settings drawer con todas las secciones.
- axe-core 0 violaciones serious/critical.
- Estados visuales cubren los 6 phases.
- CSP en `tauri.conf.json` sin `unsafe-inline` (o nonce documentado).
- Fonts self-hosted, sin requests third-party en runtime.

---

## 5. Fase 3 — Features Pro (OUTLINE, se detalla al llegar)

### 5.1 Exportación multi-formato
- `.txt` (existe), `.md` (notas), `.json` (re-import/integraciones), `.srt` (subtítulos video), `.vtt` (web video).
- `src/exporters/` con un módulo por formato. Interfaz común `Exporter.export(result, options): Blob | string`.
- Diálogo nativo `dialog.save()` del SO vía bridge. Filename default `transcripcion-YYYYMMDD-HHmm.<ext>`.
- Tests unitarios estrictos para timestamps SRT/VTT.

### 5.2 Atajos configurables
- Settings → "Atajos". Cada acción mapeable (start/stop toggle, push-to-talk, copiar, limpiar, abrir settings).
- Captura de tecla: input "Pulsa una combinación".
- Persistencia en settings file. Conflict detection (dos acciones con mismo combo → feedback).
- **Defaults sin conflicto:** toggle = `Cmd/Ctrl+Shift+R`, push-to-talk = `hold Cmd/Ctrl+Space`.
- `keyboard.ts` refactor a data-driven (`ShortcutConfig` en lugar de constantes hardcodeadas).

### 5.3 Dictado continuo (streaming)
Groq no tiene WebSocket oficial para Whisper. Dos caminos:
1. **Chunked upload (recomendado Fase 3):** grabar en blobs de N segundos, transcribir incrementalmente, concatenar texto con smoothing. Robusto, latencia ~N segundos.
2. **VAD-based streaming:** Voice Activity Detection local (Web Audio RMS) dispara chunks al parar de hablar. Latencia baja, más complejo.

Decisión: **(1) chunked con VAD soft** — combina robustez y latencia razonable. Nuevo módulo `src/audio/streaming-recorder.ts` que extiende `Recorder` con modo continuo. UI: toggle "Dictado continuo" en settings.

### 5.4 VAD y filtros avanzados
`AudioAnalyzer` ya hace detección de silencio básica. Exponer en settings: silence threshold (dB, -80 a -20), silence duration (ms, 300-3000), min recording duration (descarta golpes accidentales). Filtros Web Audio opcionales: high-pass filter (rumble), noise gate. Nuevo módulo `src/audio/filters.ts` con nodos encadenables.

### 5.5 Búsqueda en historial
Sidebar header con input search. Filtra por texto, idioma, modelo, fecha. Resaltado de match con `<mark>` (textContent-safe). Atajo `Cmd/Ctrl+F` abre search.

### 5.6 Tags y colecciones
Cada `HistoryEntry` gana `tags: string[]`. UI: chip input al guardar/editar. Filtrado por tag en sidebar. Autocompletado de tags existentes (datalist).

### 5.7 Criterio de salida Fase 3
- Los 5 formatos exportan correctamente (tests + manual).
- Atajos configurables con conflict detection.
- Dictado continuo funcional con latencia < 5s.
- VAD configurable.
- Búsqueda + tags operativos.
- E2E tests con Playwright cubren flujos críticos.

---

## 6. Testing, CI y Seguridad (transversal)

### 6.1 Pirámide de tests

```
        ┌───────────┐
        │   E2E     │  Playwright (Fase 2+) — flujos críticos: onboarding, grabar, exportar, settings
        ├───────────┤
        │ Integración│  Vitest + jsdom — módulos DOM: renderer, sidebar, settings-drawer
        ├───────────┤
        │   Unit     │  Vitest — lógica pura: event-bus, storage, history-repo, exporters, groq-client, settings
        └───────────┘
```

| Capa        | Stack                                    | Cuándo entra                              |
| ----------- | ---------------------------------------- | ----------------------------------------- |
| Unit        | Vitest                                   | Fase 1 (baseline) + incremental cada fase |
| Integración | Vitest + jsdom + @testing-library/dom    | Fase 2 (cuando UI se estabiliza)          |
| E2E         | Playwright + Tauri WebDriver             | Fase 2 final + Fase 3                     |
| A11y        | @axe-core/playwright                     | Fase 2                                    |

### 6.2 CI/CD (pnpm unificado)

```yaml
jobs:
  quality:
    - checkout
    - setup pnpm@9 + node 20 + cache
    - pnpm install --frozen-lockfile
    - pnpm lint           # eslint
    - pnpm typecheck      # tsc --noEmit
    - pnpm test           # vitest run + coverage report
    - pnpm test:a11y      # axe-core (Fase 2+)
    - pnpm audit --prod   # CVEs
    - pnpm build          # vite build (frontend)
  desktop-build (Fase 1+):
    - matrix: [windows-latest, macos-latest]
    - rustup toolchain stable
    - pnpm tauri build
    - upload artifacts (.msi/.exe, .dmg)
```

- Pre-commit (husky, ya existe): lint-staged (formatea + eslint staged).
- Pre-push: typecheck + unit tests.
- Release: tag → build → firma → GitHub Release con instaladores + changelog auto-generado (via **changesets**).

### 6.3 Validación de seguridad (transversal)

| Control                                  | Cuándo                                            |
| ---------------------------------------- | ------------------------------------------------- |
| `grep -rn 'VITE_GROQ' dist/` = vacío     | Pre-release Fase 1 (key nunca llega al bundle)    |
| `grep -rn 'innerHTML' src/` = solo trusted | Cada PR                                           |
| `pnpm audit` limpio (o triaged)          | Cada PR + semanal                                 |
| CSP reportes en dev                      | Fase 2                                            |
| Rotación de la key leakada documentada   | Pre-merge Fase 1                                  |
| `SECURITY.md` revisado cada fase         | Cada release                                      |
| Threat model STRIDE básico               | Fase 1 doc                                        |
| `gitleaks` pre-commit                    | Fase 1                                            |

### 6.4 Documentación

- **README reescrito:** sección desktop (build Windows/macOS, requisitos Rust), sección dev (pnpm install, pnpm tauri dev), badges correctos (TS, Vite, Tauri, Tailwind versiones reales).
- **CONTRIBUTING** (existe en `.adoc`): añadir cómo añadir tests, cómo añadir un exporter, cómo añadir un módulo Tauri command.
- **ARCHITECTURE.md** nuevo: diagrama actualizado con Tauri, descripción del bridge, reglas "qué vive dónde".
- **CHANGELOG.md** generado con changesets.

---

## 7. Métricas de éxito

| Métrica                          | Target Fase final    |
| -------------------------------- | -------------------- |
| Cobertura unit (módulos puros)   | > 90%                |
| Violaciones axe serious/critical | 0                    |
| Tamaño binario Windows (.msi)    | < 15 MB (meta Tauri) |
| Tiempo cold start                | < 1.5s               |
| Latencia dictado continuo        | < 5s (chunked)       |
| `pnpm audit` high/critical CVEs  | 0 sin triage         |

---

## 8. Apéndice: Auditoría actual del repo

### Crítico

1. **API key de Groq real en `.env` local** (`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`). No commiteada (`.gitignore` la excluye, `git ls-files` confirma), pero existe en plaintext en disco. **Rotar inmediatamente.**
2. **Diseño inseguro para deploy:** `VITE_GROQ_API_KEY` se incrusta en el bundle JS. Resuelto por arquitectura Tauri (Fase 1).
3. **Ausencia de `strict: true` en `tsconfig.json`.** Resuelto en Fase 1.

### Alto

4. Fetch sin `AbortController`/timeout (`groq-client.ts:73`).
5. Sin retry/backoff en 429.
6. `SECURITY.md` miente (afirma `localStorage`, realidad `sessionStorage`).
7. `main()` sin manejo global de errores.
8. Cero tests.
9. Bug de theme prefix (`index.html:23` lee `localStorage.getItem('theme')`, pero `theme.ts` guarda con prefijo `stt_`).
10. Cleanup incompleto en `unload` (`main.ts:123`).

### Medio

11. `prompt()` sincrónico en constructor de `GroqClient` (`groq-client.ts:176`).
12. `confirm()` en `sidebar.ts:102`.
13. Inconsistencia de keys de storage (`stt_` vs `groq_api_key` sin prefijo).
14. Stack bleeding-edge (TS 6.0.2 + Vite 8 + ESLint 10 + Tailwind 4) con fricción documentada (`as any` en `audio-analyzer.ts:127`, `waveform-visualizer.ts`).
15. `storage.ts` traga errores silenciosamente (sin distinguir quota de JSON corrupto).
16. `history-repo.addEntry` evicción O(n²).
17. Fuentes externas Google Fonts (fingerprinting, render-block).
18. `crypto.randomUUID()` requiere secure context.
19. `navigator.mediaDevices` sin guard (`recorder.ts:50`).
20. `prefers-reduced-motion` declarado pero no implementado en `style.css`.

### Bajo

21. `Uint8Array as any` workaround TS 6.0 (2 archivos).
22. `.line-clamp-3` redundante (Tailwind 4 ya lo provee).
23. `aria-live="polite"` mencionado en `toast.ts` pero no seteado en runtime.
24. `<textarea id="output">` sin `<label for>`.
25. Sin `.env.example`.
26. CI no cachea `node_modules`, usa npm (repo tiene pnpm-lock).
27. Sin PWA.
28. `EventBus.emit` sincrónico (aceptable, documentar).
29. `recording-timer.ts` sin `dispose()`.
30. `audio-analyzer.ts` campo `animationFrame` muerto.

Todos los ítems críticos y altos se resuelven en Fase 1-2.

---

## Referencias

- Tauri docs: https://tauri.app/
- Tauri keyring plugin: https://v2.tauri.app/plugin/keyring/
- Groq Whisper API: https://console.groq.com/docs/speech-text
- Vitest: https://vitest.dev/
- msw: https://mswjs.io/
- Zod: https://zod.dev/
- Changesets: https://github.com/changesets/changesets
