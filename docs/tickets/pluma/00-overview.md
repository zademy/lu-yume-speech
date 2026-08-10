# Pluma — Tracer-bullet tickets

- **Spec:** `docs/specs/pluma-writer.md`
- **Tracker:** none configured → tickets live here as self-contained sections. Each is sized for one
  fresh implementation session and declares its blocking edges.
- **Convention:** i18n (`pluma.*` keys, EN/ES, default EN) + a11y + unit tests (TDD at pre-agreed
  seams) are folded INTO every ticket — not a separate ticket. Coverage gate: 90% lines/statements/
  functions, 80% branches.

## Dependency DAG

```
T1 (shell + store) ──▶ T2 (Milkdown editor) ──┬─▶ T3 (image paste → blob)
                                              ├─▶ T4 (dictation append)
                                              └─▶ T5 (AI selection improve)
```

- **T3, T4, T5 are mutually independent** → parallelizable once T2 lands.
- Implement order: **T1 → T2 → (T3 ‖ T4 ‖ T5)**.
- Gate before declaring a ticket done: `pnpm lint && pnpm format:check && pnpm typecheck && pnpm test`.

---

## T1 — Pluma shell + escritos store

- **Blocked by:** — (foundation)
- **Blocks:** T2, T3, T4, T5

**Goal:** Add the **Pluma** nav view (5th: Inicio · Dictar · Ajustes · Métricas · **Pluma**) wired
through the composition root, plus the Dexie `escritos` store with full CRUD and a document list UI
(create / open / rename / delete with confirmation).

**Acceptance criteria**

- `src/escritos/escritos-db.ts` with Dexie stores `escritos` (keyPath `id`) and `imagenes`
  (keyPath `id`, index `escritoId`); CRUD: `create`, `getAll`, `getById`, `rename`, `updateContent`,
  `remove` (cascades its `imagenes`).
- `Escrito` / `ImagenEscrito` types in `src/types.ts`; new EventBus events `escrito:create |
  open | save | delete | list` in `EventMap`.
- `renderPlumaView` + `plumaNavButton` in `src/ui/renderer.ts`; navigation wired in `src/main.ts`
  (AppView += `pluma`; titles/views/buttons records; `data-open-view` handler).
- Document list column: title, `updatedAt`, open on click, rename (inline/double-click), delete with
  confirm dialog; empty state with "Nuevo escrito" CTA.
- All strings via `data-i18n`/`translate()` (`pluma.*`); unit tests for `escritos-db` (fake-indexeddb)
  + renderer presence + navigation.

**Out of scope:** the editor itself (T2), images, dictation, AI.

---

## T2 — Milkdown editor (mount, MD load/save, autosave, theme)

- **Blocked by:** T1
- **Blocks:** T3, T4, T5

**Goal:** Mount a composed Milkdown editor inside the open Escrito; load `contenidoMD` on open,
debounced autosave on change, theme aligned to app tokens.

**Acceptance criteria**

- Add `@milkdown/kit` (+ theme). **Decision (resolve here):** composed build
  (`core + commonmark + gfm + history + listener + upload`, ~150KB gz) over Crepe — verify dist size
  with `pnpm build` and that it stays within budget.
- `src/escritos/editor.ts`: `mountEditor(container, { initialMD, onChange }) → { destroy, getMarkdown, setMarkdown, replaceRange }`.
  Uses `Editor.make().use(commonmark).use(gfm).use(history).use(listener).use(upload).create()`.
- Load: `defaultValue = escrito.contenidoMD`. Autosave: `listenerCtx.markdownUpdated` → debounced
  **800ms** → `escritos-db.updateContent(id, md)` + emit `escrito:save`.
- `getMarkdown()` (utils macro) for on-demand save/export; `getMarkdown({from,to})` exposed for T5.
- Theme: ProseMirror CSS + a minimal theme overriding `.ProseMirror`/Milkdown classes to app tokens
  (`--color-surface`, `--color-text-primary`, `--color-border-subtle`); respects light/dark.
- Toolbar (headings, bold/italic, lists, code, table) — minimal, vanilla DOM, calls editor commands.
- i18n (`pluma.editor.*`); tests: editor mount/teardown, MD round-trip (setMD→getMD) with a table,
  autosave debounce fires once.

**Out of scope:** image persistence (T3), dictation (T4), AI (T5).

---

## T3 — Image paste → Dexie blob → offline render

- **Blocked by:** T2
- **Blocks:** —

**Goal:** Clipboard paste / drag-drop of images persists the Blob in Dexie (`imagenes`) and renders
offline across reloads via a stable `app-image:<id>` reference.

**Acceptance criteria**

- Custom `uploader` in `@milkdown/kit/plugin/upload`: intercept `File` → save `ImagenEscrito`
  (blob, mimeType, escritoId) → return ProseMirror image node with `src = 'app-image:' + id`.
- Custom **image node-view** resolves `app-image:<id>` → `URL.createObjectURL(blob)` on mount,
  `revokeObjectURL` on destroy. Survives reload (integration test: paste → reload → image renders).
- Markdown stores `![alt](app-image:<id>)` (portable, no external host).
- i18n (`pluma.image.*` — upload error toast); tests: uploader persists blob, node-view resolves +
  revokes, orphaned images cleaned on escrito delete (T1 cascade verified here end-to-end).

**Out of scope:** image editing/resizing UI (defer).

---

## T4 — Dictation append (long-form, new block at end)

- **Blocked by:** T2
- **Blocks:** —

**Goal:** A dictation toggle inside Pluma reuses the existing capture + Groq transcription pipeline;
on `transcription:success`, append the text as a **new paragraph block at the end** of the editor
(does not move the caret).

**Acceptance criteria**

- Dictation toggle (button in editor toolbar or Pluma status bar — **decision here**); reuses the
  audio capture + `GroqClient` + VAD/segmentation from the existing pipeline (no duplication).
- Inherits `AppSettings` (model, language, operationMode, LLM post-process toggles) — no separate
  voice settings for Pluma.
- On transcription:success → Milkdown command appends a new paragraph at doc end with the text;
  multi-segment sessions accumulate as separate blocks.
- Status/level + silence/timer events wired into Pluma status UI (i18n `pluma.dictation.*`).
- Tests: append-at-end ordering across multiple segments; inherits-settings wiring; no caret jump.

**Out of scope:** transcription quality tuning, transcription history of Pluma dictations (separate
from the existing Grabaciones history — decide later whether Pluma dictations create Grabaciones).

---

## T5 — AI selection improve (popover → Groq → Accept/Reject)

- **Blocked by:** T2
- **Blocks:** —

**Goal:** Select text in the editor → floating **star** appears → click → Groq LLM "improve" → popover
shows suggestion → Accept replaces the selection / Reject dismisses.

**Acceptance criteria**

- `src/escritos/improve.ts`: `improveSelection(text): Promise<string>` via `GroqClient` (DI from
  `main.ts`) with a dedicated "improve writing" system prompt. **Privacy:** only the selected text is
  sent (no surrounding doc context in v1).
- Selection-change listener in the editor; when non-empty, show a star positioned near the selection
  (vanilla popover; hidden on empty selection).
- On click: `editor.action(getMarkdown({from, to}))` → `improveSelection` → popover with the
  suggestion + Aceptar/Rechazar. Accept → ProseMirror transaction replaces the range; Reject → close.
- Loading + error states (toast via existing `showToast`); only "improve" action in v1 (extensible).
- i18n (`pluma.improve.*` — loading, error, accept, reject, star aria-label); tests: improve call
  mocked (MSW), Accept replaces range, Reject no-op, popover hidden on empty selection.

**Out of scope:** multiple AI actions (summarize/expand/correct), diff view, prompt customization UI.
