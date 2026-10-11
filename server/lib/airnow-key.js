/**
 * Shared AirNow key lookup for environment.airnow-current (EPA/USGS panel)
 * and environment.live_air_quality (ZIP panel).
 *
 * Canonical name is EPA_AIRNOW_API_KEY. AIRNOW_API_KEY remains a
 * backward-compatible alias for installs that set only the older name.
 * A blank canonical value falls through to the alias.
 *
 * AirNow rejects a bad key with HTTP 401 (the live failure was that status,
 * turned into the string "AIRNOW_API_KEY invalid"). shapeLensRunHttp maps
 * any error other than the exact reason `missing_api_key` to a 4xx, and
 * HTTP 400 makes the browser log a failed request while the EPA/USGS panel
 * drops the result. Auth refusals therefore use the same envelope the ZIP
 * panel already renders, which stays HTTP 200.
 */

const AIRNOW_SIGNUP_URL = "https://docs.airnowapi.org/account/request/";
const CANONICAL_ENV = "EPA_AIRNOW_API_KEY";
const FETCH_TIMEOUT_MS = 8000;

const AUTH_BODY =
  /invalid api[_ ]?key|api[_ ]?key\b[^.\n]{0,40}\b(?:invalid|rejected|denied)|authorization has been denied/i;

export function resolveAirNowApiKey(env = process.env) {
  const primary = String(env.EPA_AIRNOW_API_KEY || "").trim();
  if (primary) return primary;
  return String(env.AIRNOW_API_KEY || "").trim();
}

export function airNowKeyRefusal() {
  return {
    ok: false,
    reason: "missing_api_key",
    envVar: CANONICAL_ENV,
    signupUrl: AIRNOW_SIGNUP_URL,
    message: `Set ${CANONICAL_ENV} in .env to enable this panel. Free signup: ${AIRNOW_SIGNUP_URL}`,
  };
}

async function responseText(response) {
  try {
    if (typeof response?.text === "function") return await response.text();
  } catch (_err) {
    // Body is optional evidence. A non-text payload still classifies by status.
    return "";
  }
  return "";
}

/**
 * @param {Response} response
 * @returns {Promise<{ kind: "ok", data: unknown } | { kind: "auth" } | { kind: "error", error: string }>}
 */
export async function classifyAirNowResponse(response) {
  const status = Number(response?.status) || 0;
  if (status === 401 || status === 403) return { kind: "auth" };
  if (response?.ok) {
    const data = typeof response.json === "function" ? await response.json() : null;
    return { kind: "ok", data };
  }
  const text = await responseText(response);
  if (AUTH_BODY.test(text)) return { kind: "auth" };
  return { kind: "error", error: `HTTP ${status || "error"}` };
}

/**
 * @param {string} url
 * @param {number} [timeoutMs]
 */
export async function fetchAirNow(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: ctrl.signal });
    return await classifyAirNowResponse(response);
  } catch (e) {
    return { kind: "error", error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}
