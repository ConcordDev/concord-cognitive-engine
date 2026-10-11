/** Text and time helpers for the DTU browser. No clock fallbacks. */

export interface DtuDisplaySource {
  content?: unknown;
  creti?: unknown;
  cretiHuman?: unknown;
  summary?: unknown;
  human?: { summary?: unknown } | null;
  machine?: { notes?: unknown } | null;
  createdAt?: unknown;
  timestamp?: unknown;
  updatedAt?: unknown;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Full Content body. Objects (CRETI scores) are not rendered as text. */
export function dtuFullContent(dtu: DtuDisplaySource | null | undefined): string {
  if (!dtu) return '';
  return (
    asText(dtu.content) ||
    asText(dtu.creti) ||
    asText(dtu.cretiHuman) ||
    asText(dtu.human?.summary) ||
    asText(dtu.summary) ||
    asText(dtu.machine?.notes)
  );
}

/** Persisted creation time. Never Date.now(), never updatedAt. */
export function dtuCreatedAt(dtu: DtuDisplaySource | null | undefined): Date | null {
  const raw = dtu?.createdAt ?? dtu?.timestamp;
  if (raw == null || raw === '') return null;
  const date = raw instanceof Date ? raw : new Date(typeof raw === 'number' ? raw : String(raw));
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** Feed/list clock string. Empty when the row has no persisted creation time. */
export function dtuEventTime(raw: { createdAt?: unknown; timestamp?: unknown } | null | undefined): string {
  const created = dtuCreatedAt(raw);
  return created ? created.toISOString() : '';
}

export interface DtuTotalSource {
  total?: number | null;
  dtus?: unknown[] | null;
  items?: unknown[] | null;
  pagination?: { total?: number | null } | null;
}

/** Header count. pagination.total wins; a reported 0 with visible rows uses the rows. */
export function resolveDtuTotal(data: DtuTotalSource | null | undefined): number {
  const shown = (Array.isArray(data?.dtus) ? data.dtus.length : 0) || (Array.isArray(data?.items) ? data.items.length : 0);
  const fromPage = data?.pagination?.total;
  const reported = typeof fromPage === 'number' ? fromPage : data?.total;
  if (typeof reported === 'number' && Number.isFinite(reported) && reported > 0) return reported;
  if (shown > 0) return shown;
  if (typeof reported === 'number' && Number.isFinite(reported)) return reported;
  return 0;
}

/**
 * Header/page count. An en dash, never "1--20 / 20 of 20 DTUs".
 * page is 0-based.
 */
export function formatDtuPageCount(page: number, pageSize: number, total: number): string {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  if (safeTotal === 0) return '0 DTUs';
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 20;
  const p = Number.isFinite(page) && page > 0 ? Math.floor(page) : 0;
  const start = p * size + 1;
  if (start > safeTotal) return `${safeTotal} DTUs`;
  const end = Math.min((p + 1) * size, safeTotal);
  return `Showing ${start}–${end} of ${safeTotal}`;
}
