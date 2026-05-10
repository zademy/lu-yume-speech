# Hallazgos — Sidebar de Historial

## Layout actual (renderer.ts)

```
#app (div)
  └── #app-shell (max-w-xl mx-auto p-4)
        ├── header (logo + theme toggle)
        ├── details.settings (colapsable)
        ├── status bar
        ├── waveform area
        ├── output section (toolbar + textarea + metadata)
        ├── footer
        └── toast container (fixed)
```

## Layout objetivo

```
#app (flex min-h-screen)
  ├── aside.sidebar (w-72 shrink-0 border-r)
  │     ├── header (título + actions)
  │     ├── scrollable cards list
  │     └── empty state
  └── main (flex-1)
        └── #app-shell (max-w-xl mx-auto p-4)
              └── (contenido actual sin cambios)
```

## Storage key

- Historial: `stt_history` — JSON array de HistoryEntry (max 100)
- Sidebar state: `stt_sidebar_open` — boolean

## Límites de localStorage

- ~5MB por origen
- 100 entries × ~2KB promedio = ~200KB — seguro
- FIFO: cuando se llega a 100, se elimina la más antigua

## Tailwind v4 breakpoints

- `sm:` 640px — drawer overlay
- `md:` 768px — sidebar inline

## Iconos Lucide necesarios

- `panel-left` — toggle sidebar
- `clock` — timestamp
- `languages` — modo traducir
- `rotate-ccw` — restaurar entry
- `file-text` — empty state
- `x` — cerrar sidebar en mobile
