/**
 * Shared types + presentation metadata for the announcements lens.
 *
 * Mirrors the real backend contract exactly — `server/lib/announcements.js`
 * (`VALID_KINDS`) and `server/domains/announcements.js` (`announcements.list`
 * / `announcements.get` / `announcements.post`). Nothing here invents a
 * field the backend doesn't return.
 */

export type AnnouncementKind =
  | 'feature_drop'
  | 'balance_change'
  | 'event'
  | 'news'
  | 'roadmap';

/** Row shape returned by GET /api/announcements and the `announcements.*` macros. */
export interface Announcement {
  id: string;
  kind: AnnouncementKind;
  title: string;
  body_md: string;
  published_at: number;
  expires_at: number | null;
  dtu_attachment_id?: string | null;
  author_user_id?: string | null;
}

/** Keep in sync with `VALID_KINDS` in server/lib/announcements.js. */
export const VALID_KINDS: AnnouncementKind[] = [
  'feature_drop',
  'balance_change',
  'event',
  'news',
  'roadmap',
];

export function timeAgo(ts: number): string {
  const delta = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (delta < 60) return `${delta}s ago`;
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}

/** Inverse of `timeAgo` — for a future timestamp (e.g. `expires_at`). */
export function timeUntil(ts: number): string {
  const delta = Math.max(0, ts - Math.floor(Date.now() / 1000));
  if (delta < 60) return `in ${delta}s`;
  if (delta < 3600) return `in ${Math.floor(delta / 60)}m`;
  if (delta < 86400) return `in ${Math.floor(delta / 3600)}h`;
  return `in ${Math.floor(delta / 86400)}d`;
}
