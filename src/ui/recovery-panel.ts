/**
 * Local transcription recovery panel — manual actions after a local failure.
 *
 * Single responsibility: render and drive the Dictar-view recovery panel
 * (spec T7). The panel shows the classified failure category, keeps the
 * conserved recording in memory, offers ONLY the manual actions the
 * classification allows and exposes the exportable technical report. It
 * never decides semantics — every action is delegated to the composition
 * root through {@link RecoveryActionHandler}.
 */

import type { AppLanguage } from '../types';
import { translate } from '../i18n/translations';
import type { LocalFailureClassification, LocalRecoveryAction } from '../types';

/** The conserved recording awaiting a manual decision. */
export interface KeptRecording {
  blob: Blob;
  mimeType: string;
}

/** Semantic dispatch — the composition root owns what each action means. */
export type RecoveryActionHandler = (action: LocalRecoveryAction, kept: KeptRecording) => void;

export interface LocalRecoveryController {
  /** Show the panel for a classified failure with the conserved recording. */
  offer(kept: KeptRecording, classification: LocalFailureClassification, report: string): void;
  /**
   * Show the panel for a NON-local failure with only Reintentar (spec T3:
   * resumable remote takes). The message must itself explain the recovery
   * scope (kept only while the page stays open).
   */
  offerManual(kept: KeptRecording, message: string, detail: string): void;
  /** Hide the panel and drop the kept recording. */
  hide(): void;
  /** Whether a recording is currently kept (offered or pending decision). */
  hasKept(): boolean;
}

/** Button emphasis per action — retry leads, remote choices are explicit. */
const PRIMARY_ACTIONS: readonly LocalRecoveryAction[] = ['retry'];

export function createRecoveryController(
  panel: {
    root: HTMLElement;
    message: HTMLElement;
    actions: HTMLElement;
    detail: HTMLElement;
    copy: HTMLButtonElement;
    dismiss: HTMLButtonElement;
  },
  deps: {
    lang: () => AppLanguage;
    onAction: RecoveryActionHandler;
    copyText: (text: string) => Promise<boolean>;
    /** Explicit dismissal (× button) — releases retained recovery state. */
    onDismiss?: () => void;
  },
): LocalRecoveryController {
  let kept: KeptRecording | null = null;

  const hide = (): void => {
    kept = null;
    panel.root.hidden = true;
    panel.actions.textContent = '';
    panel.detail.textContent = '';
  };

  panel.dismiss.addEventListener('click', () => {
    hide();
    deps.onDismiss?.();
  });

  panel.copy.addEventListener('click', () => {
    void deps.copyText(panel.detail.textContent).then((ok) => {
      panel.copy.textContent = translate(
        deps.lang(),
        ok ? 'recovery.copied' : 'recovery.copyFailed',
      );
    });
  });

  const renderActions = (actions: readonly LocalRecoveryAction[]): void => {
    panel.actions.textContent = '';
    for (const action of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = PRIMARY_ACTIONS.includes(action) ? 'primary-action' : 'secondary-action';
      button.textContent = translate(deps.lang(), `recovery.action.${action}`);
      button.addEventListener('click', () => {
        const current = kept;
        hide();
        if (current) deps.onAction(action, current);
      });
      panel.actions.appendChild(button);
    }
  };

  const show = (nextKept: KeptRecording, message: string, detail: string): void => {
    kept = nextKept;
    panel.message.textContent = message;
    panel.detail.textContent = detail;
  };

  const offer = (
    nextKept: KeptRecording,
    classification: LocalFailureClassification,
    report: string,
  ): void => {
    show(nextKept, translate(deps.lang(), `recovery.category.${classification.category}`), report);
    renderActions(classification.actions);
    panel.root.hidden = false;
  };

  const offerManual = (nextKept: KeptRecording, message: string, detail: string): void => {
    show(nextKept, message, detail);
    renderActions(['retry']);
    panel.root.hidden = false;
  };

  return {
    offer,
    offerManual,
    hide,
    hasKept: () => kept !== null,
  };
}
