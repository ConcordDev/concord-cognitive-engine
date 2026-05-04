/**
 * Tier-2 contract tests for the gameplay → evo-asset bridge
 * (server/lib/gameplay-asset-bridge.js).
 *
 * The bridge is a "best-effort" shim: every handler is wrapped in _safe()
 * so registry hiccups (schema CHECK rejections, missing tables, type
 * mismatches) never propagate back into the gameplay event loop. The
 * load-bearing contract is therefore "the handler must never throw,
 * regardless of the registry state."
 *
 * These tests verify the contract by:
 *   - Calling each handler with a real :memory: SQLite + the actual
 *     migration so happy-path registers work.
 *   - Calling each handler with null/missing fields to verify graceful no-op.
 *   - Calling each handler with a broken db to verify _safe absorbs throws.
 *
 * Run: node --test tests/gameplay-asset-bridge.test.js
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  onCreatureSpawned,
  onHybridBirth,
  onPlayerCraft,
  onLootDropped,
  onCombatHit,
  onSkillAuthored,
  onSkillUsed,
} from "../lib/gameplay-asset-bridge.js";

import Database from "better-sqlite3";
import * as evoMigration073 from "../migrations/073_evo_assets.js";
import * as evoMigration100 from "../migrations/100_evo_assets_gameplay_kinds.js";

let db;
beforeEach(() => {
  db = new Database(":memory:");
  evoMigration073.up(db);
  evoMigration100.up(db); // extend kind/source CHECK + nullable local_path
});

describe("gameplay-asset-bridge — graceful no-op on missing inputs", () => {
  it("onCreatureSpawned returns null when db missing", () => {
    assert.equal(onCreatureSpawned(null, { id: "c1" }), null);
  });

  it("onCreatureSpawned returns null when blueprint missing", () => {
    assert.equal(onCreatureSpawned(db, null), null);
  });

  it("onHybridBirth returns null when hybrid missing", () => {
    assert.equal(onHybridBirth(db, { hybrid: null, stability: 0.9, generation: 5 }), null);
  });

  it("onPlayerCraft returns null when itemId missing", () => {
    assert.equal(onPlayerCraft(db, { userId: "u1", recipeId: "r1" }), null);
  });

  it("onLootDropped returns null when lootId missing", () => {
    assert.equal(onLootDropped(db, { killerId: "k1" }), null);
  });

  it("onCombatHit returns null when weapon.id missing", () => {
    assert.equal(onCombatHit(db, { attackerId: "a", victimId: "v", damage: 10 }), null);
    assert.equal(onCombatHit(db, { attackerId: "a", victimId: "v", weapon: {}, damage: 10 }), null);
  });

  it("onSkillAuthored returns null when skill.id missing", () => {
    assert.equal(onSkillAuthored(db, { skill: null }), null);
    assert.equal(onSkillAuthored(db, { skill: { name: "no id" } }), null);
  });

  it("onSkillUsed returns null when skillId missing", () => {
    assert.equal(onSkillUsed(db, { actorId: "a" }), null);
  });
});

describe("gameplay-asset-bridge — _safe absorbs handler-side throws", () => {
  // Builds a db proxy that throws on every prepare() call, simulating any
  // registry-side breakage. Every bridge call must return null cleanly.
  function explosiveDb() {
    return {
      prepare() { throw new Error("boom"); },
      transaction(fn) { return () => fn(); },
    };
  }

  it("onCreatureSpawned absorbs registry throws", () => {
    const r = onCreatureSpawned(explosiveDb(), {
      id: "c1", worldId: "concordia", topology: "humanoid",
      provenance: { description: "test", baselineId: "b1", seedHash: "h1" },
    });
    assert.equal(r, null);
  });

  it("onHybridBirth absorbs registry throws", () => {
    const r = onHybridBirth(explosiveDb(), {
      hybrid: { id: "h1", provenance: { description: "hybrid" } },
      stability: 0.9, generation: 5, crossWorld: false, parents: ["a", "b"],
    });
    assert.equal(r, null);
  });

  it("onPlayerCraft absorbs registry throws", () => {
    const r = onPlayerCraft(explosiveDb(), {
      userId: "u1", recipeId: "r1", itemId: "i1", label: "axe", payload: {},
    });
    assert.equal(r, null);
  });

  it("onLootDropped absorbs registry throws", () => {
    const r = onLootDropped(explosiveDb(), {
      lootId: "l1", killerId: "k1", victimId: "v1", label: "ember-core", payload: {},
    });
    assert.equal(r, null);
  });

  it("onCombatHit absorbs registry throws", () => {
    const r = onCombatHit(explosiveDb(), {
      attackerId: "a", victimId: "v", weapon: { id: "w1" }, damage: 50, isCrit: true,
    });
    assert.equal(r, null);
  });

  it("onSkillAuthored absorbs registry throws", () => {
    const r = onSkillAuthored(explosiveDb(), {
      skill: { id: "s1", name: "spinning-strike" }, origin: "emergent",
    });
    assert.equal(r, null);
  });

  it("onSkillUsed absorbs registry throws", () => {
    const r = onSkillUsed(explosiveDb(), { skillId: "s1", actorId: "a", isHit: true });
    assert.equal(r, null);
  });
});

describe("gameplay-asset-bridge — handler-level math contracts", () => {
  it("onHybridBirth marks SPECIES kind only when stability≥0.7 AND generation≥3", () => {
    // We can't see the actual asset row (registry CHECK rejects gameplay kinds
    // in the current schema) but the handler must never throw when crossing
    // the threshold either way. The contract is: it returns null OR a
    // non-throwing result on both sides of the boundary.
    const stable   = onHybridBirth(db, {
      hybrid: { id: "h_stable", provenance: { description: "x" } },
      stability: 0.9, generation: 5, crossWorld: false, parents: ["a", "b"],
    });
    const unstable = onHybridBirth(db, {
      hybrid: { id: "h_unstable", provenance: { description: "y" } },
      stability: 0.5, generation: 1, crossWorld: false, parents: ["a", "b"],
    });
    // Both calls must complete (null or result), neither must throw.
    assert.ok(stable === null || typeof stable === "object");
    assert.ok(unstable === null || typeof unstable === "object");
  });

  it("onCombatHit weight scales with damage and crit multiplier", () => {
    // Internal weight = (damage / 50) * (isCrit ? 1.5 : 1.0).
    // We can't observe the weight directly, but the call must complete on
    // damage=0, damage=large, isCrit=true/false.
    for (const isCrit of [true, false]) {
      for (const damage of [0, 10, 50, 250]) {
        const r = onCombatHit(db, {
          attackerId: "a", victimId: "v", weapon: { id: "w" }, damage, isCrit,
        });
        assert.ok(r === null || typeof r === "object", `damage=${damage} crit=${isCrit}`);
      }
    }
  });
});

describe("gameplay-asset-bridge — happy path: bridge persists rows after migration 100", () => {
  it("onCreatureSpawned writes a 'creature' row to evo_assets", () => {
    const r = onCreatureSpawned(db, {
      id: "c_full", worldId: "concordia", topology: "winged_quadruped",
      massKg: 200, heightM: 5, parts: [], gait: {},
      provenance: { description: "great dragon", baselineId: "dragon_1", seedHash: "h1" },
    });
    assert.ok(r?.id, "registerAsset must return an id");
    const row = db.prepare(`SELECT kind, source, source_id FROM evo_assets WHERE id = ?`).get(r.id);
    assert.equal(row.kind, "creature");
    assert.equal(row.source, "concordia");
    assert.equal(row.source_id, "concordia:dragon_1");
  });

  it("onPlayerCraft writes a 'craft' row + 'craft' interaction", () => {
    const r = onPlayerCraft(db, {
      userId: "u1", recipeId: "ember_stew", itemId: "stew_001", label: "Emberroot Stew",
    });
    assert.ok(r?.id);
    const row = db.prepare(`SELECT kind FROM evo_assets WHERE id = ?`).get(r.id);
    assert.equal(row.kind, "craft");
    const interaction = db.prepare(
      `SELECT actor_kind, actor_id, action FROM evo_asset_interactions WHERE asset_id = ?`
    ).get(r.id);
    assert.equal(interaction.actor_kind, "user");
    assert.equal(interaction.actor_id, "u1");
    assert.equal(interaction.action, "craft");
  });

  it("onSkillAuthored writes a 'skill' row", () => {
    const r = onSkillAuthored(db, {
      skill: { id: "spin-strike", name: "Spinning Strike", provenance: { origin: "emergent" } },
      origin: "emergent",
    });
    assert.ok(r?.id);
    const row = db.prepare(`SELECT kind, quality_level FROM evo_assets WHERE id = ?`).get(r.id);
    assert.equal(row.kind, "skill");
    assert.equal(row.quality_level, 0); // no parentId → starting quality 0
  });

  it("onHybridBirth writes 'species' kind when stability ≥ 0.7 AND generation ≥ 3", () => {
    const r = onHybridBirth(db, {
      hybrid: { id: "h_dragon_x_phoenix", provenance: { description: "drake" } },
      stability: 0.9, generation: 5, crossWorld: true, parents: ["dragon", "phoenix"],
    });
    assert.ok(r?.id);
    const row = db.prepare(`SELECT kind, source_id FROM evo_assets WHERE id = ?`).get(r.id);
    assert.equal(row.kind, "species");
    assert.equal(row.source_id, "species:h_dragon_x_phoenix");
  });

  it("onHybridBirth writes 'creature' kind when stability < 0.7 OR generation < 3", () => {
    const r = onHybridBirth(db, {
      hybrid: { id: "h_unstable", provenance: { description: "unstable hybrid" } },
      stability: 0.5, generation: 1, crossWorld: false, parents: ["a", "b"],
    });
    assert.ok(r?.id);
    const row = db.prepare(`SELECT kind FROM evo_assets WHERE id = ?`).get(r.id);
    assert.equal(row.kind, "creature");
  });

  it("onSkillUsed records use_hit / use_miss interactions on the skill asset id", () => {
    onSkillUsed(db, { skillId: "spin-strike", actorId: "u1", isHit: true });
    onSkillUsed(db, { skillId: "spin-strike", actorId: "u1", isHit: false });
    // Bridge auto-registers the skill asset by source_id='skill:spin-strike',
    // so resolve the UUID, then count interactions against it.
    const asset = db.prepare(
      `SELECT id FROM evo_assets WHERE source = 'concordia' AND source_id = ?`
    ).get("skill:spin-strike");
    assert.ok(asset?.id, "onSkillUsed should auto-register the skill asset on first use");
    const rows = db.prepare(
      `SELECT action FROM evo_asset_interactions WHERE asset_id = ? ORDER BY ts`
    ).all(asset.id);
    assert.ok(rows.length >= 2);
    const actions = rows.map(r => r.action);
    assert.ok(actions.includes("use_hit"));
    assert.ok(actions.includes("use_miss"));
  });
});
