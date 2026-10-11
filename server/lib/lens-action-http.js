/**
 * Lens actions normally answer inside HTTP 200 (`/api/lens/run` wraps the
 * body). An ownership refusal is different: the handler returns
 * `{ ok:false, status:403, error:"forbidden: …" }` and this maps that exact
 * shape onto a real HTTP 403. Any other `status` (a domain field, a nested
 * fetch code) stays on the 200 envelope so it cannot change the response.
 */
export function httpErrorFromLensAction(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.ok !== false || raw.status !== 403) return null;
  if (typeof raw.error !== "string" || !raw.error.startsWith("forbidden")) return null;
  return { status: 403, body: { ok: false, error: raw.error, status: 403, code: "not_owner" } };
}
