# Persistencia de datos estructurados en IndexedDB (Dexie)

**Status**: Accepted

## Decisión

Los datos estructurados del usuario —las Grabaciones (audio, transcripción, resúmenes y metadatos)— se persisten en **IndexedDB**, accedida vía **Dexie**. La API key de Groq, los ajustes (`settings`) y el tema se quedan en **localStorage**. No hay backend: la SPA sigue siendo el único extremo, con egreso de red únicamente a `https://api.groq.com`.

## Contexto

Necesitamos almacenar audios completos (sin tope predefinido), vincular cada audio con su transcripción y sus resúmenes como un agregado coherente (la Grabación), mostrar cuánto espacio se ocupa, y permitir depurar todo con una advertencia previa. localStorage no sirve para esto: tope de ~5MB, sin esquema relacional, sin transacciones. Había sobre la mesa traer SQLite al navegador; el panel de métricas invocaba además referencia a Wispr Flow.

## Opciones consideradas

- **SQLite-WASM (`sql.js` / `wa-sqlite`) sobre OPFS.** Rechazado: su única ventaja real sobre IndexedDB es SQL relacional con JOINs, y el modelo no lo necesita — todas las métricas del panel se derivan de un único agregado (Grabación). Suma un binario WASM (~1MB) y complejidad de persistencia que no se justifica.
- **Backend propio con archivo `.sqlite`.** Rechazado: rompe el invariante de producto “sin backend, egreso solo a Groq”; exigiría reescribir CSP, `SECURITY.md` y `AGENTS.md`.
- **Ampliar localStorage.** Rechazado por tope (~5MB) y falta de estructura/transacciones.
- **IndexedDB crudo (como ya hace hoy `audio-store.ts`).** Rechazado como base general: sin wrapper, las queries, índices y migraciones son verbosas y se duplican por módulo.
- **IndexedDB vía Dexie.** Aceptado.

## Consecuencias

- Nueva dependencia `dexie`. El antiguo `audio-store.ts`, `history-repo.ts` y `summary-repo.ts` se reemplazan por tres stores Dexie: `grabaciones` (metadata), `audios` (blobs, 1:1 con grabaciones) y `resumenes`. localStorage deja de guardar histórico y resúmenes.
- Los resúmenes **no** son hijos de la Grabación: se asocian al texto visible exacto (que puede provenir de varias grabaciones), preservando la semántica previa. El purge los borra igualmente por ser datos derivados del usuario.
- El seam `Platform` (API key + settings) **no cambia** de mecanismo: sigue en localStorage. La migración toca los repositorios de datos, no la plataforma.
- Se solicitará `navigator.storage.persist()` al guardar la primera Grabación para resistir la limpieza del navegador.
- El **Purge** borra Grabaciones (audio + transcripción) y Resúmenes; las credenciales, los ajustes y el tema se conservan, con advertencia modal previa.
- Las Métricas del panel se calculan al vuelo agregando Grabaciones; no se instrumenta `GroqClient` ni se almacenan eventos de telemetría. La WPM se muestra absoluta y como referencia frente al promedio humano (150–200 WPM), no como percentil (imposible sin backend).
- No se migran datos preexistentes: el schema Dexie arranca vacío (proyecto verde).
