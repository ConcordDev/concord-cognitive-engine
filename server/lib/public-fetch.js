// server/lib/public-fetch.js
//
// SSRF-guarded outbound HTTP for KEYLESS public data sources (data.gov CKAN,
// api.weather.gov, USAspending, Google Civic, ...). This is the tokenless
// sibling of `connector-client.js#connectorFetch`: it applies the SAME SSRF
// protection (scheme allowlist + private-IP block + DNS-rebinding pin via
// `validateSafeFetchUrl` → `fetchWithPinnedIp`) but with NO per-user OAuth
// token requirement, so open-data macros can fetch public records safely.
//
// Before this existed, `government.js#fetchJsonGov` used a bare `fetch()` that
// bypassed the SSRF guard entirely (a real gap — a user-influenced dataset URL
// could point at an internal address). Routing it through `fetchPublicUrl`
// closes that bypass without loosening any of the guard's existing checks.
//
// Test seams (mirror connectorFetch's `opts.fetchImpl` convention):
//   • opts.fetchImpl(url, init)        — full transport override; the caller
//     owns egress so the guard is skipped (there is nothing real to guard in a
//     unit test). Production NEVER passes this.
//   • opts.pinnedFetchImpl(check,init) — override only the pinned transport
//     while the SSRF guard still runs (used to prove the orchestration).
//   • __setPublicFetchTestTransport(fn) — a module-scope equivalent of
//     opts.fetchImpl, for callers with no opts channel (lens-action macros
//     invoked through the `lensRun` harness). Defaults to null → guarded path.

import { validateSafeFetchUrl, fetchWithPinnedIp } from "./ssrf-guard.js";

// Test-only module-scope transport override. Null in production. When set, it
// replaces the real egress the same way opts.fetchImpl does (caller owns the
// transport, so the guard is skipped — there is no real network to protect).
let _testTransport = null;

/**
 * TEST-ONLY: install a module-scope transport used in place of the real
 * pinned fetch. Pass a function `(url, init) => Response-like`, or `null`/no-arg
 * to restore the real guarded path. Production code never calls this.
 * @param {((url:string, init?:object)=>Promise<any>)|null} fn
 */
export function __setPublicFetchTestTransport(fn) {
  _testTransport = typeof fn === "function" ? fn : null;
}

/**
 * Fetch a public URL with the SAME SSRF protection connectorFetch uses, but
 * with no user/token requirement. Returns a `fetch`-style Response (has `.ok`,
 * `.status`, `.json()`), so existing JSON callers work unchanged.
 *
 * @param {string} url
 * @param {RequestInit} [init]
 * @param {object} [opts]
 * @param {(url:string, init?:object)=>Promise<any>} [opts.fetchImpl] - full transport override (skips guard; test/caller owns egress)
 * @param {(check:object, init?:object)=>Promise<any>} [opts.pinnedFetchImpl] - pinned-transport override (guard still runs)
 * @returns {Promise<Response|any>}
 * @throws {Error} with code 'SSRF_BLOCKED' when the URL fails validation
 */
export async function fetchPublicUrl(url, init = {}, opts = {}) {
  // Full transport override (per-call opts, then module test hook). When
  // present the caller owns the transport, so — exactly like connectorFetch —
  // the SSRF guard is skipped because there is no real egress to guard.
  const injected =
    typeof opts.fetchImpl === "function" ? opts.fetchImpl :
    (_testTransport || null);
  if (injected) return injected(url, init);

  // Guarded path: validate FIRST (scheme + private-IP + DNS-rebinding), then
  // fetch pinned to the validated IP. This is the bypass-closing chokepoint.
  const check = await validateSafeFetchUrl(url);
  if (!check.ok) {
    const err = new Error(check.error || "URL failed SSRF validation");
    err.code = "SSRF_BLOCKED";
    throw err;
  }

  const pinnedFetch =
    typeof opts.pinnedFetchImpl === "function" ? opts.pinnedFetchImpl : fetchWithPinnedIp;
  return pinnedFetch(check, init);
}
