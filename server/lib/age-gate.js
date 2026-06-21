// server/lib/age-gate.js
//
// Shared 18+ age-gate math. Concordia carries mature/violent content, so both
// sign-up paths enforce the same floor:
//   - password register (routes/auth.js) attests a DOB at creation time;
//   - OAuth sign-up (routes/oauth.js) can't (providers don't return one), so it
//     lands DOB-less and confirms via POST /api/auth/confirm-age.
//
// Keeping the computation in one place means the two paths can't drift.

export const MIN_AGE = 18;

/**
 * Precise age in whole years from a YYYY-MM-DD string, computed in UTC and
 * birthday-aware (this year's birthday counts only if it has already passed).
 * Returns null for an invalid, absurd (>120y), or future date.
 *
 * @param {string} dateOfBirth  e.g. "1990-01-01"
 * @returns {number|null}
 */
export function ageFromDob(dateOfBirth) {
  if (typeof dateOfBirth !== "string" || !dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const mDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (mDiff < 0 || (mDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  if (dob.getTime() > now.getTime() || age > 120) return null;
  return age;
}

/**
 * True iff the DOB is valid AND the person is at least MIN_AGE.
 * @param {string} dateOfBirth
 * @returns {boolean}
 */
export function isAdult(dateOfBirth) {
  const age = ageFromDob(dateOfBirth);
  return age !== null && age >= MIN_AGE;
}
