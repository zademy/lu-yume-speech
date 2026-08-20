# Benchmark local (T8)

Cómo se miden y publican las etiquetas de precisión/velocidad de los modelos
locales de Whisper, sin telemetría: todo corre en el navegador del usuario y
solo se publican números agregados en este repositorio.

## Método

1. **Corpus versionado** (`scripts/benchmark/generate-corpus.sh`): 7 clips
   ES/EN generados con `say` de macOS (voces es-MX, es-ES, en-US, en-GB,
   en-AU, en-IN), algunos con ruido (~10 dB SNR) y duraciones variadas,
   normalizados a WAV PCM mono 16 kHz en `public/benchmark-corpus/`.
   `manifest.json` del corpus registra SHA-256, bytes y duraciones. La
   versión del corpus (`corpusVersion`) acompaña cada medición: un cambio
   de corpus invalida comparaciones directas.
2. **Diagnóstico in-app** (Ajustes → Motor local → *Diagnosticar*): en un
   worker dedicado se carga el modelo en frío (se cronometra), se
   transcriben los 7 clips contra el ground truth del corpus y se calcula
   WER por idioma y global, RTF (`inferenceSeconds / audioSeconds`) y pico
   de heap JS. Los resultados quedan en IndexedDB (`modelPerf`) y pueden
   exportarse como JSON (*Exportar*).
3. **Publicación**: las mediciones exportadas se pegan en
   `src/utils/benchmark/results.json` (`resultsVersion` + datos del
   dispositivo). El catálogo deriva las etiquetas de cada tarjeta desde
   ese manifest — ver "Regenerar" abajo.

La medición representativa por modelo es la de **WebGPU cuando existe, si
no la de WASM**, reflejando la política `auto` que usa la app por defecto.

## Umbrales públicos

Definidos en `src/utils/benchmark/thresholds.ts`:

| Etiqueta | Precisión (WER global) | Velocidad (RTF) |
| --- | --- | --- |
| `high` | ≤ 0.08 | — |
| `medium` | ≤ 0.20 | — |
| `low` | > 0.20 | — |
| `fast` | — | ≤ 0.5 |
| `balanced` | — | 0.5–1.5 |
| `slow` | — | ≥ 1.5 |

WER calculado con normalización estándar (minúsculas, sin puntuación)
sobre palabras; sustituciones + borrados + inserciones / referencia.

## Resultados publicados (v1)

Dispositivo: macOS, Chrome 151, WebGPU disponible, 16 GB RAM
(`measured` en `results.json` tiene el detalle completo).

| Modelo | Backend | WER ES | WER EN | WER global | RTF | Carga |
| --- | --- | --- | --- | --- | --- | --- |
| whisper-base | webgpu | 4.38 % | 1.47 % | 2.72 % | 0.059 | 1.4 s |
| whisper-base | wasm | 4.38 % | 1.47 % | 2.72 % | 0.323 | 1.1 s |
| whisper-small | webgpu | 1.52 % | 1.47 % | 1.49 % | 0.096 | 3.0 s |
| whisper-small | wasm | 1.52 % | 1.47 % | 1.49 % | 1.321 | 2.2 s |
| whisper-large-v3-turbo | webgpu | 1.52 % | 2.97 % | 2.35 % | 0.272 | 9.0 s |

Notas:

- `whisper-large-v3-turbo` **solo se publica con WebGPU**: el modelo
  requiere WebGPU por política (`backend-decision.ts`) y WASM no puede
  cargarlo. En el dispositivo de referencia la sesión de 762 MB tardó
  ~9 s en inicializar; tras varias corridas consecutivas una sesión nueva
  puede quedar colgada — recargar la página antes de re-medir.
- WER idéntico entre backends del mismo modelo: la transcripción
  determinista coincide; el backend afecta tiempo, no el texto.

## Regenerar

```sh
# 1. Regenerar el corpus (macOS con ffmpeg instalado)
./scripts/benchmark/generate-corpus.sh

# 2. Medir: pnpm dev → Ajustes → Motor local → descargar modelo → Diagnosticar
#    (repetir por backend cambiando #localBackendSelect; exportar JSON)

# 3. Publicar: volcar las mediciones exportadas en
#    src/utils/benchmark/results.json (bump resultsVersion, actualizar
#    measured) → las tarjetas derivan etiquetas automáticamente.

# 4. Verificar: pnpm test (benchmark-manifest.test valida el manifest)
```

## Limitaciones

- Corpus sintético de voces TTS + ruido artificial: no representa audio
  real de campo; sirve para comparar modelos/backends entre sí, no como
  cifra absoluta de calidad.
- Un solo dispositivo de referencia por publicación; el Diagnóstico
  in-app existe para que cada usuario mida el suyo.
- La primera carga de sesión WebGPU del modelo turbo puede demorar
  varios minutos si el GPU ya está saturado por corridas previas (ver
  nota arriba).
- Nada de esto mide audio del usuario: el corpus vive en el mismo origen
  (`public/benchmark-corpus/`) y el Diagnóstico no hace egreso de red
  (ver SECURITY.md).
