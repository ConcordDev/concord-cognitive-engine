// timeFormat — S-TL-6 (F11): ONE timestamp family for the whole wall.
// Posts, comments, notifications and the reactions dialog all read
// relative time the same way ("Just now", "5m", "3h", "2d", then a
// plain date); the exact time rides along as a hover title wherever
// the relative form renders. Before this module each component kept
// its own copy and they had drifted apart — different wording, and
// the breakdown dialog showed a raw locale datetime.

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString();
}

/** The exact timestamp for hover/detail (title attributes). */
export function exactTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
