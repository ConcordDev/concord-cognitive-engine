/**
 * Tier-2 contract tests for the Foundry System Registry (Phase 1).
 *
 * Pins:
 *   - catalog integrity: every entry has the required fields, valid
 *     category, valid worldScope/status/activation.kind
 *   - dependency graph is closed (no entry depends on / conflicts with
 *     an unknown id) and acyclic-enough (no self-dep)
 *   - the 4 spec-missing systems are present and flagged status:'stub'
 *   - coerceConfig: clamps numbers, drops unknown keys, rejects bad
 *     enums to default, fills missing from default
 *   - validateSystemSelection: dependency + conflict + unknown-id +
 *     duplicate handling, and stub -> warning (not error)
 *
 * Run: node --test server/tests/foundry-system-registry.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SYSTEM_REGISTRY,
  CATEGORIES,
  CATEGORY_LABELS,
  allSystemIds,
  getSystem,
  listSystems,
  systemsByCategory,
  getConfigSchema,
  coerceConfig,
  validateSystemSelection,
} from "../lib/foundry/system-registry.js";

const VALID_CATEGORIES = new Set(Object.values(CATEGORIES));
const VALID_SCOPES = new Set(["world", "global", "player"]);
const VALID_STATUS = new Set(["available", "stub"]);
const VALID_ACTIVATION = new Set([
  "rule_modulator", "physics_modulator", "content_seed", "heartbeat_optin", "always_on",
]);

describe("catalog integrity", () => {
  it("has a substantial catalog", () => {
    assert.ok(SYSTEM_REGISTRY.length >= 30, `expected >=30 systems, got ${SYSTEM_REGISTRY.length}`);
  });

  it("every entry has the required shape", () => {
    for (const s of SYSTEM_REGISTRY) {
      assert.equal(typeof s.id, "string", `id missing on ${JSON.stringify(s).slice(0, 80)}`);
      assert.ok(VALID_CATEGORIES.has(s.category), `${s.id}: bad category ${s.category}`);
      assert.equal(typeof s.displayName, "string", `${s.id}: displayName`);
      assert.equal(typeof s.description, "string", `${s.id}: description`);
      assert.ok(VALID_SCOPES.has(s.worldScope), `${s.id}: bad worldScope ${s.worldScope}`);
      assert.ok(VALID_STATUS.has(s.status), `${s.id}: bad status ${s.status}`);
      assert.ok(s.activation && VALID_ACTIVATION.has(s.activation.kind), `${s.id}: bad activation.kind`);
      assert.ok(Array.isArray(s.dependsOn), `${s.id}: dependsOn not array`);
      assert.ok(Array.isArray(s.conflictsWith), `${s.id}: conflictsWith not array`);
      assert.equal(typeof s.configSchema, "object", `${s.id}: configSchema`);
    }
  });

  it("ids are unique", () => {
    const ids = allSystemIds();
    assert.equal(ids.length, new Set(ids).size, "duplicate system id");
  });

  it("dependency + conflict graph references only known ids, no self-reference", () => {
    const known = new Set(allSystemIds());
    for (const s of SYSTEM_REGISTRY) {
      for (const dep of s.dependsOn) {
        assert.ok(known.has(dep), `${s.id}: depends on unknown '${dep}'`);
        assert.notEqual(dep, s.id, `${s.id}: depends on itself`);
      }
      for (const c of s.conflictsWith) {
        assert.ok(known.has(c), `${s.id}: conflicts with unknown '${c}'`);
        assert.notEqual(c, s.id, `${s.id}: conflicts with itself`);
      }
    }
  });

  it("every category has a label and at least one system", () => {
    const grouped = systemsByCategory();
    for (const key of Object.values(CATEGORIES)) {
      assert.ok(CATEGORY_LABELS[key], `no label for ${key}`);
      assert.ok(grouped[key].systems.length >= 1, `category ${key} is empty`);
    }
  });

  it("the 4 formerly-missing systems are present and built (Phase 7)", () => {
    // The substrate audit flagged these as listed-in-spec but absent.
    // Phase 7 built them; they're now status:'available'.
    for (const id of ["size-scaling", "status-window", "skill-affinity-player", "isekai-reincarnation"]) {
      const s = getSystem(id);
      assert.ok(s, `${id} missing from catalog`);
      assert.equal(s.status, "available", `${id} should be 'available' after Phase 7`);
    }
  });

  it("no systems remain stubbed", () => {
    const stubs = SYSTEM_REGISTRY.filter((s) => s.status === "stub").map((s) => s.id);
    assert.deepEqual(stubs, [], `still stubbed: ${stubs.join(", ")}`);
  });

  it("config schema fields all declare a valid type + default", () => {
    const VALID_FIELD_TYPES = new Set(["enum", "number", "bool", "text", "range"]);
    for (const s of SYSTEM_REGISTRY) {
      for (const [field, desc] of Object.entries(s.configSchema)) {
        assert.ok(VALID_FIELD_TYPES.has(desc.type), `${s.id}.${field}: bad type ${desc.type}`);
        assert.ok("default" in desc, `${s.id}.${field}: no default`);
        if (desc.type === "enum") {
          assert.ok(Array.isArray(desc.options) && desc.options.length >= 2, `${s.id}.${field}: enum needs >=2 options`);
          assert.ok(desc.options.includes(desc.default), `${s.id}.${field}: default not in options`);
        }
        if (desc.type === "number") {
          assert.ok(desc.min <= desc.default && desc.default <= desc.max, `${s.id}.${field}: default out of [min,max]`);
        }
      }
    }
  });
});

describe("coerceConfig", () => {
  it("clamps numbers into [min, max]", () => {
    const r = coerceConfig("physics-modifiers", { gravity: 99999 });
    assert.equal(r.config.gravity, 300);
    const r2 = coerceConfig("physics-modifiers", { gravity: -5 });
    assert.equal(r2.config.gravity, 10);
  });

  it("drops unknown keys", () => {
    const r = coerceConfig("physics-modifiers", { gravity: 100, totallyBogus: 42 });
    assert.ok(!("totallyBogus" in r.config));
  });

  it("fills missing fields from default", () => {
    const r = coerceConfig("physics-modifiers", {});
    assert.equal(r.config.gravity, 100);
    assert.equal(r.config.glideEnabled, true);
  });

  it("rejects bad enum values to default + reports error", () => {
    const r = coerceConfig("terrain-biomes", { biomeSet: "not-a-biome" });
    assert.equal(r.config.biomeSet, "mixed");
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("biomeSet")));
  });

  it("coerces bool-ish values", () => {
    const r = coerceConfig("physics-modifiers", { glideEnabled: "" , swimEnabled: 1 });
    assert.equal(r.config.glideEnabled, false);
    assert.equal(r.config.swimEnabled, true);
  });

  it("unknown system id fails cleanly", () => {
    const r = coerceConfig("does-not-exist", {});
    assert.equal(r.ok, false);
    assert.ok(r.errors[0].includes("unknown system"));
  });
});

describe("validateSystemSelection", () => {
  it("passes a selection with satisfied dependencies", () => {
    const r = validateSystemSelection([{ id: "combat-motor" }, { id: "boss-phases" }]);
    assert.equal(r.ok, true);
    assert.equal(r.errors.length, 0);
    assert.equal(r.resolved.length, 2);
  });

  it("fails when a dependency is missing", () => {
    const r = validateSystemSelection([{ id: "boss-phases" }]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("combat-motor")));
  });

  it("fails on unknown system id", () => {
    const r = validateSystemSelection([{ id: "ghost-system" }]);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => e.includes("ghost-system")));
  });

  it("drops duplicates with a warning", () => {
    const r = validateSystemSelection([{ id: "concord-link" }, { id: "concord-link" }]);
    assert.equal(r.resolved.length, 1);
    assert.ok(r.warnings.some((w) => w.includes("duplicate")));
  });

  it("available systems produce no stub warning", () => {
    // Post-Phase-7 every system is built, so a clean selection of
    // available systems carries no "not built yet" advisory.
    const r = validateSystemSelection([{ id: "status-window" }, { id: "combat-motor" }]);
    assert.equal(r.ok, true);
    assert.ok(!r.warnings.some((w) => w.includes("not built yet")));
  });

  it("size-scaled-combat needs both combat-motor and size-scaling", () => {
    const partial = validateSystemSelection([{ id: "combat-motor" }, { id: "size-scaled-combat" }]);
    assert.equal(partial.ok, false);
    assert.ok(partial.errors.some((e) => e.includes("size-scaling")));
    const full = validateSystemSelection([
      { id: "combat-motor" }, { id: "size-scaling" }, { id: "physics-modifiers" }, { id: "size-scaled-combat" },
    ]);
    assert.equal(full.ok, true);
  });

  it("resolved configs are coerced", () => {
    const r = validateSystemSelection([{ id: "physics-modifiers", config: { gravity: 5000 } }]);
    assert.equal(r.ok, true);
    assert.equal(r.resolved[0].config.gravity, 300);
  });

  it("rejects a non-array input cleanly", () => {
    const r = validateSystemSelection("nope");
    assert.equal(r.ok, false);
  });
});

describe("read helpers", () => {
  it("listSystems filters by category", () => {
    const combat = listSystems({ category: CATEGORIES.COMBAT });
    assert.ok(combat.length >= 1);
    assert.ok(combat.every((s) => s.category === "combat"));
  });

  it("getConfigSchema returns the schema or null", () => {
    assert.ok(getConfigSchema("terrain-biomes"));
    assert.equal(getConfigSchema("nope"), null);
  });
});
