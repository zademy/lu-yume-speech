# Adapter para proveedores de transcripción

La app nació acoplada a la API de Groq Whisper (`GroqClient` con multipart + JSON). Al agregar el worker de Cloudflare Whisper descubrimos que el contrato HTTP es distinto (audio crudo en el body, `?lang=`, respuesta de texto plano sin metadatos), así que decidimos introducir una interfaz `TranscriptionProvider` (patrón Adapter) implementada por ambos clientes, con un registry simple en `main.ts` que elige el cliente según `AppSettings.transcriptionProvider`.

## Considered Options

- **Interface `TranscriptionProvider` + clientes independientes** (elegida): cada proveedor encapsula su contrato HTTP; agregar uno nuevo es una clase + una entrada en el registry. El tipo de petición compartido (`TranscriptionRequest`) lleva `mode` (transcribir/traducir); los proveedores que no soportan traducción la ignoran (la UI la deshabilita).
- **Generalizar `GroqClient` con flags**: rechazada — acumula contratos incompatibles en una clase y cada proveedor nuevo la degrada.
- **Failover automático entre proveedores**: rechazada — impredecible para el usuario; la activación es manual y explícita.

## Consequences

- El error tipado compartido se renombró `GroqError`/`GroqApiError` → `TranscriptionError`/`TranscriptionApiError` porque el worker también lo lanza.
- El worker no devuelve `language`/`duration`/`segments`; los metadatos de esas transcripciones quedan ausentes por diseño.
- Las funciones de IA sobre texto (LLM post-proceso, resúmenes, improve) siguen exigiendo la key de Groq aunque el proveedor activo sea el worker.
