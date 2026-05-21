// server/lib/foundry/worldspec.js
//
// Foundry — the Worldspec format (Phase 2).
//
// A worldspec is the persistable description of a game/world built in
// Foundry: which systems are selected, how each is configured, the
// theme, and (Phase 6) the authored rules. It's stored as JSON in
// foundry_worlds.worldspec_json and compiled by the publish pipeline
// (Phase 3) into a real `worlds` row's rule_modulators /
// physics_modulators / seed content.
//
// Shape:
//   {
//     version: 1,
//     template: string | null,        // template id this was based on
//     theme: { universeType, displayName?, palette? },
//     systems: [ { id, config } ],     // selected systems + their config
//     rules:   [ ... ],                // Phase 6 — NL-authored rules
//   }

import { validateSystemSelection } from "./system-registry.js";

export const WORLDSPEC_VERSION = 1;

const VALID_UNIVERSE_TYPES = [
  "fantasy", "scifi", "noir", "cyber", "post-apocalyptic",
  "historical", "surreal", "slice-of-life", "horror", "mythic",
];

/** A fresh, empty worldspec — what foundry.create starts from. */
export function emptyWorldspec() {
  return {
    version: WORLDSPEC_VERSION,
    template: null,
    theme: { universeType: "fantasy", displayName: "", palette: null },
    systems: [],
    rules: [],
  };
}

/**
 * Normalize a (possibly partial / user-supplied) worldspec into the
 * canonical shape. Unknown top-level keys are dropped; missing keys
 * fall back to emptyWorldspec() defaults. System configs are NOT
 * coerced here — that happens in validateWorldspec via the registry,
 * which also surfaces the per-field errors.
 */
export function normalizeWorldspec(raw = {}) {
  const base = emptyWorldspec();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;

  const theme = raw.theme && typeof raw.theme === "object" ? raw.theme : {};
  const universeType = VALID_UNIVERSE_TYPES.includes(theme.universeType)
    ? theme.universeType
    : base.theme.universeType;

  return {
    version: WORLDSPEC_VERSION,
    template: typeof raw.template === "string" ? raw.template : null,
    theme: {
      universeType,
      displayName: typeof theme.displayName === "string" ? theme.displayName.slice(0, 200) : "",
      palette: theme.palette && typeof theme.palette === "object" ? theme.palette : null,
    },
    systems: Array.isArray(raw.systems)
      ? raw.systems
          .filter((s) => s && typeof s === "object" && typeof s.id === "string")
          .map((s) => ({ id: s.id, config: s.config && typeof s.config === "object" ? s.config : {} }))
      : [],
    rules: Array.isArray(raw.rules) ? raw.rules.slice(0, 200) : [],
    // Phase 8 — multiplayer/lobby/matchmaking block. Carried through
    // normalization so foundry.multiplayer_set survives a later
    // foundry.update; the foundry domain owns its canonical shape.
    ...(raw.multiplayer && typeof raw.multiplayer === "object" && !Array.isArray(raw.multiplayer)
      ? { multiplayer: raw.multiplayer }
      : {}),
  };
}

/**
 * Full worldspec validation: envelope shape + the system selection
 * (dependency / conflict / config graph via the registry). This is the
 * gate foundry.validate (Phase 2) and foundry.publish (Phase 3) call.
 *
 * @returns {{ ok, errors, warnings, normalized }}
 *   normalized — the worldspec with systems' configs coerced, ready to
 *                persist / compile.
 */
export function validateWorldspec(raw = {}) {
  const errors = [];
  const warnings = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["worldspec must be an object"], warnings, normalized: emptyWorldspec() };
  }

  const spec = normalizeWorldspec(raw);

  if (raw.version !== undefined && Number(raw.version) !== WORLDSPEC_VERSION) {
    warnings.push(`worldspec version ${raw.version} normalized to ${WORLDSPEC_VERSION}`);
  }
  if (!VALID_UNIVERSE_TYPES.includes(spec.theme.universeType)) {
    errors.push(`theme.universeType '${spec.theme.universeType}' is not valid`);
  }
  if (raw.theme && raw.theme.universeType && !VALID_UNIVERSE_TYPES.includes(raw.theme.universeType)) {
    warnings.push(`theme.universeType '${raw.theme.universeType}' unknown — using '${spec.theme.universeType}'`);
  }

  // System selection — dependency / conflict / config graph.
  const sel = validateSystemSelection(spec.systems);
  errors.push(...sel.errors);
  warnings.push(...sel.warnings);
  spec.systems = sel.resolved; // coerced configs

  // A worldspec with zero systems is allowed as a draft, but the
  // publish pipeline (Phase 3) will reject it — flag it here as a hint.
  if (spec.systems.length === 0) {
    warnings.push("worldspec has no systems selected — drafts are fine, but publishing needs at least one");
  }

  return { ok: errors.length === 0, errors, warnings, normalized: spec };
}

/** Convenience: the set of system ids in a (normalized) worldspec. */
export function worldspecSystemIds(spec) {
  return Array.isArray(spec?.systems) ? spec.systems.map((s) => s.id) : [];
}

export const WORLDSPEC_INTERNALS = Object.freeze({ VALID_UNIVERSE_TYPES });
