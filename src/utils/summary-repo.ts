/**
 * Summary history repository — persistence for summaries grouped by their exact
 * source transcription snapshot.
 *
 * SRP: this module only stores, retrieves, and removes summary histories.
 */

import type { GeneratedSummary, SummaryHistory } from '../types';
import { SUMMARY_HISTORIES_KEY, SUMMARY_HISTORY_MAX_ENTRIES } from '../types';
import { load, save } from './storage';

function getAll(): SummaryHistory[] {
  return load<SummaryHistory[]>(SUMMARY_HISTORIES_KEY, []);
}

/** Find the history belonging to an exact visible transcription snapshot. */
export function getSummaryHistoryBySource(sourceText: string): SummaryHistory | undefined {
  return getAll().find((history) => history.sourceText === sourceText);
}

/** Add one generation, creating its source history when needed. */
export function addSummary(sourceText: string, summary: GeneratedSummary): SummaryHistory {
  const histories = getAll();
  let history = histories.find((candidate) => candidate.sourceText === sourceText);

  if (history) {
    history.summaries.push(summary);
    history.summaries = history.summaries.slice(-SUMMARY_HISTORY_MAX_ENTRIES);
    history.updatedAt = summary.createdAt;
  } else {
    history = {
      id: crypto.randomUUID(),
      sourceText,
      summaries: [summary],
      createdAt: summary.createdAt,
      updatedAt: summary.createdAt,
    };
    histories.push(history);
  }

  save(SUMMARY_HISTORIES_KEY, histories);
  return history;
}

/** Remove one generated summary and drop its history when it becomes empty. */
export function removeSummary(historyId: string, summaryId: string): SummaryHistory | undefined {
  const histories = getAll();
  const historyIndex = histories.findIndex((history) => history.id === historyId);
  const history = histories[historyIndex];
  if (!history) return undefined;

  const summaryIndex = history.summaries.findIndex((summary) => summary.id === summaryId);
  if (summaryIndex === -1) return history;

  history.summaries.splice(summaryIndex, 1);
  if (history.summaries.length === 0) {
    histories.splice(historyIndex, 1);
    save(SUMMARY_HISTORIES_KEY, histories);
    return undefined;
  }

  history.updatedAt = history.summaries.at(-1)?.createdAt ?? history.createdAt;
  save(SUMMARY_HISTORIES_KEY, histories);
  return history;
}
