/**
 * Relative time formatter — converts Unix timestamps to human-readable
 * Spanish strings like "ahora", "hace 5 min", "ayer".
 *
 * SRP: This module's only job is timestamp formatting.
 * Pure function — no side effects, no external dependencies.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/**
 * Format a Unix timestamp (ms) as a relative time string in Spanish.
 *
 * @param createdAt - Unix timestamp in milliseconds
 * @param now       - Current time in ms (default: Date.now(), injectable for tests)
 * @returns Human-readable relative time string
 */
export function timeAgo(createdAt: number, now: number = Date.now()): string {
  const diff = now - createdAt;

  if (diff < MINUTE) return 'ahora';
  if (diff < HOUR) return `hace ${Math.floor(diff / MINUTE)} min`;
  if (diff < DAY) return `hace ${Math.floor(diff / HOUR)} h`;

  const days = Math.floor(diff / DAY);
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;

  // For older entries, show the date
  return formatDate(createdAt);
}

/**
 * Format a Unix timestamp as a short date string.
 * Example: "10 may", "3 ene"
 */
function formatDate(ts: number): string {
  const date = new Date(ts);
  const day = date.getDate();
  const months = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  const month = months[date.getMonth()] ?? '';
  return `${day} ${month}`;
}
