/**
 * courtshipErrorText — the romance engine's reason codes, in product words
 * (courtship full build, S3).
 *
 * The engine answers refusals with machine codes (affinity_too_low,
 * must_be_married_to_conceive, …). The desk used to print them raw —
 * "Action failed: affinity_too_low" — a de-snake-cased code standing where
 * a sentence belongs. Every code the engine and the courtship domain can
 * return is mapped here; affinity_too_low carries the numbers the engine
 * already returns (required / got) so the sentence can state both. An
 * unmapped code falls back to a plain sentence — a raw code never renders.
 */

const STATIC_WORDS: Record<string, string> = {
  no_db: 'Courtship is unavailable just now. Try again in a moment.',
  no_user: 'Sign in to use courtship.',
  missing_inputs: 'That action is missing something it needs.',
  missing_kind: 'That action is missing something it needs.',
  invalid_sentiment: 'That interaction was not understood.',
  cannot_court_self: 'You cannot court yourself.',
  no_courtship: 'There is no courtship with that partner yet.',
  not_engaged: 'You need to be engaged before you can wed.',
  consent_required: 'Both players need to be engaged to each other before you can wed.',
  already_married: 'That courtship is already a marriage.',
  daily_cap: 'You have reached today’s interaction limit with that partner. Try again tomorrow.',
  must_be_married_to_conceive: 'You need an active marriage before you can conceive.',
  already_pregnant: 'A pregnancy is already under way.',
  not_due: 'The baby is not due yet.',
  already_born: 'That child has already been born.',
  not_found: 'That record could not be found.',
  marriage_not_found: 'That marriage could not be found.',
  already_dissolved: 'That marriage has already ended.',
  not_a_party: 'Only a partner in that marriage can end it.',
  child_not_found: 'That child could not be found.',
  handler_error: 'Something went wrong on Concord’s side. Try again in a moment.',
  request_failed: 'That action could not be completed. Try again in a moment.',
};

export interface CourtshipFailure {
  reason?: string | null;
  required?: number | null;
  got?: number | null;
}

export function courtshipErrorText(failure: CourtshipFailure | string | null | undefined): string {
  const reason = typeof failure === 'string' ? failure : failure?.reason;
  if (!reason) return 'That action could not be completed. Try again in a moment.';
  if (reason === 'affinity_too_low') {
    const required = typeof failure === 'object' ? failure?.required : null;
    const got = typeof failure === 'object' ? failure?.got : null;
    if (typeof required === 'number' && typeof got === 'number') {
      return `Affinity is ${Math.round(got * 100)}% — this step needs ${Math.round(required * 100)}%.`;
    }
    return 'Affinity is not high enough for that step yet.';
  }
  const words = STATIC_WORDS[reason];
  if (words) return words;
  // An unmapped machine-shaped code still never renders raw.
  if (/^[a-z0-9_]+$/.test(reason)) {
    return 'That action could not be completed. Try again in a moment.';
  }
  return reason;
}
