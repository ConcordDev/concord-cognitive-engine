/**
 * bounds.js — the platform's ONE input-limits policy (GB-1539, founder
 * ruling on the bounds tickets, 2026-11-14).
 *
 * Before this module, every form invented its own validation — most
 * invented none: fields accepted negatives, unbounded numbers and
 * 300+ character names silently, and a few silently COERCED the bad
 * value into a plausible one (a crisis affected-count of -1 became 1;
 * billing seats/trial/coupon/tax clamped; docs number cells rewrote
 * non-finite input as 0). The ruling: one server-enforced policy,
 * client mirroring it, over-limit answered with a clear 400, never
 * silent and never a silent rewrite.
 *
 * The failure shape is the house shape (see brain-action-input.js):
 * `{ ok:false, error:"invalid_input", reason:"bounds_<kind>", message }`.
 * `invalid_input` maps to HTTP 400 in lib/lens-run-http.js, and the
 * message names the field and the limit so the client can show it
 * verbatim next to the field.
 *
 * Each checker returns null when the value is in bounds, or the
 * failure object when it is not:
 *
 *   const bad = checkTitle("name", params.name);
 *   if (bad) return bad;
 *
 * A field that is absent (undefined/null) is NOT this module's
 * concern — required-field checks stay with the handlers, which
 * already answer `<field> required` in the 422 family. Bounds govern
 * values that are present.
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

const TEXT_LIMITS = {
  title: BOUNDS.TITLE,
  note: BOUNDS.NOTE,
  post: BOUNDS.POST,
  doc: BOUNDS.DOC,
};

// Durations are capped at 10 years, expressed in the caller's unit.
const DURATION_CAPS = {
  milliseconds: BOUNDS.DURATION_YEARS * 365 * 24 * 60 * 60 * 1000,
  seconds: BOUNDS.DURATION_YEARS * 365 * 24 * 60 * 60,
  minutes: BOUNDS.DURATION_YEARS * 365 * 24 * 60,
  hours: BOUNDS.DURATION_YEARS * 365 * 24,
  days: BOUNDS.DURATION_YEARS * 365,
  years: BOUNDS.DURATION_YEARS,
};

function failure(field, kind, message) {
  return { ok: false, error: "invalid_input", reason: `bounds_${kind}`, field, message };
}

function isAbsent(v) {
  return v === undefined || v === null;
}

/** Text length by class: 'title' | 'note' | 'post' | 'doc'. */
export function checkText(field, value, cls = "title") {
  if (isAbsent(value)) return null;
  const limit = TEXT_LIMITS[cls] ?? BOUNDS.TITLE;
  if (typeof value !== "string") {
    return failure(field, "text", `${field} must be text.`);
  }
  if (value.length > limit) {
    return failure(field, "text", `${field} is limited to ${limit} characters (got ${value.length}).`);
  }
  return null;
}

export function checkTitle(field, value) {
  return checkText(field, value, "title");
}

function checkNumberRange(field, value, min, max, kind, rangePhrase) {
  if (isAbsent(value)) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return failure(field, kind, `${field} must be a number.`);
  }
  // Both directions name the allowed range — the refusal is the message
  // the user sees, so a negative names the bound exactly like an excess.
  if (n < min || n > max) {
    return failure(field, kind, `${field} must be ${rangePhrase} (got ${n}).`);
  }
  return null;
}

/** Percent: 0–100 inclusive, negatives rejected. */
export function checkPercent(field, value) {
  return checkNumberRange(field, value, BOUNDS.PERCENT_MIN, BOUNDS.PERCENT_MAX, "percent", `between ${BOUNDS.PERCENT_MIN} and ${BOUNDS.PERCENT_MAX}`);
}

/** Quantity: finite, negatives rejected, at most 10,000. */
export function checkQuantity(field, value) {
  return checkNumberRange(field, value, 0, BOUNDS.QUANTITY_MAX, "quantity", `between 0 and ${BOUNDS.QUANTITY_MAX}`);
}

/** Money: finite, negatives rejected, at most 1,000,000. */
export function checkMoney(field, value) {
  return checkNumberRange(field, value, 0, BOUNDS.MONEY_MAX, "money", `between 0 and ${BOUNDS.MONEY_MAX}`);
}

/**
 * Generic bounded number (the docs database number column: user data,
 * not a form quantity — finite, negatives rejected per the ticket's
 * own expected text, ceiling 1,000,000).
 */
export function checkNumber(field, value) {
  return checkNumberRange(field, value, 0, BOUNDS.NUMBER_MAX, "number", `between 0 and ${BOUNDS.NUMBER_MAX}`);
}

/** Duration in 'minutes' | 'hours' | 'days' | 'years': at most 10 years, negatives rejected. */
export function checkDuration(field, value, unit = "days") {
  const cap = DURATION_CAPS[unit] ?? DURATION_CAPS.days;
  return checkNumberRange(field, value, 0, cap, "duration", `between 0 and ${cap} ${unit} (${BOUNDS.DURATION_YEARS} years)`);
}

/** List length: at most 500 items per request. */
export function checkList(field, value) {
  if (isAbsent(value)) return null;
  if (!Array.isArray(value)) {
    return failure(field, "list", `${field} must be a list.`);
  }
  if (value.length > BOUNDS.LIST_MAX) {
    return failure(field, "list", `${field} is limited to ${BOUNDS.LIST_MAX} items per request (got ${value.length}).`);
  }
  return null;
}

/** First failure in a list of checker results, or null. */
export function firstBoundsFailure(...results) {
  for (const r of results) if (r) return r;
  return null;
}
