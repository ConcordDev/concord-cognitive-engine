/**
 * Honest AirNow failure copy for the EPA/USGS panel.
 * missing_api_key (and the old "AIRNOW_API_KEY invalid" 400 body) both
 * mean the upstream key is missing or rejected — never a client bug,
 * and never a fabricated AQI.
 */

export const AIRNOW_KEY_UNAVAILABLE =
  'Air quality data unavailable: AirNow API key missing or rejected';

export interface AirNowFailure {
  ok?: boolean;
  error?: string;
  reason?: string;
}

export function isAirNowKeyFailure(env: AirNowFailure | null | undefined): boolean {
  if (!env) return false;
  const reason = env.reason || '';
  const error = env.error || '';
  return (
    reason === 'missing_api_key' ||
    error === 'missing_api_key' ||
    /AIRNOW_API_KEY/i.test(error)
  );
}

/** Visible failure text, or null when the envelope is a success. */
export function airNowPanelFailure(env: AirNowFailure | null | undefined): string | null {
  if (!env || env.ok) return null;
  if (isAirNowKeyFailure(env)) return AIRNOW_KEY_UNAVAILABLE;
  return env.error || 'Air quality data unavailable';
}

/** Pull a macro refusal out of a thrown axios error so the panel can render it. */
export function airNowFailureFromThrown(e: unknown): { ok: false; error?: string; reason?: string } {
  const ax = e as {
    response?: { data?: { error?: unknown; reason?: unknown } };
    message?: string;
  };
  const data = ax.response?.data;
  if (data && typeof data === 'object') {
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : undefined,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
    };
  }
  return { ok: false, error: ax.message || 'request failed' };
}
