# Plan — Sidebar de Historial de Transcripciones

## Objetivo

Agregar un sidebar flotante a la izquierda de la app principal que muestre el historial de transcripciones pasadas. El sidebar debe ser colapsable, tener scroll controlado, diseño premium consistente con el design system actual, y persistir el historial en localStorage.

---

## Fase 1: Modelo de datos y persistencia ⬜

**Estado:** `pending`

### Tareas

- [ ] Definir interfaz `HistoryEntry` en `types.ts`:
  ```ts
  interface HistoryEntry {
    id: string; // crypto.randomUUID()
    text: string; // texto transcrito
    language?: string; // idioma detectado/especificado
    model: WhisperModel; // modelo usado
    duration?: number; // duración del audio en segundos
    createdAt: number; // timestamp Unix ms
    operationMode: OperationMode;
  }
  ```
- [ ] Agregar eventos al `EventMap`:
  - `'history:save'` — payload: `HistoryEntry`
  - `'history:delete'` — payload: `string` (id)
  - `'history:clear'` — payload: `void`
  - `'history:restore'` — payload: `string` (id)
  - `'history:updated'` — payload: `HistoryEntry[]` (notifica a sidebar)
- [ ] Crear `src/utils/history-repo.ts` — repositorio CRUD sobre localStorage:
  - `getAll(): HistoryEntry[]` — lee y ordena por `createdAt` desc
  - `save(entry: HistoryEntry): void` — agrega y persiste
  - `remove(id: string): void` — elimina una entrada
  - `clear(): void` — elimina todo el historial
  - Máximo 100 entries, FIFO cuando se excede
  - Usa el wrapper `storage.ts` existente

### Criterio de éxito

Tests manuales: guardar, leer, eliminar entradas desde la consola del browser.

---

## Fase 2: Layout responsive con sidebar ⬜

**Estado:** `pending`

### Tareas

- [ ] Modificar `renderer.ts` — cambiar layout de columna centrada a grid flex:

  ```
  Layout actual:
    body → #app → [app-shell max-w-xl mx-auto]

  Layout nuevo:
    body → #app → [flex row full-width]
                ├── [sidebar w-72 colapsable]  (izquierda)
                └── [app-shell flex-1 max-w-xl mx-auto] (centro)
  ```

- [ ] El sidebar es un `<aside>` con:
  - Header: título "Historial" + botón colapsar (chevron) + botón limpiar todo
  - Body: lista scrolleable de `HistoryEntry` cards
  - Empty state: ilustración/texto cuando no hay entradas
  - Footer: contador de entradas
- [ ] Agregar botón toggle en el header principal de la app (junto al theme toggle) para mostrar/ocultar el sidebar
- [ ] El sidebar se oculta en pantallas `< sm` (mobile) y se muestra como overlay/drawer
- [ ] Transición suave al colapsar/expandir (width transition)
- [ ] Actualizar `index.html` — agregar `class="min-h-screen"` al body si no existe

### Criterio de éxito

El layout se ajusta: sidebar visible a la izquierda, app centrada a la derecha. Sidebar colapsa con animación. Responsive en mobile.

---

## Fase 3: Componente HistoryCard ⬜

**Estado:** `pending`

### Tareas

- [ ] Crear `src/ui/history-card.ts` — render de una entrada individual:
  - Preview del texto (primeras 2 líneas truncadas con `line-clamp-2`)
  - Badge del idioma (ej: "ES", "EN") con color sutil
  - Badge del modelo ("turbo" / "v3")
  - Timestamp relativo ("hace 5 min", "ayer", "2 días")
  - Indicador de modo (transcribir/traducir) con ícono
  - Hover state: fondo sutil + botones de acción (restaurar, eliminar)
  - Click en la card → restaura el texto al textarea principal
- [ ] Crear `src/utils/time-ago.ts` — formateador de timestamps relativos:
  - `< 1 min` → "ahora"
  - `< 60 min` → "hace X min"
  - `< 24h` → "hace X h"
  - `< 7d` → "hace X días"
  - `>= 7d` → fecha formateada "10 may"
  - Función pura, sin side effects

### Criterio de éxito

Las cards se ven bien, el truncado funciona, los badges son legibles, hover muestra acciones.

---

## Fase 4: Sidebar completa con scroll y empty state ⬜

**Estado:** `pending`

### Tareas

- [ ] Crear `src/ui/sidebar.ts` — componente sidebar:
  - `renderSidebar(): SidebarElements` — construye el DOM
  - `populateEntries(entries: HistoryEntry[]): void` — renderiza las cards
  - Scroll virtual no necesario — max 100 entries con lazy render
  - `overflow-y-auto` con custom scrollbar (ya definida en style.css)
  - Máximo height: `calc(100vh - header height)`, sticky
  - Empty state cuando no hay historial: ícono de archivo + "Sin transcripciones"
  - Confirmación antes de "Limpiar todo" (usar toast con undo o confirm nativo)
- [ ] Agregar `SidebarElements` al interface de renderer:
  ```ts
  interface SidebarElements {
    root: HTMLElement; // <aside>
    list: HTMLElement; // contenedor de cards
    emptyState: HTMLElement; // mensaje vacío
    clearAllBtn: HTMLButtonElement;
    toggleBtn: HTMLButtonElement;
    countDisplay: HTMLElement;
  }
  ```
- [ ] Persistir estado de sidebar (abierto/cerrado) en localStorage

### Criterio de éxito

Sidebar funcional con scroll, empty state, botón limpiar con confirmación, 100+ entries sin lag.

---

## Fase 5: Integración con el pipeline de transcripción ⬜

**Estado:** `pending`

### Tareas

- [ ] En `main.ts` — cuando `transcription:success` se emite:
  1. Crear `HistoryEntry` con los datos del resultado
  2. Guardar via `history-repo.ts`
  3. Emitir `history:save` al bus
- [ ] En `main.ts` — wire eventos del sidebar:
  - `history:restore` → cargar texto en textarea + toast "Transcripción restaurada"
  - `history:delete` → eliminar entry del repo + actualizar sidebar
  - `history:clear` → limpiar todo el repo + actualizar sidebar
- [ ] En `main.ts` — subscribir sidebar a `history:updated` para re-render

### Criterio de éxito

Cada transcripción aparece en el sidebar. Click restaura el texto. Eliminar funciona. Limpiar funciona. Persiste entre reloads.

---

## Fase 6: Pulido visual y animaciones ⬜

**Estado:** `pending`

### Tareas

- [ ] Animación de entrada para nuevas cards (slide-in desde arriba)
- [ ] Animación de eliminación de cards (fade-out + collapse)
- [ ] Transición del sidebar (width 0 → 288px con ease)
- [ ] Botón toggle del sidebar en el header con ícono de panel (Lucide `panel-left`)
- [ ] Separador visual entre sidebar y contenido principal (border-right sutil)
- [ ] Responsive: sidebar como drawer en mobile con backdrop overlay
- [ ] Scroll shadow: sombra en el top del sidebar cuando hay scroll arriba

### Criterio de éxito

Animaciones suaves, no intrusivas. `prefers-reduced-motion` las desactiva. Sidebar se siente nativo.

---

## Estructura de archivos nueva

```
src/
  utils/
    history-repo.ts    ← CRUD sobre localStorage (Phase 1)
    time-ago.ts        ← Timestamp relativo (Phase 3)
  ui/
    sidebar.ts         ← Componente sidebar (Phase 4)
    history-card.ts    ← Card individual (Phase 3)
  types.ts             ← +HistoryEntry, +EventMap entries (Phase 1)
  ui/
    renderer.ts        ← Layout modificado (Phase 2)
  main.ts              ← Wiring (Phase 5)
  style.css            ← Animaciones (Phase 6)
```

## Archivos modificados

| Archivo                     | Fase | Cambio                               |
| --------------------------- | ---- | ------------------------------------ |
| `src/types.ts`              | 1    | +HistoryEntry, +eventos de historial |
| `src/utils/history-repo.ts` | 1    | Nuevo — repositorio CRUD             |
| `src/utils/time-ago.ts`     | 3    | Nuevo — formateador de tiempo        |
| `src/ui/renderer.ts`        | 2    | Layout flex con sidebar              |
| `src/ui/history-card.ts`    | 3    | Nuevo — card component               |
| `src/ui/sidebar.ts`         | 4    | Nuevo — sidebar component            |
| `src/main.ts`               | 5    | Wire historial al pipeline           |
| `src/style.css`             | 6    | Animaciones de sidebar               |

## Principios aplicados

- **SRP**: Cada archivo tiene una responsabilidad (history-repo = persistencia, history-card = render, sidebar = layout)
- **OCP**: Nuevos tipos de entrada se agregan extendiendo HistoryEntry
- **DIP**: Sidebar se comunica via EventBus, no importa directamente al groq-client
- **ISP**: Interfaces pequeñas — `HistoryEntry` es data pura, `SidebarElements` es DOM refs

## Orden de ejecución

```
Fase 1 (datos) → Fase 2 (layout) → Fase 3 (card) → Fase 4 (sidebar) → Fase 5 (integración) → Fase 6 (pulido)
```

Cada fase debe dejar la app compilando y funcionando.

---

## Errores Encontrados

| Error         | Intento | Resolución |
| ------------- | ------- | ---------- |
| (ninguno aún) |         |            |

---

## Notas

- Mantener 0 deps runtime
- localStorage límite ~5MB → 100 entries con texto promedio = ~200KB, seguro
- Sidebar toggle state se persiste en localStorage
- En mobile (< sm breakpoint) sidebar se comporta como drawer overlay
