// server/lib/detectors/raw-fetch-egress-detector.js
//
// SB-08 — the detector ratchet for the SSRF guard: no raw `fetch(` or
// `undici.request(` on a non-literal URL outside the guard.
//
// Rationale: SB-01 built the guarded fetch (public-fetch.js /
// ssrf-guard.js) and SB-06/SB-07 routed the known dynamic-URL call
// sites through it. This detector keeps it that way — any NEW raw
// fetch whose URL argument is not a string literal is a finding, so
// the unguarded-egress count can only ratchet DOWN from the baseline
// taken when this detector landed.
//
// What counts as a finding:
//   - `fetch(<expr>)` / `undici.request(<expr>)` in server/** where the
//     first argument does not begin a complete string literal — an
//     identifier, a call, a template literal WITH interpolation, or a
//     literal immediately concatenated with `+` are all dynamic.
//   - A plain string literal, or a template literal with NO
//     interpolation, is a fixed address and is not flagged.
//
// Allow-listed (never flagged): the guard's own modules (they ARE the
// egress), and server/tests/** (test transports fetch local servers
// by design). Callers that inject their own transport call it by its
// own name (fetchImpl, transport, …), which this scan does not match.

import { walk, readSafe, makeReport, makeError, lineOf, relPath, snippet } from "./_framework.js";

export const RAW_FETCH_ALLOWLIST = new Set([
  "server/lib/public-fetch.js",
  "server/lib/ssrf-guard.js",
  "server/lib/connector-client.js",
  // Detectors whose source necessarily contains fetch call patterns as
  // rule text (they scan FOR these shapes) — pattern descriptions, not
  // egress. This detector's own file is one of them.
  "server/lib/detectors/raw-fetch-egress-detector.js",
  "server/lib/detectors/frontend-unsafe-chain-detector.js",
]);

const CALL_RE = /(?<![\w$])(?:fetch|undici\.request)\s*\(/g;

/**
 * Classify the first argument starting at `pos` (just past the call's
 * opening paren): "literal" when it is a complete string literal
 * (quoted, or a backtick template without interpolation) followed by
 * `,` or `)`; "dynamic" otherwise.
 */
export function classifyFirstArg(src, pos) {
  let i = pos;
  while (i < src.length && /\s/.test(src[i])) i++;
  const ch = src[i];
  if (ch === '"' || ch === "'") {
    let j = i + 1;
    while (j < src.length && src[j] !== ch) { if (src[j] === "\\") j++; j++; }
    if (j >= src.length) return "dynamic";
    let k = j + 1;
    while (k < src.length && /\s/.test(src[k])) k++;
    return src[k] === "," || src[k] === ")" ? "literal" : "dynamic";
  }
  if (ch === "`") {
    let j = i + 1;
    while (j < src.length && src[j] !== "`") {
      if (src[j] === "\\") { j += 2; continue; }
      if (src[j] === "$" && src[j + 1] === "{") return "dynamic";
      j++;
    }
    if (j >= src.length) return "dynamic";
    let k = j + 1;
    while (k < src.length && /\s/.test(src[k])) k++;
    return src[k] === "," || src[k] === ")" ? "literal" : "dynamic";
  }
  return "dynamic";
}

/** Scan one file's source; returns [{ index, text }] for dynamic-URL calls. */
export function scanSource(src) {
  const hits = [];
  CALL_RE.lastIndex = 0;
  let m;
  while ((m = CALL_RE.exec(src)) != null) {
    const argStart = m.index + m[0].length;
    if (classifyFirstArg(src, argStart) === "dynamic") {
      hits.push({ index: m.index, text: m[0].trim() });
    }
  }
  return hits;
}

export async function runRawFetchEgressDetector({ root, opts = {} } = {}) {
  const t0 = Date.now();
  if (!root) return makeError("raw-fetch-egress", "no_root", null, t0);
  try {
    const files = await walk(root, [".js", ".mjs", ".cjs"]);
    const findings = [];
    for (const f of files) {
      const rel = relPath(root, f);
      if (!rel.startsWith("server/")) continue;
      if (rel.startsWith("server/tests/")) continue;
      if (RAW_FETCH_ALLOWLIST.has(rel)) continue;
      const c = await readSafe(f);
      if (!c || !c.includes("fetch")) continue;
      for (const hit of scanSource(c)) {
        findings.push({
          id: "raw_fetch_dynamic_url",
          severity: "high",
          kind: "static",
          subject: { kind: "file", path: rel },
          message: "Raw fetch on a non-literal URL outside the SSRF guard — route through fetchPublicUrl (server/lib/public-fetch.js) or the connector guard",
          location: `${rel}:${lineOf(c, hit.index)}`,
          evidence: { snippet: snippet(c.slice(hit.index, hit.index + 80), 80) },
          fixHint: "route_through_fetchPublicUrl",
        });
      }
    }
    return makeReport("raw-fetch-egress", findings, t0);
  } catch (e) {
    return makeError("raw-fetch-egress", "detector_threw", e, t0);
  }
}
