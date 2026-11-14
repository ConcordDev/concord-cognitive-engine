/**
 * bounds.ts — the client mirror of the platform's ONE input-limits
 * policy (GB-1539, founder ruling on the bounds tickets, 2026-11-14).
 *
 * The server policy lives in server/lib/bounds.js and is enforced on
 * every write; this file carries the SAME constants so forms can
 * bound input at the field (maxLength / min / max) and show the
 * policy's message inline instead of letting the user submit into a
 * 400. The values must never drift from the server module: a pin
 * test (server/tests/bounds-policy.test.js) asserts both constant
 * sets agree.
 *
 * Mirror discipline for forms: bound the field, show the message,
 * NEVER silently coerce or clamp a typed value into range — the
 * server refuses out-of-bounds input with a clear 400, and the
 * client's job is to make that refusal unnecessary and visible.
 */

export const BOUNDS = Object.freeze({
  TITLE: 200, // names / titles
  NOTE: 5000, // notes / descriptions
  POST: 5000, // feed posts
  DOC: 50000, // docs / long-form
  PERCENT_MIN: 0,
  PERCENT_MAX: 100,
  QUANTITY_MAX: 10000,
  MONEY_MAX: 1000000,
  NUMBER_MAX: 1000000, // generic bounded number (docs database cells)
  DURATION_YEARS: 10,
  LIST_MAX: 500, // items per request
});

export type TextClass = 'title' | 'note' | 'post' | 'doc';

export const TEXT_LIMITS: Record<TextClass, number> = {
  title: BOUNDS.TITLE,
  note: BOUNDS.NOTE,
  post: BOUNDS.POST,
  doc: BOUNDS.DOC,
};

/** The policy's message for a text field of the given class. */
export function textLimitMessage(field: string, cls: TextClass = 'title'): string {
  return `${field} is limited to ${TEXT_LIMITS[cls]} characters.`;
}

/** True when a text value fits its class limit (absent values pass). */
export function textInBounds(value: string | null | undefined, cls: TextClass = 'title'): boolean {
  if (value === null || value === undefined) return true;
  return value.length <= TEXT_LIMITS[cls];
}

/** True when a numeric value is finite, non-negative and within max (absent passes). */
export function numberInBounds(
  value: number | null | undefined,
  max: number,
): boolean {
  if (value === null || value === undefined) return true;
  return Number.isFinite(value) && value >= 0 && value <= max;
}

export function percentInBounds(value: number | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  return Number.isFinite(value) && value >= BOUNDS.PERCENT_MIN && value <= BOUNDS.PERCENT_MAX;
}
