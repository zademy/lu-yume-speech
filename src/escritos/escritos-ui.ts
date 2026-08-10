/**
 * Pluma panel — document list + read-only preview for the Pluma writer's view.
 *
 * Pure DOM UI: receives an `Escrito[]` snapshot via `setEscritos()` and the
 * open document via `preview()`, and forwards user actions (select / rename /
 * remove) to callbacks from the composition root, which owns all persistence.
 * The "New escrito" affordance lives in the view heading (`#plumaNewButton`)
 * and is wired by `main.ts`.
 *
 * T1 scope: list + create/open(rename)/delete + a plain read-only preview.
 * T2 will replace the preview pane with a Milkdown Markdown editor.
 *
 * Language-aware: labels refresh through `setLanguage()`.
 *
 * SRP: this module only renders the Pluma UI and forwards user actions.
 */

import type { AppLanguage, Escrito } from '../types';
import { translate } from '../i18n/translations';

export interface PlumaHandlers {
  /** A row was clicked — composition root loads the escrito and calls `preview`. */
  onSelect: (id: string) => void;
  /** Inline rename committed by the user. */
  onRename: (id: string, titulo: string) => void;
  /** Delete requested (already confirmed by the panel). */
  onRemove: (id: string) => void;
}

export interface PlumaPanel {
  readonly root: HTMLElement;
  /** Right-hand section (permanent) — anchors floating affordances (T5 star). */
  readonly previewPane: HTMLElement;
  /** Editor mount point inside the pane — replaced on every doc swap. */
  readonly editorMount: HTMLElement;
  /** Status bar above the editor — owns the dictation toggle (T4). */
  readonly statusBar: HTMLElement;
  setEscritos: (list: Escrito[]) => void;
  /** Show one escrito in the preview pane (undefined clears it). */
  preview: (escrito: Escrito | undefined) => void;
  setLanguage: (lang: AppLanguage) => void;
}

const ROW_BASE = 'pluma-row';
const SELECTED = 'is-selected';

/** Build the Pluma panel. */
export function createPlumaPanel(handlers: PlumaHandlers, lang: AppLanguage): PlumaPanel {
  let currentLang: AppLanguage = lang;
  let selectedId: string | null = null;
  let escritos: Escrito[] = [];

  const root = document.createElement('div');
  root.className = 'pluma-panel grid gap-3 md:grid-cols-[minmax(0,280px)_1fr]';
  root.setAttribute('aria-label', translate(currentLang, 'pluma.title'));

  // --- List column ---
  const listCol = document.createElement('section');
  listCol.className =
    'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] flex flex-col';
  const listHeader = document.createElement('header');
  listHeader.className =
    'flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--color-border-subtle)]';
  const listTitle = document.createElement('span');
  listTitle.className = 'text-[11px] font-semibold text-[var(--color-text-muted)] tracking-wide';
  const listCount = document.createElement('span');
  listCount.className = 'count-badge';
  listHeader.appendChild(listTitle);
  listHeader.appendChild(listCount);

  const listScroll = document.createElement('div');
  listScroll.className = 'flex flex-col overflow-y-auto max-h-[60vh]';
  const emptyState = document.createElement('div');
  emptyState.className = 'empty-state';
  const emptyTitle = document.createElement('h4');
  const emptyBody = document.createElement('p');
  emptyState.appendChild(emptyTitle);
  emptyState.appendChild(emptyBody);

  listScroll.appendChild(emptyState);
  listCol.appendChild(listHeader);
  listCol.appendChild(listScroll);

  // --- Preview column ---
  const previewCol = document.createElement('section');
  previewCol.className =
    'rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 min-h-[40vh] flex flex-col gap-2';
  // Status bar — T4 dictation toggle + status pill mount here; T5 improve
  // popover also attaches to this column.
  const statusBar = document.createElement('div');
  statusBar.className = 'pluma-status-bar flex items-center justify-between gap-2 min-h-[2rem]';
  const statusSpacer = document.createElement('span');
  statusSpacer.className = 'flex-1';
  statusBar.appendChild(statusSpacer);
  const previewEmpty = document.createElement('p');
  previewEmpty.className = 'text-sm text-[var(--color-text-muted)]';
  const previewBody = document.createElement('div');
  previewBody.className = 'pluma-preview-body flex-1';
  previewBody.append(previewEmpty);
  previewCol.append(statusBar, previewBody);

  root.appendChild(listCol);
  root.appendChild(previewCol);

  // --- Row rendering ---
  function renderRows(): void {
    // Remove previous rows (keep emptyState).
    for (const el of [...listScroll.querySelectorAll('.' + ROW_BASE)]) el.remove();

    listCount.textContent = String(escritos.length);
    const hasAny = escritos.length > 0;
    emptyState.style.display = hasAny ? 'none' : '';

    for (const escrito of escritos) {
      listScroll.appendChild(buildRow(escrito));
    }
  }

  function buildRow(escrito: Escrito): HTMLElement {
    const row = document.createElement('div');
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    row.className = `${ROW_BASE} flex items-center gap-2 px-3 py-2 text-left border-b border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-muted)] transition-[background-color] duration-[var(--transition-fast)] cursor-pointer`;
    row.dataset.id = escrito.id;
    if (escrito.id === selectedId) row.classList.add(SELECTED);

    const label = document.createElement('span');
    label.className = 'flex-1 truncate text-sm';
    label.textContent = escrito.titulo.trim() || translate(currentLang, 'pluma.untitled');
    label.title = escrito.titulo;

    const meta = document.createElement('span');
    meta.className = 'text-[11px] text-[var(--color-text-muted)] shrink-0';
    meta.textContent = new Date(escrito.updatedAt).toLocaleDateString(
      currentLang === 'es' ? 'es-MX' : 'en-US',
      { month: 'short', day: 'numeric' },
    );

    const renameBtn = mkIconBtn(translate(currentLang, 'pluma.rename.aria'), onRename);
    const deleteBtn = mkIconBtn(translate(currentLang, 'pluma.delete.aria'), onDelete, 'danger');

    row.append(label, meta, renameBtn, deleteBtn);

    row.addEventListener('click', (event) => {
      // Ignore clicks on the action buttons (they stop propagation).
      if ((event.target as HTMLElement).closest('button[data-action]')) return;
      selectedId = escrito.id;
      for (const el of listScroll.querySelectorAll('.' + SELECTED)) el.classList.remove(SELECTED);
      row.classList.add(SELECTED);
      handlers.onSelect(escrito.id);
    });
    row.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      row.click();
    });

    function onRename(): void {
      const next = window.prompt(translate(currentLang, 'pluma.rename.prompt'), escrito.titulo);
      if (next === null) return;
      const trimmed = next.trim();
      if (trimmed === escrito.titulo || trimmed === '') return;
      handlers.onRename(escrito.id, trimmed);
    }

    function onDelete(): void {
      const ok = window.confirm(translate(currentLang, 'pluma.delete.confirm'));
      if (!ok) return;
      if (selectedId === escrito.id) {
        selectedId = null;
        preview(undefined);
      }
      handlers.onRemove(escrito.id);
    }

    return row;
  }

  function mkIconBtn(
    label: string,
    onClick: () => void,
    variant: 'ghost' | 'danger' = 'ghost',
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.action = '1';
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.className =
      'icon-button compact' + (variant === 'danger' ? ' text-[var(--color-danger)]' : '');
    btn.textContent = variant === 'danger' ? '×' : '✎';
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      onClick();
    });
    return btn;
  }

  const setEscritos = (list: Escrito[]): void => {
    escritos = list;
    renderRows();
  };

  const preview = (escrito: Escrito | undefined): void => {
    previewBody.replaceChildren();
    if (!escrito) {
      previewBody.appendChild(previewEmpty);
      return;
    }
    const title = document.createElement('h3');
    title.className = 'text-base font-semibold mb-2';
    title.textContent = escrito.titulo.trim() || translate(currentLang, 'pluma.untitled');
    const note = document.createElement('p');
    note.className = 'text-[11px] text-[var(--color-text-muted)] mb-3';
    note.textContent = translate(currentLang, 'pluma.preview.note');
    const body = document.createElement('article');
    body.className = 'text-sm whitespace-pre-wrap text-[var(--color-text-primary)]';
    body.textContent = escrito.contenidoMD || translate(currentLang, 'pluma.preview.empty');
    previewBody.append(title, note, body);
  };

  const setLanguage = (next: AppLanguage): void => {
    currentLang = next;
    root.setAttribute('aria-label', translate(currentLang, 'pluma.title'));
    listTitle.textContent = translate(currentLang, 'pluma.list.title');
    emptyTitle.textContent = translate(currentLang, 'pluma.empty.title');
    emptyBody.textContent = translate(currentLang, 'pluma.empty.body');
    previewEmpty.textContent = translate(currentLang, 'pluma.preview.empty');
    renderRows();
    // Refresh the open preview labels (cheap re-render).
    const open = escritos.find((e) => e.id === selectedId);
    preview(open);
  };

  // Initial labels.
  setLanguage(lang);

  return {
    root,
    setEscritos,
    preview,
    setLanguage,
    previewPane: previewCol,
    editorMount: previewBody,
    statusBar,
  };
}
