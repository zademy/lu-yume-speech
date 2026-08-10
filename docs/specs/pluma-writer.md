# Spec — Pluma (writer's surface)

- **Status:** Draft (pending `to-tickets`)
- **Date:** 2026-08-10
- **Phase:** `to-spec` output, derived from the grill session of the same date
- **Supersedes:** none. **Related:** `docs/adr/0001-persistencia-indexeddb-dexie.md`

## 1. Problem

Today the app offers **Dictar**: voice → a flat, ephemeral transcript (copy or lose it). There is no
place to **accumulate, format, and refine** long-form text over time. A writer who brainstorms by
voice for long stretches has nowhere to land that material, shape it, and improve it.

**Pluma** is a persistent writing surface where the user:

1. Creates multiple **documents** ("escritos").
2. Dictates long-form; transcribed text **accumulates** as new blocks.
3. Edits with **rich formatting** (headings, lists, bold/italic, code, tables, images) using
   **Markdown** as the persistence format.
4. **Selects text → AI refines it** via Groq LLM.

All local. No backend. Network egress to `https://api.groq.com` only, consistent with `SECURITY.md`.

## 2. Goals / Non-goals

**Goals**

- New sidebar view **Pluma** (5th nav: Inicio · Dictar · Ajustes · Métricas · **Pluma**), coexists
  with Dictar (does not replace it).
- Multiple documents with create / open / rename / delete.
- Milkdown WYSIWYG editor with Markdown round-trip persistence in Dexie.
- Image paste-from-clipboard → persisted as Blob in Dexie (offline, no external host).
- Long-form dictation that appends a new paragraph block per transcription.
- Selection → floating star → Groq LLM "improve" → Accept/Reject.

**Non-goals (v1)**

- Real-time collaboration, sync, cloud.
- Multiple AI actions (only "improve" in v1; expandable later).
- Export formats beyond Markdown (HTML/PDF out of scope).
- Version history / diffs of documents (only `updatedAt`).

## 3. User stories

- **US1 — Start a draft:** From Pluma, "Nuevo escrito" → empty editor with placeholder → title field.
- **US2 — Brainstorm by voice:** Open a written → "Dictar" toggle inside Pluma → speak → transcribed
  text lands as a new paragraph at the end → stop. Repeat over a long session; blocks accumulate.
- **US3 — Format richly:** Toolbar (headings, bold/italic, lists, code, table, image) + keyboard
  shortcuts; content persists as Markdown, survives reload.
- **US4 — Paste a screenshot:** Cmd/Ctrl+V a clipboard image → it persists offline → renders on
  reload without depending on any external host.
- **US5 — Improve a passage:** Select a sentence → a star appears → click → Groq refines it → a
  popover shows the suggestion → Accept replaces the selection / Reject dismisses.
- **US6 — Manage documents:** List of escritos in a sidebar column; open, rename, delete (with
  confirmation).

## 4. Architecture

Invariants from `AGENTS.md` / `ARCHITECTURE.md` are preserved:

- **EventBus-only coupling** — new `escrito` module emits/listens; never imports siblings.
- **`src/main.ts`** is the sole composition root; it wires the Pluma module.
- **Platform seam unchanged** — API key / settings / theme stay in `localStorage`; Pluma does not
  touch credentials.
- **Dexie** for structured/persistent content (consistent with ADR 0001).
- **GroqClient** reused via DI for the AI-improve action and the dictation transcription.
- **No new network egress.** Only `api.groq.com`.

New module layout (proposed):

```
src/escritos/
  escritos-db.ts        Dexie store + CRUD (mirrors recordings-db.ts pattern)
  escritos-ui.ts        Pluma view: document list + editor mount + toolbar wiring
  improve.ts            AI selection-refine (GroqClient call + prompt)
src/i18n/translations.ts  +pluma.* keys (EN/ES)
src/types.ts            Escrito, ImagenEscrito types; new EventBus events
src/ui/renderer.ts      +plumaNavButton +renderPlumaView
src/main.ts             wire Pluma module (composition root only)
```

## 5. Data model

**Aggregate: Escrito**

```ts
interface Escrito {
  id: string;            // uuid
  titulo: string;
  contenidoMD: string;   // Markdown source (source of truth)
  createdAt: number;
  updatedAt: number;
}
```

**Aggregate: ImagenEscrito**

```ts
interface ImagenEscrito {
  id: string;            // uuid; referenced in MD as ![alt](app-image:<id>)
  escritoId: string;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}
```

Dexie stores: `escritos` (keyPath `id`), `imagenes` (keyPath `id`, index `escritoId`).

## 6. Milkdown integration

**Packages (vanilla TS, MIT):** `@milkdown/kit` (+ `@milkdown/theme-nord` or a custom theme aligned
to app tokens). **Decision pending:** batteries-included **Crepe** (`@milkdown/crepe`, ~447KB gz,
fastest) vs **composed** (`core + commonmark + gfm + history + listener + upload`, ~140–160KB gz,
leaner). **Recommendation:** composed for bundle discipline; revisit if integration cost is high.

**Editor lifecycle**

- Mount: `Editor.make().use(commonmark).use(gfm).use(history).use(listener).use(upload).create()`
  into a container element under the Pluma view.
- Load: `defaultValue: escrito.contenidoMD` on init.
- Autosave: `listenerCtx.markdownUpdated((ctx, md, prev) => if (md !== prev) debouncedSave(md))`.
- Read on demand: `editor.action(getMarkdown())`.

**Image persistence (paste/drop)**

- Custom `uploader` in `@milkdown/kit/plugin/upload`: intercept `File`, persist as `ImagenEscrito`
  (Blob → Dexie), return ProseMirror image node with `src = 'app-image:' + id`.
- **Render resolution (design point):** a custom image node-view resolves `app-image:<id>` →
  `URL.createObjectURL(blob)` on mount, revoke on destroy. This keeps images offline and reload-safe.

**AI selection-refine**

- On selection change (non-empty), show a floating star near the selection.
- On click: `editor.action(getMarkdown({ from, to }))` → `improve(text)` (Groq LLM, dedicated system
  prompt) → popover with suggestion → Accept replaces the range (ProseMirror transaction),
  Reject dismisses.
- Reuse `GroqClient` (DI from `main.ts`); new "improve" system prompt, no new egress.

**Dictation append**

- Reuse the existing capture + Groq transcription pipeline (TranscriptionSession). In Pluma, on
  `transcription:success`, instead of writing the output textarea, append the text as a new paragraph
  block at the end of the editor (Milkdown `insertAll`/command at doc end).
- Inherits `AppSettings` (model, language, operationMode, LLM post-process toggles). No separate
  voice settings for Pluma.

**Theme**

- Editor theme must follow the app's light/dark tokens (`--color-surface`, `--color-text-primary`,
  …). Either adopt `@milkdown/theme-nord` or provide a minimal custom theme CSS overriding
  ProseMirror + Milkdown classes to the app's design tokens.

## 7. i18n

All Pluma strings go through `data-i18n` (renderer) and `translate()` (dynamic), EN/ES, default EN.
Keys under `pluma.*` (nav label, headings, empty states, "Nuevo escrito", dictation toggle,
improve-popover actions, delete confirmation, etc.).

## 8. Constraints & risks

- **Bundle size:** Milkdown composed ~150KB gz; must not regress the build budget. Verify with
  `pnpm build` (dist size) during implementation.
- **Markdown fidelity:** Milkdown's round-trip is clean by design (remark); verify tables + images
  survive a save/reload cycle in tests.
- **`app-image:` resolver** is the trickiest integration — flagged as a design point; an alternative
  is embedding data-URIs (rejected: bloats the doc and memory).
- **No backend / egress:** the AI-improve prompt must contain only the selected text; no document
  context is sent unless explicitly decided later (privacy).
- **Coverage gate:** 90% lines/functions/statements, 80% branches (CI-enforced).

## 9. Open decisions (resolve before/within `to-tickets`)

1. Crepe vs composed Milkdown build (recommend composed).
2. Custom image node-view vs alternative resolver.
3. Theme: Nord vs custom-token-aligned.
4. Where the dictation toggle lives (inside the editor toolbar vs a Pluma status bar).
5. Autosave debounce interval (recommend 800ms).
6. Empty-state behavior (create-on-first-keystroke vs explicit "Nuevo escrito").

## 10. Tracer-bullet tickets (for `to-tickets`)

1. **Pluma shell + store:** nav view + `escritos-db.ts` (CRUD) + document list + create/delete.
2. **Milkdown editor:** mount composed editor + MD load/save + autosave + theme.
3. **Image paste:** custom uploader → Dexie blob → node-view resolver (offline, reload-safe).
4. **Dictation append:** reuse transcription pipeline → new paragraph at end.
5. **AI improve:** selection star + popover + Groq improve + Accept/Reject.
6. **i18n + a11y + tests** across the above.
