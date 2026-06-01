// server/lib/macro-contract.js
//
// Cheap, pure contract primitives for the macro bus — the lightweight half of
// docs/CONTRACT_ENFORCEMENT_STRATEGY.md. The macro bus connects ~9,300 macros
// through untyped (domain, name) strings, so its boundaries drift silently
// (playtest "Vael's Expedition" found arg-order, dead-macro, and dup-shadow
// drift that 1,056 green unit tests missed — because units are mocked, glue is
// not). These primitives turn three of those drift classes into loud failures
// at the two chokepoints (the dispatcher + boot), and are themselves unit-tested.

// ── Gate A — arg-shape guard ────────────────────────────────────────────────
// runMacro's signature is (domain, name, input, ctx). The #1 recurring bug is
// calling it (ctx, "dtu", "cluster", …) — ctx (an object) lands as `domain`,
// which then gets JSON-walked / dispatched as garbage. One string check at the
// dispatcher retires the whole class.
export function checkMacroArgs(domain, name) {
  if (typeof domain !== "string" || domain.length === 0) {
    return { ok: false, reason: "non_string_domain", gotDomain: typeof domain };
  }
  if (typeof name !== "string" || name.length === 0) {
    return { ok: false, reason: "non_string_name", gotName: typeof name };
  }
  return { ok: true };
}

// ── fallthrough-masking detector ────────────────────────────────────────────
// The /api/lens/run AI catch-all returns { ok:false, source:"utility-brain", … }
// for an unregistered macro, masking "this macro isn't wired" as a transient LLM
// outage. Smoke harnesses / monitors use this to tell a dead macro from a real
// result.
export function isFallthroughMasking(result) {
  return !!(result && result.source === "utility-brain" && result.ok === false);
}

// ── Gate B — steady-state registry validator ────────────────────────────────
// Domains that MUST be dispatchable on the bus at steady state. A regression
// that silently un-registers any of these (the ghost-fleet async-registration
// race #11, or the never-imported-domain class #2) is caught at boot instead of
// surfacing as a masked "LLM unavailable" to a player. Ratchet UP as more
// domains are confirmed load-bearing; never remove without cause.
export const EXPECTED_BUS_DOMAINS = Object.freeze([
  // ghost-fleet (#11) — registered async, observed missing at dispatch
  "agents", "quest", "religion", "research", "city", "autonomy",
  "teaching", "breakthrough", "history", "cri", "ingest", "promotion",
  // never-imported domain surfaces (#2 class)
  "minigames", "fishing", "karaoke", "mahjong", "photography",
  // core substrate surfaces a player hits constantly
  "dtu", "creatures", "glyph_spells",
]);

/**
 * Validate a live MACROS map (Map<domain, Map<name, { fn, spec }>>) for the
 * structural + reachability drift the bus is prone to. Pure; never throws.
 *
 * @param {Map} macros            the live MACROS registry
 * @param {{ expectedDomains?: string[] }} [opts]
 * @returns {{ ok:boolean, violations:Array, domains:number, macros:number }}
 */
export function validateRegistry(macros, { expectedDomains = EXPECTED_BUS_DOMAINS } = {}) {
  const violations = [];
  if (!macros || typeof macros.forEach !== "function" || typeof macros.get !== "function") {
    return { ok: false, violations: [{ kind: "no_registry" }], domains: 0, macros: 0 };
  }

  let macroCount = 0;
  for (const [domain, inner] of macros) {
    if (typeof domain !== "string" || domain.length === 0) {
      violations.push({ kind: "bad_domain_key", domain: String(domain) });
    }
    if (!inner || typeof inner.forEach !== "function") {
      violations.push({ kind: "bad_inner_map", domain });
      continue;
    }
    if (inner.size === 0) {
      violations.push({ kind: "empty_domain", domain });
    }
    for (const [name, entry] of inner) {
      macroCount++;
      if (typeof name !== "string" || name.length === 0) {
        violations.push({ kind: "bad_name_key", domain, name: String(name) });
      }
      if (typeof entry?.fn !== "function") {
        violations.push({ kind: "non_function_handler", domain, name });
      }
    }
  }

  // Reachability: every expected domain must exist with ≥1 dispatchable macro.
  for (const d of expectedDomains) {
    const inner = macros.get(d);
    if (!inner || typeof inner.get !== "function" || inner.size === 0) {
      violations.push({ kind: "missing_expected_domain", domain: d });
    }
  }

  return { ok: violations.length === 0, violations, domains: macros.size, macros: macroCount };
}
