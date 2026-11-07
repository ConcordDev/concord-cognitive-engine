// server/lib/macro-access.js
//
// Cohesive R-2, phase 1 — DECLARED macro access sets.
//
// Today the platform's per-macro access picture is a name-regex
// classifier (macro-capability-classifier.js): sets guessed from what a
// macro is CALLED, never by what it does (Research brief K-3). Phase 1
// starts the evidence base the ACL model and any future access question
// need: a macro may DECLARE its access set in its spec, next to Gate D's
// paramSchema, on the same opt-in/additive chassis —
//
//   register(domain, name, fn, {
//     access: {
//       reads:      ["dtus", "lensArtifacts"],   // named stores / DTU
//       writes:     ["dtus"],                    // classes / domains
//       externalIO: ["http:api.example.com"],    // named external places
//     },
//   })
//
// This module is the declaration's validator and the census over the
// registry: pure functions in macro-contract.js's idiom, report-only.
// Phase 1 has NO enforcement and NO inference — and, per the brief's
// C-1 lesson, declared sets are kept strictly separate from anything
// observed or inferred (phase 2's concern). A set validated against
// itself proves nothing; a declaration is evidence precisely because
// nothing here edits it.
//
// A macro with no spec.access is UNDECLARED — counted, not faulted:
// declarations accrete per-domain after the format lands, and the
// census at birth (declared 0, undeclared = total) is the baseline
// every later declaration moves. A macro whose spec.access is present
// but malformed is INVALID — a violation with its location, because a
// declaration that cannot be read is worse than none: it looks like
// evidence and is not.
//
// Clean-room note: the mechanism (a declared access set + a census) is
// reimplemented from the Research brief's description in Concord's own
// Gate B/D idiom. No Cohesive code was read or copied — that repo
// carries no LICENSE (ideas yes, code no).

export const ACCESS_LISTS = Object.freeze(["reads", "writes", "externalIO"]);

/**
 * Validate one spec.access declaration.
 *
 * @param {unknown} access  the raw spec.access value
 * @returns {{ ok: boolean, violations: Array<{kind: string, detail?: string}>,
 *             access: { reads: string[], writes: string[], externalIO: string[] } | null }}
 *   `access` is the NORMALISED declaration (all three lists present,
 *   order preserved) when ok; null when not. Normalisation never adds
 *   or removes a named target — it only makes absent lists explicit.
 */
export function validateAccessDeclaration(access) {
  const violations = [];
  if (!access || typeof access !== "object" || Array.isArray(access)) {
    return { ok: false, violations: [{ kind: "access_not_object" }], access: null };
  }
  for (const key of Object.keys(access)) {
    if (!ACCESS_LISTS.includes(key)) {
      violations.push({ kind: "unknown_access_key", detail: key });
    }
  }
  const normalised = {};
  for (const list of ACCESS_LISTS) {
    const raw = access[list];
    if (raw === undefined) { normalised[list] = []; continue; }
    if (!Array.isArray(raw)) {
      violations.push({ kind: "access_list_not_array", detail: list });
      normalised[list] = [];
      continue;
    }
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
      if (typeof entry !== "string" || entry.trim().length === 0) {
        violations.push({ kind: "access_entry_not_named", detail: list });
        continue;
      }
      const name = entry.trim();
      if (seen.has(name)) {
        violations.push({ kind: "access_entry_duplicate", detail: `${list}:${name}` });
        continue;
      }
      seen.add(name);
      out.push(name);
    }
    normalised[list] = out;
  }
  return violations.length === 0
    ? { ok: true, violations, access: normalised }
    : { ok: false, violations, access: null };
}

/**
 * Census the live MACROS registry (Map<domain, Map<name, {fn, spec}>>)
 * for access declarations. Pure; never throws.
 *
 * Every registry entry lands in exactly one partition — declared
 * (spec.access present and valid), invalid (present but malformed),
 * undeclared (absent) — and declared + invalid + undeclared === total
 * is asserted before returning: the census reconciles to the registry
 * count by construction, or it does not return numbers at all.
 *
 * @param {Map} macros  the live MACROS registry
 * @returns {{ total: number, declared: number, invalid: number,
 *             undeclared: number,
 *             violations: Array<{domain: string, name: string, kind: string, detail?: string}>,
 *             byDomain: Map<string, {total: number, declared: number, invalid: number, undeclared: number}> }}
 */
export function censusAccess(macros) {
  const result = {
    total: 0, declared: 0, invalid: 0, undeclared: 0,
    violations: [], byDomain: new Map(),
  };
  if (!macros || typeof macros.forEach !== "function" || typeof macros.get !== "function") {
    result.violations.push({ domain: "", name: "", kind: "no_registry" });
    return result;
  }
  for (const [domain, inner] of macros) {
    const roll = { total: 0, declared: 0, invalid: 0, undeclared: 0 };
    result.byDomain.set(domain, roll);
    if (!inner || typeof inner.forEach !== "function") {
      result.violations.push({ domain: String(domain), name: "", kind: "bad_inner_map" });
      continue;
    }
    for (const [name, entry] of inner) {
      result.total++;
      roll.total++;
      const access = entry?.spec?.access;
      if (access === undefined) {
        result.undeclared++;
        roll.undeclared++;
        continue;
      }
      const v = validateAccessDeclaration(access);
      if (v.ok) {
        result.declared++;
        roll.declared++;
      } else {
        result.invalid++;
        roll.invalid++;
        for (const violation of v.violations) {
          result.violations.push({ domain: String(domain), name: String(name), ...violation });
        }
      }
    }
  }
  if (result.declared + result.invalid + result.undeclared !== result.total) {
    throw new Error(
      `macro-access census failed to reconcile: ${result.declared} declared + ${result.invalid} invalid + ${result.undeclared} undeclared !== ${result.total} total`,
    );
  }
  return result;
}

export default { ACCESS_LISTS, validateAccessDeclaration, censusAccess };
