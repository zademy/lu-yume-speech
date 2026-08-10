/**
 * History card — renders one transcription in the Inicio history list.
 *
 * SRP: This module's only job is rendering one history card.
 * Each card is a self-contained DOM element with its own event handlers.
 *
 * Design: A readable list row with full metadata and direct actions.
 */

import type { HistoryEntry } from '../types';
import { timeAgo } from '../utils/time-ago';
import { getAudio } from '../db/recordings-db';

/**
 * Active disposers keyed by the card element they belong to.
 *
 * Cards own transient object URLs for inline audio playback; those URLs must be
 * revoked when the card leaves the DOM. The sidebar calls `disposeHistoryCard`
 * before removing or rebuilding nodes so no blob URL leaks across re-renders.
 */
const disposers = new WeakMap<HTMLElement, () => void>();

/** Run a card's audio teardown (revoke object URL, remove player). No-op if none. */
export function disposeHistoryCard(card: HTMLElement): void {
  disposers.get(card)?.();
}

/**
 * Create a history card DOM element for a given entry.
 *
 * @param entry - The history entry to render
 * @param onRestore - Callback when user clicks the card to restore text
 * @param onDelete  - Callback when user clicks the delete button
 * @param onCopy    - Callback when user copies the transcription
 * @returns The card element ready to be appended to the history list
 */
export function createHistoryCard(
  entry: HistoryEntry,
  onRestore: (id: string) => void,
  onDelete: (id: string) => void,
  onCopy: (id: string) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = [
    'history-entry group relative',
    'p-4 pl-4 rounded-xl',
    'border border-[var(--color-border-subtle)]',
    'bg-[var(--color-surface)]',
    'hover:border-[var(--color-border-strong)]',
    'hover:shadow-[var(--shadow-card-hover)]',
    'transition-[border-color,box-shadow] duration-[var(--transition-fast)]',
    'overflow-hidden',
  ].join(' ');
  card.setAttribute('role', 'listitem');

  // Text preview — three lines on the dashboard.
  const textP = document.createElement('p');
  textP.className =
    'text-sm text-[var(--color-text-primary)] leading-relaxed line-clamp-3 text-left pr-20';
  textP.textContent = entry.text;

  // Meta row: badges + time
  const meta = document.createElement('div');
  meta.className = 'flex items-center gap-2 mt-2';

  // Language badge
  if (entry.language) {
    meta.appendChild(createBadge(entry.language.toUpperCase(), 'primary'));
  }

  // Model badge
  const modelLabel = entry.model === 'whisper-large-v3-turbo' ? 'turbo' : 'v3';
  meta.appendChild(createBadge(modelLabel, 'muted'));

  // Operation mode badge
  if (entry.operationMode === 'translate') {
    meta.appendChild(createBadge('TR', 'accent'));
  }

  // Spacer
  const spacer = document.createElement('span');
  spacer.className = 'flex-1';
  meta.appendChild(spacer);

  // Timestamp
  const time = document.createElement('span');
  time.className = 'text-[10px] text-[var(--color-text-muted)]';
  time.textContent = timeAgo(entry.createdAt);
  meta.appendChild(time);

  if (entry.duration !== undefined) {
    meta.appendChild(createBadge(formatDuration(entry.duration), 'muted'));
  }

  // Primary text actions remain visible for touch and keyboard users.
  const actions = document.createElement('div');
  actions.className = 'absolute top-2 right-2 flex items-center gap-0.5 opacity-100';

  const copyBtn = document.createElement('button');
  copyBtn.className = actionButtonClass;
  copyBtn.setAttribute('aria-label', 'Copiar transcripción');
  copyBtn.setAttribute('title', 'Copiar');
  copyBtn.appendChild(createCopyIcon());

  // Play button — toggles inline audio player
  const playBtn = document.createElement('button');
  playBtn.className = actionButtonClass;
  playBtn.setAttribute('aria-label', 'Reproducir audio');
  playBtn.setAttribute('title', 'Reproducir');
  playBtn.appendChild(createPlayIcon());

  // Download button
  const downloadBtn = document.createElement('button');
  downloadBtn.className = actionButtonClass;
  downloadBtn.setAttribute('aria-label', 'Descargar audio');
  downloadBtn.setAttribute('title', 'Descargar audio');
  downloadBtn.appendChild(createDownloadIcon());

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = actionButtonClass;
  deleteBtn.setAttribute('aria-label', 'Eliminar entrada del historial');
  deleteBtn.setAttribute('title', 'Eliminar');
  deleteBtn.appendChild(createTrashIcon());

  actions.appendChild(copyBtn);
  actions.appendChild(playBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(deleteBtn);

  // Inline audio player (hidden by default, shown when play is clicked)
  let audioEl: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;

  const cleanupAudio = () => {
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
    if (audioEl) {
      audioEl.remove();
      audioEl = null;
    }
    playBtn.replaceChildren(createPlayIcon());
  };

  playBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    // Toggle: if playing, stop and remove player
    if (audioEl) {
      cleanupAudio();
      return;
    }
    // Load blob from IndexedDB and create audio player
    playBtn.replaceChildren(createLoadingIcon());
    try {
      const clip = await getAudio(entry.id);
      if (!clip) {
        playBtn.replaceChildren(createPlayIcon());
        return;
      }
      currentUrl = URL.createObjectURL(clip.blob);
      audioEl = document.createElement('audio');
      audioEl.controls = true;
      audioEl.className = 'w-full mt-2';
      audioEl.src = currentUrl;
      audioEl.addEventListener('ended', () => {
        playBtn.replaceChildren(createPlayIcon());
      });
      card.appendChild(audioEl);
      playBtn.replaceChildren(createStopIcon());
      void audioEl.play();
    } catch {
      playBtn.replaceChildren(createPlayIcon());
    }
  });

  copyBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    onCopy(entry.id);
  });

  downloadBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const clip = await getAudio(entry.id);
      if (!clip) return;
      const url = URL.createObjectURL(clip.blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = clip.mimeType.includes('webm')
        ? 'webm'
        : clip.mimeType.includes('ogg')
          ? 'ogg'
          : clip.mimeType.includes('mp4')
            ? 'm4a'
            : 'audio';
      a.download = `audio-${new Date(entry.createdAt).toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silent
    }
  });

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    cleanupAudio();
    onDelete(entry.id);
  });

  // Assemble
  card.appendChild(textP);
  card.appendChild(meta);
  card.appendChild(actions);

  const restoreBtn = document.createElement('button');
  restoreBtn.type = 'button';
  restoreBtn.className =
    'mt-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] cursor-pointer';
  restoreBtn.textContent = 'Usar en Dictar';
  restoreBtn.addEventListener('click', () => onRestore(entry.id));
  card.appendChild(restoreBtn);

  disposers.set(card, cleanupAudio);

  return card;
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

function createBadge(text: string, variant: 'primary' | 'muted' | 'accent'): HTMLElement {
  const badge = document.createElement('span');

  const base =
    'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium leading-none';

  const variants: Record<string, string> = {
    primary:
      'bg-[var(--color-surface-sunken)] text-[var(--color-text-primary)] border border-[var(--color-border-subtle)]',
    muted:
      'bg-[var(--color-surface-muted)] text-[var(--color-text-muted)] border border-[var(--color-border-subtle)]',
    accent:
      'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border-strong)]',
  };

  badge.className = `${base} ${variants[variant] ?? variants.muted}`;
  badge.textContent = text;
  return badge;
}

const actionButtonClass =
  'p-2 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)] active:scale-95 transition-[color,background-color,transform] duration-[var(--transition-fast)] cursor-pointer';

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

function createCopyIcon(): SVGElement {
  const svg = createSvg();
  svg.append(
    svgEl('rect', { x: 8, y: 8, width: 14, height: 14, rx: 2 }),
    svgEl('path', { d: 'M16 8V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4' }),
  );
  return svg;
}

function createTrashIcon(): SVGElement {
  const svg = createSvg();
  const path1 = svgEl('path', { d: 'M3 6h18' });
  const path2 = svgEl('path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' });
  const path3 = svgEl('path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' });
  svg.append(path1, path2, path3);
  return svg;
}

function createPlayIcon(): SVGElement {
  const svg = createSvg();
  svg.append(svgEl('polygon', { points: '5 3 19 12 5 21 5 3' }));
  return svg;
}

function createStopIcon(): SVGElement {
  const svg = createSvg();
  svg.append(svgEl('rect', { x: 6, y: 6, width: 12, height: 12, rx: 1 }));
  return svg;
}

function createDownloadIcon(): SVGElement {
  const svg = createSvg();
  svg.append(
    svgEl('path', { d: 'M21 15v4c0 1-1 2-2 2H5c-1 0-2-1-2-2v-4' }),
    svgEl('polyline', { points: '7 10 12 15 17 10' }),
    svgEl('line', { x1: 12, y1: 15, x2: 12, y2: 3 }),
  );
  return svg;
}

function createLoadingIcon(): SVGElement {
  const svg = createSvg();
  svg.append(
    svgEl('line', { x1: 12, y1: 2, x2: 12, y2: 6 }),
    svgEl('line', { x1: 12, y1: 18, x2: 12, y2: 22 }),
    svgEl('line', { x1: 4.93, y1: 4.93, x2: 7.76, y2: 7.76 }),
    svgEl('line', { x1: 16.24, y1: 16.24, x2: 19.07, y2: 19.07 }),
    svgEl('line', { x1: 2, y1: 12, x2: 6, y2: 12 }),
    svgEl('line', { x1: 18, y1: 12, x2: 22, y2: 12 }),
  );
  svg.style.animation = 'spin 1s linear infinite';
  return svg;
}

// --- SVG helpers ---

function createSvg(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  return svg;
}

function svgEl(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, String(val));
  }
  return el;
}
