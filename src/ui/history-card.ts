/**
 * History card — renders a single transcription entry in the sidebar.
 *
 * SRP: This module's only job is rendering one history card.
 * Each card is a self-contained DOM element with its own event handlers.
 *
 * Design: Compact card with text preview, language/model badges,
 * relative timestamp, and hover-revealed action buttons.
 */

import type { HistoryEntry } from '../types';
import { timeAgo } from '../utils/time-ago';
import * as audioStore from '../audio/audio-store';

/**
 * Create a history card DOM element for a given entry.
 *
 * @param entry - The history entry to render
 * @param onRestore - Callback when user clicks the card to restore text
 * @param onDelete  - Callback when user clicks the delete button
 * @returns The card element ready to be appended to the sidebar list
 */
export function createHistoryCard(
  entry: HistoryEntry,
  onRestore: (id: string) => void,
  onDelete: (id: string) => void,
): HTMLElement {
  const card = document.createElement('div');
  card.className = [
    'group relative',
    'p-3 pl-3.5 rounded-xl',
    'border border-[var(--color-border)]',
    'bg-[var(--color-surface)]',
    'hover:border-[var(--color-border-strong)]',
    'hover:shadow-[var(--shadow-card-hover)]',
    'hover:-translate-y-px',
    'transition-all duration-[var(--transition-fast)]',
    'cursor-pointer',
    'overflow-hidden',
  ].join(' ');
  card.setAttribute('role', 'listitem');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `Restaurar transcripción: ${entry.text.slice(0, 50)}`);

  // Emphasis indicator bar (left edge), only visible on hover/focus
  const indicator = document.createElement('span');
  indicator.className =
    'absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-[var(--color-text-primary)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-[var(--transition-fast)]';
  indicator.setAttribute('aria-hidden', 'true');
  card.appendChild(indicator);

  // Text preview — 2 lines max
  const textP = document.createElement('p');
  textP.className =
    'text-[13.5px] text-[var(--color-text-primary)] leading-snug line-clamp-2 text-left pr-6';
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

  // Action buttons container (top-right, hover-revealed)
  const actions = document.createElement('div');
  actions.className =
    'absolute top-1.5 right-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-[var(--transition-fast)]';

  // Play button — toggles inline audio player
  const playBtn = document.createElement('button');
  playBtn.className = [
    'p-1.5 rounded-md',
    'text-[var(--color-text-muted)]',
    'hover:text-[var(--color-text-primary)]',
    'hover:bg-[var(--color-surface-muted)]',
    'active:scale-90',
    'transition-all duration-[var(--transition-fast)]',
    'cursor-pointer',
  ].join(' ');
  playBtn.setAttribute('aria-label', 'Reproducir audio');
  playBtn.setAttribute('title', 'Reproducir');
  playBtn.appendChild(createPlayIcon());

  // Download button
  const downloadBtn = document.createElement('button');
  downloadBtn.className = [
    'p-1.5 rounded-md',
    'text-[var(--color-text-muted)]',
    'hover:text-[var(--color-text-primary)]',
    'hover:bg-[var(--color-surface-muted)]',
    'active:scale-90',
    'transition-all duration-[var(--transition-fast)]',
    'cursor-pointer',
  ].join(' ');
  downloadBtn.setAttribute('aria-label', 'Descargar audio');
  downloadBtn.setAttribute('title', 'Descargar audio');
  downloadBtn.appendChild(createDownloadIcon());

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = [
    'p-1.5 rounded-md border border-transparent',
    'text-[var(--color-text-muted)]',
    'hover:text-[var(--color-text-primary)]',
    'hover:bg-[var(--color-surface-sunken)] hover:border-[var(--color-border-strong)]',
    'active:scale-90',
    'transition-all duration-[var(--transition-fast)]',
    'cursor-pointer',
  ].join(' ');
  deleteBtn.setAttribute('aria-label', 'Eliminar entrada del historial');
  deleteBtn.setAttribute('title', 'Eliminar');
  deleteBtn.appendChild(createTrashIcon());

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
      const clip = await audioStore.get(entry.id);
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

  downloadBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      const clip = await audioStore.get(entry.id);
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

  // Click to restore
  card.addEventListener('click', () => {
    onRestore(entry.id);
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onRestore(entry.id);
    }
  });

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
