import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Escrito } from '../../src/types';
import { createPlumaPanel } from '../../src/escritos/escritos-ui';

function mkEscrito(over: Partial<Escrito> = {}): Escrito {
  const now = Date.now();
  return {
    id: 'e1',
    titulo: 'Notas',
    contenidoMD: '# Hola',
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

const noop = { onSelect: () => {}, onRename: () => {}, onRemove: () => {}, onClose: () => {} };

describe('createPlumaPanel', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('renders the empty state and a zero count when no escritos', () => {
    const panel = createPlumaPanel(noop, 'es');
    panel.setEscritos([]);
    expect(panel.root.querySelector('.empty-state')).toBeTruthy();
    expect(panel.root.querySelector('.count-badge')?.textContent).toBe('0');
  });

  it('renders one row per escrito and forwards select on click', () => {
    const onSelect = vi.fn();
    const panel = createPlumaPanel({ ...noop, onSelect }, 'es');
    panel.setEscritos([mkEscrito({ id: 'a', titulo: 'Alpha' })]);

    const rows = panel.root.querySelectorAll('.pluma-row');
    expect(rows).toHaveLength(1);
    rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('setOpenDoc(id) hides the empty placeholder and highlights the row', () => {
    const panel = createPlumaPanel(noop, 'es');
    panel.setEscritos([
      mkEscrito({ id: 'a', titulo: 'Alpha' }),
      mkEscrito({ id: 'b', titulo: 'Beta' }),
    ]);
    expect(panel.root.querySelector('.pluma-preview-empty')).not.toBeNull();

    panel.setOpenDoc('a');
    const rows = panel.root.querySelectorAll('.pluma-row');
    expect(rows[0]?.classList.contains('is-selected')).toBe(true);
    expect(rows[1]?.classList.contains('is-selected')).toBe(false);
    expect(panel.root.querySelector<HTMLElement>('.pluma-preview-empty')?.style.display).toBe(
      'none',
    );
  });

  it('setOpenDoc(null) shows the placeholder and clears the selection', () => {
    const panel = createPlumaPanel(noop, 'es');
    panel.setEscritos([mkEscrito({ id: 'a' })]);
    panel.setOpenDoc('a');
    panel.setOpenDoc(null);
    expect(panel.root.querySelector('.pluma-row')?.classList.contains('is-selected')).toBe(false);
    expect(panel.root.querySelector<HTMLElement>('.pluma-preview-empty')?.style.display).not.toBe(
      'none',
    );
  });

  it('forwards a rename after prompting (trimmed) and ignores cancel', () => {
    const onRename = vi.fn();
    const panel = createPlumaPanel({ ...noop, onRename }, 'es');
    panel.setEscritos([mkEscrito({ id: 'a', titulo: 'Viejo' })]);

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('  Nuevo  ');
    panel.root.querySelectorAll<HTMLButtonElement>('.pluma-row [data-action]')[0]?.click();
    expect(onRename).toHaveBeenCalledWith('a', 'Nuevo');

    promptSpy.mockReturnValue(null);
    panel.root.querySelectorAll<HTMLButtonElement>('.pluma-row [data-action]')[0]?.click();
    expect(onRename).toHaveBeenCalledTimes(1);
    promptSpy.mockRestore();
  });

  it('confirms before forwarding remove', () => {
    const onRemove = vi.fn();
    const panel = createPlumaPanel({ ...noop, onRemove }, 'es');
    panel.setEscritos([mkEscrito({ id: 'a' })]);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    panel.root.querySelectorAll<HTMLButtonElement>('.pluma-row [data-action]')[1]?.click();
    expect(onRemove).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    panel.root.querySelectorAll<HTMLButtonElement>('.pluma-row [data-action]')[1]?.click();
    expect(onRemove).toHaveBeenCalledWith('a');
    confirmSpy.mockRestore();
  });

  it('switches labels between ES and EN via setLanguage', () => {
    const panel = createPlumaPanel(noop, 'es');
    panel.setEscritos([]);
    expect(panel.root.querySelector('h4')?.textContent).toContain('Aún');

    panel.setLanguage('en');
    expect(panel.root.querySelector('h4')?.textContent).toContain('No escritos');
  });
});
