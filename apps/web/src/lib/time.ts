/**
 * Format a timestamp relative to now (< 24h) or as an absolute date (>= 24h).
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diff = now - date.getTime();
  const hours = diff / (1000 * 60 * 60);

  if (hours < 1) {
    const minutes = Math.floor(diff / (1000 * 60));
    if (minutes < 1) return 'just now';
    return `${minutes}m ago`;
  }

  if (hours < 24) {
    return `${Math.floor(hours)}h ago`;
  }

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  });
}

/**
 * Full date-time string for tooltip / datetime attribute.
 */
export function toDatetimeAttr(iso: string): string {
  return iso;
}
