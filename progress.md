# Progreso — Speech-to-Text

## Sesión 1 — 2026-05-10

### Completado

- [x] Análisis del estado actual del proyecto (Vite + TS template demo)
- [x] Reemplazo del template demo por la app de dictado
- [x] API key segura via Vite env vars (.env + .gitignore)
- [x] Detección de OS (Ctrl vs ⌥) para atajos de teclado
- [x] Investigación de la API de Groq (parámetros, endpoints, rate limits)
- [x] Creación del plan de mejora (6 fases)

### Fase 1: Arquitectura Modular — ✅ Completada

**Estructura final:**

```
src/
  main.ts              ← Composition root (wire modules via EventBus)
  types.ts             ← Shared types, interfaces, constants
  core/
    event-bus.ts       ← Typed pub/sub (DIP backbone)
  audio/
    recorder.ts        ← MediaRecorder wrapper (SRP: recording only)
  api/
    groq-client.ts     ← Groq Whisper API client (SRP: API only)
  ui/
    renderer.ts        ← DOM layout builder (SRP: structure only)
  utils/
    os-detect.ts       ← OS detection (SRP: platform info)
    storage.ts         ← localStorage wrapper (SRP: persistence)
    keyboard.ts        ← Shortcut manager (SRP: keyboard events)
    clipboard.ts       ← Clipboard helper (SRP: copy)
```

**Principios SOLID aplicados:**

- **SRP**: Cada módulo tiene una única razón de cambio
- **OCP**: Nuevos parámetros/feature se agregan sin tocar módulos existentes
- **DIP**: Todos los módulos dependen del EventBus (abstracción), no entre sí
- **ISP**: Interfaces pequeñas y enfocadas (AppElements, KeyboardActions, etc.)

**Verificaciones:**

- `tsc --noEmit` → 0 errores
- `vite dev` → arranca correctamente
- Funcionalidad idéntica a la versión monolítica

### Próximo paso

- Fase 2: Explotar la API de Groq (language, prompt, verbose_json, translations)

### Notas

- `erasableSyntaxOnly: true` → no parameter properties en constructores
- `verbatimModuleSyntax: true` → `import type` para type-only imports
- 0 deps runtime — mantener esta filosofía
