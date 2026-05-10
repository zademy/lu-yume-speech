# Plan de Mejora — Speech-to-Text con Groq

## Objetivo

Transformar la app de un prototype funcional en una herramienta de dictado pulida, modular y rica en features, explotando al máximo la API de Groq Whisper y las capacidades del navegador.

---

## Fase 1: Arquitectura Modular ⬜

**Estado:** `pending`

La app actual es un solo archivo `main.ts` con HTML inline. Refactorizar a módulos.

### Tareas

- [ ] Crear estructura de carpetas:
  ```
  src/
    main.ts            — entry point, inicialización
    ui/
      app.ts           — layout principal, render
      status.ts        — componente de estado
      settings.ts      — panel de configuración
      history.ts       — historial de transcripciones
    audio/
      recorder.ts      — grabación, MediaRecorder wrapper
      visualizer.ts    — visualización de onda de audio
    api/
      groq.ts          — cliente Groq, tipos, transcripción
      rate-limit.ts    — tracker de rate limits
    utils/
      os-detect.ts     — detección de OS
      clipboard.ts     — helpers de portapapeles
      storage.ts       — localStorage/sessionStorage wrapper
    types.ts           — tipos compartidos
  ```
- [ ] Separar HTML a un template function por componente
- [ ] Extraer lógica de API a módulo dedicado
- [ ] Extraer lógica de audio a módulo dedicado

### Criterio de éxito

`pnpm dev` funciona igual que antes, pero el código está modularizado.

---

## Fase 2: Exploar la API de Groq al Máximo ⬜

**Estado:** `pending`

La API de Groq Whisper soporta muchos parámetros que no estamos usando.

### 2.1 Parámetros de transcripción

- [ ] `language` — Selector de idioma (es, en, fr, de, pt, etc.). Mejora accuracy + latencia.
- [ ] `prompt` — Campo para dar contexto al modelo (hasta 224 tokens). Ej: terminología técnica, nombres propios.
- [ ] `response_format: "verbose_json"` — Recibir timestamps y metadata.
- [ ] `timestamp_granularities: ["word", "segment"]` — Timestamps por palabra y segmento.
- [ ] `temperature` — Control de aleatoriedad (0 = determinista).

### 2.2 Endpoint de traducción

- [ ] Integrar `POST /v1/audio/translations` — Traduce audio de cualquier idioma a inglés.
- [ ] Toggle "Transcribir" vs "Traducir al inglés" en la UI.

### 2.3 Metadata enriquecida

- [ ] Mostrar duración del audio procesado.
- [ ] Mostrar idioma detectado (cuando no se especifica).
- [ ] Mostrar confianza (avg_logprob por segmento).
- [ ] Vista de segmentos con timestamps.

### Criterio de éxito

El usuario puede elegir idioma, dar contexto al prompt, ver timestamps por palabra, y traducir audio.

---

## Fase 3: Mejoras de Audio ⬜

**Estado:** `pending`

### 3.1 Calidad de grabación

- [ ] Configurar `MediaTrackConstraints` para mejor calidad:
  - `echoCancellation: true`
  - `noiseSuppression: true`
  - `autoGainControl: true`
  - `sampleRate: 48000`
- [ ] Opción de seleccionar dispositivo de entrada (si hay múltiples micrófonos).
- [ ] Formato de audio: evaluar `audio/webm;codecs=opus` vs `audio/wav`.

### 3.2 Visualización en tiempo real

- [ ] Canvas con forma de onda (waveform) durante grabación.
- [ ] Indicador visual de volumen/nivel de audio.
- [ ] Timer mostrando duración de la grabación activa.

### 3.3 Modo de grabación

- [ ] **Push-to-talk** (actual) — mantener teclas.
- [ ] **Toggle mode** — presionar para iniciar, presionar para detener.
- [ ] **Detección de silencio** — parar automáticamente tras X segundos de silencio (usando Web Audio API AnalyserNode).

### Criterio de éxito

El usuario ve la onda de audio mientras graba, puede elegir modo toggle, y la calidad de audio es óptima.

---

## Fase 4: UX/UI Pulida ⬜

**Estado:** `pending`

### 4.1 Panel de configuración

- [ ] Sección colapsable "⚙️ Configuración" con:
  - Modelo (whisper-large-v3 / turbo)
  - Idioma (auto-detect / selector)
  - Modo de grabación (push-to-talk / toggle / auto-silencio)
  - Prompt de contexto (textarea)
  - Temperatura (slider 0-1)
  - Auto-copiar al portapapeles (toggle)
  - Formato de respuesta (texto / JSON verboso)

### 4.2 Historial de transcripciones

- [ ] Almacenar transcripciones en `localStorage`.
- [ ] Lista de transcripciones previas con fecha/hora.
- [ ] Click para restaurar una transcripción anterior.
- [ ] Botón para eliminar entradas del historial.
- [ ] Búsqueda dentro del historial.

### 4.3 Editor de texto mejorado

- [ ] Toolbar sobre el textarea:
  - Copiar todo el texto
  - Limpiar texto
  - Descargar como .txt
  - Contador de palabras/caracteres
- [ ] Textarea auto-resize (crece con el contenido).

### 4.4 Dark mode

- [ ] Toggle dark/light mode.
- [ ] Respetar `prefers-color-scheme` del sistema.
- [ ] Persistir preferencia en localStorage.

### 4.5 Feedback visual

- [ ] Animación de pulso durante grabación (ya existe, mejorar).
- [ ] Indicador de rate limit restante.
- [ ] Toast notifications para feedback (éxito, error, warning).
- [ ] Spinner/skeleton durante procesamiento.

### Criterio de éxito

La app se siente como un producto, no como un prototype.

---

## Fase 5: Funcionalidades Avanzadas ⬜

**Estado:** `pending`

### 5.1 Rate limit tracker

- [ ] Contador de requests en la sesión actual.
- [ ] Estimación de remaining requests/min y requests/día.
- [ ] Warning visual al acercarse a los límites.
- [ ] Cola de requests (si se hacen múltiples grabaciones rápidas).

### 5.2 Persistencia de configuración

- [ ] Guardar todas las preferencias en localStorage:
  - Modelo seleccionado
  - Idioma
  - Prompt de contexto
  - Temperatura
  - Modo de grabación
  - Theme (dark/light)
- [ ] Restaurar preferencias al cargar la app.

### 5.3 Carga de archivos de audio

- [ ] Input para subir archivos de audio (drag & drop + file picker).
- [ ] Soporte para: FLAC, MP3, MP4, WAV, OGG, M4A, WEBM, MPEG.
- [ ] Transcripción de archivos locales sin grabación.
- [ ] Preview del archivo antes de enviar.

### 5.4 Atajos de teclado extendidos

- [ ] `⌥/Ctrl + Space` — Grabar (push-to-talk)
- [ ] `⌥/Ctrl + Space` — Toggle grabación (toggle mode)
- [ ] `Ctrl+Shift+C` — Copiar todo el texto
- [ ] `Ctrl+Shift+X` — Limpiar texto
- [ ] `Ctrl+Shift+H` — Toggle historial
- [ ] `Ctrl+Shift+S` — Toggle configuración
- [ ] Cheat sheet de atajos visible en la UI.

### 5.5 Exportación

- [ ] Descargar texto como `.txt`.
- [ ] Descargar transcripción con timestamps como `.srt` (subtítulos).
- [ ] Descargar transcripción con timestamps como `.vtt` (WebVTT).
- [ ] Copiar como markdown.

### Criterio de éxito

La app tiene features que la distinguen de una simple demo.

---

## Fase 6: Calidad y Robustez ⬜

**Estado:** `pending`

### 6.1 Manejo de errores

- [ ] Errores de red (offline, timeout) con retry manual.
- [ ] Rate limit exceeded — mostrar cuándo reintentar.
- [ ] API key inválida — mensaje claro con link a console.groq.com.
- [ ] Micrófono no disponible — fallback con instrucciones.
- [ ] Archivo de audio muy largo — warning antes de enviar.

### 6.2 Accesibilidad

- [ ] ARIA labels en todos los controles.
- [ ] Navegación por teclado completa.
- [ ] Focus visible en todos los elementos interactivos.
- [ ] Screen reader friendly.

### 6.3 PWA (Progressive Web App)

- [ ] `manifest.json` con iconos.
- [ ] Service worker para cachear assets.
- [ ] Instalable como app en desktop y móvil.
- [ ] Offline: UI cargada, transcripción no (requiere API).

### 6.4 Testing

- [ ] Unit tests para `groq.ts` (mock fetch).
- [ ] Unit tests para `storage.ts`.
- [ ] Unit tests para `os-detect.ts`.
- [ ] Integration test básico con Vitest.

### Criterio de éxito

La app es robusta, accesible, instalable, y tiene tests.

---

## Orden de Ejecución Sugerido

```
Fase 1 (Arquitectura) → Fase 2 (API features) → Fase 3 (Audio)
    → Fase 4 (UI/UX) → Fase 5 (Avanzado) → Fase 6 (Calidad)
```

Cada fase debe dejar la app funcional. No avanzar a la siguiente sin validar.

---

## Errores Encontrados

| Error         | Intento | Resolución |
| ------------- | ------- | ---------- |
| (ninguno aún) |         |            |

---

## Notas

- Mantener 0 dependencias runtime. Solo dev deps (Vite, TypeScript).
- Tailwind via CDN es aceptable para este proyecto.
- Todas las features deben funcionar sin backend propio.
- La API key NUNCA debe estar en el código fuente.
