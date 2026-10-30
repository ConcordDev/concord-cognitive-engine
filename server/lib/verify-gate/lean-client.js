// server/lib/verify-gate/lean-client.js
//
// Backend client for the Lean 4 check service on the pod (lib/lean-service/service.mjs).
//   checkLean(source, opts) -> { status, ok, errors, elapsedMs, ... }
//     status "verified"  the pod compiled it with no sorry/admit and only the standard axioms
//     status "failed"    the pod compiled it and it did not check (errors given)
//     status "rejected"  the source itself is not acceptable as a proof (policy.js reasons)
//     status "pending"   the service is unreachable / busy / timed out: nothing is learned, try later
// Pending is never a pass and never a refutation. A failed proof attempt is not a disproof either: the
// caller decides what that means (the verify gate treats it as "not verified").
//
// Config: CONCORD_LEAN_URL (default http://127.0.0.1:11437, the SSH tunnel), CONCORD_LEAN_TOKEN (optional).

import { leanSourceIssues } from "../lean-service/policy.js";

export const DEFAULT_LEAN_URL = "http://127.0.0.1:11437";

export function leanUrl(env = process.env) {
  return String(env.CONCORD_LEAN_URL || DEFAULT_LEAN_URL).replace(/\/+$/, "");
}

export async function checkLean(source, { url = leanUrl(), token = process.env.CONCORD_LEAN_TOKEN || "", timeoutS = 30, fetchImpl = globalThis.fetch } = {}) {
  const rejected = leanSourceIssues(source);
  if (rejected.length) return { status: "rejected", ok: false, errors: [], rejected, elapsedMs: 0 };
  if (typeof fetchImpl !== "function") return { status: "pending", ok: false, errors: [], reason: "no fetch", elapsedMs: 0 };
  const t0 = Date.now();
  let res;
  try {
    res = await fetchImpl(`${url}/check`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ lean_source: source, timeout_s: timeoutS }),
      signal: AbortSignal.timeout(timeoutS * 1000 + 5000),
    });
  } catch (e) {
    return { status: "pending", ok: false, errors: [], reason: `lean service unreachable: ${String(e?.cause?.code || e?.message || e)}`, elapsedMs: Date.now() - t0 };
  }
  if (res.status === 429 || res.status === 503) return { status: "pending", ok: false, errors: [], reason: "lean service busy", elapsedMs: Date.now() - t0 };
  let j = null;
  try { j = await res.json(); } catch { /* handled below */ }
  if (!res.ok || !j || typeof j !== "object") return { status: "pending", ok: false, errors: [], reason: `lean service HTTP ${res.status}`, elapsedMs: Date.now() - t0 };
  if (j.rejected?.length) return { status: "rejected", ok: false, errors: [], rejected: j.rejected, elapsedMs: j.elapsed_ms ?? Date.now() - t0 };
  if (j.timed_out || j.unavailable) return { status: "pending", ok: false, errors: j.errors || [], reason: j.timed_out ? "lean timed out" : "lean unavailable on the pod", elapsedMs: j.elapsed_ms ?? Date.now() - t0 };
  return { status: j.ok === true ? "verified" : "failed", ok: j.ok === true, errors: j.errors || [], warnings: j.warnings || [], axioms: j.axioms || null, elapsedMs: j.elapsed_ms ?? Date.now() - t0 };
}
