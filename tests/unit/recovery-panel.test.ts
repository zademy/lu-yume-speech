/**
 * Recovery panel controller contract (spec T7): the panel renders the
 * classified category, offers ONLY the actions the classification allows,
 * keeps the recording until a decision, delegates every action to the
 * composition root and exposes the copyable technical report.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRecoveryController } from '../../src/ui/recovery-panel';
import type { LocalFailureClassification } from '../../src/local-models/local-errors';

function makePanel(): {
  root: HTMLElement;
  message: HTMLElement;
  actions: HTMLElement;
  detail: HTMLElement;
  copy: HTMLButtonElement;
  dismiss: HTMLButtonElement;
} {
  const root = document.createElement('section');
  root.innerHTML = `
    <p id="msg"></p>
    <div id="actions"></div>
    <pre id="detail"></pre>
    <button type="button" id="copy"></button>
    <button type="button" id="dismiss"></button>`;
  document.body.appendChild(root);
  return {
    root,
    message: root.querySelector('#msg') as HTMLElement,
    actions: root.querySelector('#actions') as HTMLElement,
    detail: root.querySelector('#detail') as HTMLElement,
    copy: root.querySelector('#copy') as HTMLButtonElement,
    dismiss: root.querySelector('#dismiss') as HTMLButtonElement,
  };
}

const CLASSIFICATION: LocalFailureClassification = {
  category: 'inference-failed',
  actions: ['retry', 'remote-groq', 'update-browser'],
};

describe('createRecoveryController', () => {
  let panel: ReturnType<typeof makePanel>;

  beforeEach(() => {
    panel = makePanel();
  });
  afterEach(() => {
    panel.root.remove();
  });

  it('offer shows the panel with one button per allowed action', () => {
    const onAction = vi.fn();
    const controller = createRecoveryController(panel, {
      lang: () => 'en',
      onAction,
      copyText: async () => true,
    });

    controller.offer(
      { blob: new Blob(['audio']), mimeType: 'audio/webm' },
      CLASSIFICATION,
      'report text',
    );

    expect(panel.root.hidden).toBe(false);
    expect(panel.detail.textContent).toBe('report text');
    const buttons = [...panel.actions.querySelectorAll('button')];
    expect(buttons.map((b) => b.textContent)).toEqual([
      'Retry',
      'Send to Groq instead',
      'Update browser',
    ]);
    expect(controller.hasKept()).toBe(true);
  });

  it('clicking an action delegates with the kept recording and hides the panel', () => {
    const onAction = vi.fn();
    const controller = createRecoveryController(panel, {
      lang: () => 'en',
      onAction,
      copyText: async () => true,
    });
    const kept = { blob: new Blob(['audio']), mimeType: 'audio/webm' };
    controller.offer(kept, CLASSIFICATION, 'report');

    const retry = panel.actions.querySelectorAll('button')[0] as HTMLButtonElement;
    retry.click();

    expect(onAction).toHaveBeenCalledWith('retry', kept);
    expect(panel.root.hidden).toBe(true);
    expect(controller.hasKept()).toBe(false);
  });

  it('dismiss hides the panel and drops the recording without dispatching', () => {
    const onAction = vi.fn();
    const controller = createRecoveryController(panel, {
      lang: () => 'en',
      onAction,
      copyText: async () => true,
    });
    controller.offer({ blob: new Blob(), mimeType: 'audio/webm' }, CLASSIFICATION, 'r');

    panel.dismiss.click();

    expect(panel.root.hidden).toBe(true);
    expect(controller.hasKept()).toBe(false);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('copy button exports the technical report and confirms', async () => {
    const copyText = vi.fn(async () => true);
    const controller = createRecoveryController(panel, {
      lang: () => 'en',
      onAction: vi.fn(),
      copyText,
    });
    controller.offer({ blob: new Blob(), mimeType: 'audio/webm' }, CLASSIFICATION, 'the report');

    panel.copy.click();
    await vi.waitFor(() => expect(panel.copy.textContent).toBe('Copied'));
    expect(copyText).toHaveBeenCalledWith('the report');
  });
});
