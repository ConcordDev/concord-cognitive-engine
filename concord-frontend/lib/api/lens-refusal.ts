/**
 * Lens-refusal classification for the api client's toast path (F16,
 * PR #1707).
 *
 * The lens dispatch rewrites a server handler TypeError into
 * { ok:false, error:"invalid_input", reason:"type_error" |
 * "not_a_function" | "invalid_time" } (server/lib/lens-action-dispatch.js,
 * invalidInputFromThrow). That is a server defect — the user's input
 * was never evaluated. The response interceptor used to toast every
 * refusal's raw code verbatim, so a companion call's handler defect
 * surfaced as a red "invalid input" toast on top of successful saves
 * and creates. Handler defects belong in the request-error record
 * (System Status), not in a toast accusing the user's input.
 */
export function isHandlerDefectRefusal(error: string | undefined, reason?: string | null): boolean {
  return error === 'invalid_input'
    && (reason === 'type_error' || reason === 'not_a_function' || reason === 'invalid_time');
}

/** The toast text for a genuine refusal: the code, humanized, plus the
 *  field/reason the server named when it sent them. */
export function refusalToastMessage(error: string, field?: string | null, reason?: string | null): string {
  const detail = [field, reason].filter(Boolean).join(' — ');
  const human = error.replace(/_/g, ' ');
  return detail ? `${human} (${detail})` : human;
}
