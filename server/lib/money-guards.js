// server/lib/money-guards.js
//
// Shared refusals for money movement and status changes.
// Callers keep their existing non-positive / already-paid error strings
// when a test or client already matches them. Overpay is always
// amount_exceeds_balance. Unknown statuses are never coerced.

/**
 * @param {number} balance amount still payable (invoice balance, tax owed, bill amount)
 * @param {number} amt requested payment
 * @param {{ alreadyPaid?: boolean, nonPositiveError?: string, alreadyPaidError?: string }} [opts]
 * @returns {{ ok: true, amount: number } | { ok: false, error: string }}
 */
export function assertPayable(balance, amt, opts = {}) {
  const amount = typeof amt === "number" ? amt : Number(amt);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: opts.nonPositiveError || "invalid_amount" };
  }
  if (opts.alreadyPaid) {
    return { ok: false, error: opts.alreadyPaidError || "already_paid" };
  }
  const bal = Number(balance);
  if (!Number.isFinite(bal) || amount > bal + 0.001) {
    return { ok: false, error: "amount_exceeds_balance" };
  }
  return { ok: true, amount: Math.round(amount * 100) / 100 };
}

/**
 * map: { [fromStatus]: string[] } of allowed next statuses.
 * A status with an empty list is terminal. Repeating it is unchanged
 * (caller must not re-stamp). An unknown `to` is invalid_status, never
 * coerced. A known `to` that this `from` cannot reach is invalid_transition.
 */
export function assertTransition(from, to, map) {
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return { ok: false, error: "invalid_status" };
  }
  const known = new Set();
  for (const [src, next] of Object.entries(map)) {
    known.add(src);
    if (Array.isArray(next)) for (const dest of next) known.add(dest);
  }
  if (typeof from !== "string" || !known.has(from)) {
    return { ok: false, error: "invalid_status" };
  }
  if (typeof to !== "string" || !known.has(to)) {
    return { ok: false, error: "invalid_status" };
  }
  if (from === to) {
    const next = map[from];
    if (Array.isArray(next) && next.length === 0) return { ok: true, unchanged: true };
    return { ok: false, error: "invalid_transition" };
  }
  const next = map[from];
  if (!Array.isArray(next) || !next.includes(to)) {
    return { ok: false, error: "invalid_transition" };
  }
  return { ok: true, unchanged: false };
}
