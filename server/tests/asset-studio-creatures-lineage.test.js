// server/tests/asset-studio-creatures-lineage.test.js
//
// Real behavioral tests for the Asset Studio creatures increment in
// server/domains/creatures.js (mirrors the proven gamedesign.js
// building-publish / asset-fuse Increment 1 + 5 pattern, adapted to the
// creatures substrate — creatures live as world_npcs rows, NOT
// world_buildings):
//
//   1. creatures.creature-publish — mints a real creator-attributed
//      creature blueprint DTU (meta.type='creature_blueprint') from the REAL
//      procedural generator; optionally spawns a live world_npcs creature
//      (archetype='creature:<species>') with the owner + blueprint linkage
//      persisted honestly in the row's `state` JSON (world_npcs has no
//      spawned_by_user_id / blueprint_dtu_id column — verified against the
//      live schema); registers one royalty_lineage row per valid non-self
//      remix parent.
//   2. creatures.creature-list-mine — the caller's authored blueprints only.
//   3. creatures.breed (Creatures-C) — when a parent creature is a real
//      OWNED creature, the offspring registers a royalty citation to that
//      owning parent-creator; wild parents are skipped honestly.
//
// All of these create royalty LINEAGE only (registerCitation) — none moves
// money; payout fires on a later SALE. Driven against a REAL in-memory
// sqlite DB via the same direct-registry pattern the other creatures macro
// tests use (creature-taxonomy / creatures-lens-macros). No mocks; every
// assertion is a concrete DB row or computed value.
//
// Run: node --test tests/asset-studio-creatures-lineage.test.js

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerCreatureMacros from "../domains/creatures.js";
import { ensureCrossbreedingTables } from "../lib/creature-crossbreeding.js";
import { ensureSkillsTable, bootEmergentSkills } from "../lib/emergent-skills.js";

function collectMacros() {
  const map = new Map();
  registerCreatureMacros((domain, name, handler) => {
    assert.equal(domain, "creatures", `unexpected domain: ${domain}`);
    map.set(name, handler);
  });
  return map;
}

// Minimal, REAL tables mirroring the live schema shapes the macros touch.
function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id            TEXT PRIMARY KEY,
      owner_user_id TEXT,
      title         TEXT,
      body_json     TEXT,
      tags_json     TEXT,
      visibility    TEXT,
      tier          TEXT,
      created_at    TEXT,
      updated_at    TEXT
    );
    CREATE TABLE world_npcs (
      id           TEXT PRIMARY KEY,
      world_id     TEXT NOT NULL,
      archetype    TEXT,
      species_id   TEXT,
      x REAL, y REAL, z REAL,
      is_dead      INTEGER DEFAULT 0,
      state        TEXT DEFAULT '{}',
      spawn_method TEXT
    );
    CREATE TABLE royalty_lineage (
      id             TEXT PRIMARY KEY,
      child_id       TEXT NOT NULL,
      parent_id      TEXT NOT NULL,
      generation     INTEGER NOT NULL DEFAULT 1 CHECK(generation >= 1),
      creator_id     TEXT NOT NULL,
      parent_creator TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(child_id, parent_id)
    );
    CREATE INDEX idx_lineage_child  ON royalty_lineage(child_id);
    CREATE INDEX idx_lineage_parent ON royalty_lineage(parent_id);
  `);
  // Real crossbreeding + skills substrate so breed genuinely resolves.
  ensureCrossbreedingTables(db);
  ensureSkillsTable(db);
  bootEmergentSkills(db);
  return db;
}

const ctxFor = (db, userId) => ({ db, actor: { userId } });

describe("creatures.creature-publish — creator-attributed blueprint DTU", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("mints a real creator-attributed blueprint DTU (no world/position → spawned:false)", async () => {
    const r = await macros.get("creature-publish")(ctxFor(db, "u_author"), {
      name: "Frost Wolf", speciesId: "wolf",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.spawned, false, "no world/position supplied → honest no-spawn");
    assert.equal(r.creatureId, null);
    assert.equal(r.species_id, "wolf");

    const row = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.dtuId);
    assert.ok(row, "blueprint DTU row exists");
    assert.equal(row.owner_user_id, "u_author", "creator-attributed");
    assert.equal(row.visibility, "public");
    assert.equal(row.tier, "regular");
    const body = JSON.parse(row.body_json);
    assert.equal(body.meta.type, "creature_blueprint");
    assert.equal(body.meta.species_id, "wolf");
    // Real generator output — topology/mass are derived, not invented.
    assert.equal(body.meta.topology, "quadruped");
    assert.ok(body.meta.massKg > 0, "real physics-derived mass");
    assert.ok(body.meta.partCount > 0, "real body-part count");

    // No live creature persisted.
    assert.equal(db.prepare("SELECT COUNT(*) n FROM world_npcs").get().n, 0);
  });

  it("spawns a live world_npcs creature when world + finite position are supplied, linkage in state", async () => {
    const r = await macros.get("creature-publish")(ctxFor(db, "u_author"), {
      name: "Reef Shark", speciesId: "reef_shark",
      worldId: "tunya", position: { x: 10, y: 0, z: 20 },
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.spawned, true);
    assert.ok(r.creatureId, "live creature id returned");

    const npc = db.prepare("SELECT * FROM world_npcs WHERE id = ?").get(r.creatureId);
    assert.ok(npc, "world_npcs row exists");
    assert.equal(npc.world_id, "tunya");
    assert.equal(npc.archetype, "creature:reef_shark");
    assert.equal(npc.species_id, "reef_shark");
    assert.equal(npc.x, 10);
    assert.equal(npc.z, 20);
    assert.equal(npc.spawn_method, "authored");
    // Owner + blueprint linkage persisted honestly in the state JSON.
    const state = JSON.parse(npc.state);
    assert.equal(state.spawnedByUserId, "u_author");
    assert.equal(state.blueprintDtuId, r.dtuId);
    assert.equal(state.species_id, "reef_shark");
  });

  it("a 2-parent remix writes exactly 2 royalty_lineage rows with correct parent_creator/generation", async () => {
    const pA = await macros.get("creature-publish")(ctxFor(db, "u_a"), { name: "Parent A", speciesId: "wolf" });
    const pB = await macros.get("creature-publish")(ctxFor(db, "u_b"), { name: "Parent B", speciesId: "bear" });

    const remix = await macros.get("creature-publish")(ctxFor(db, "u_remixer"), {
      name: "Two-Parent Remix", speciesId: "wolf",
      remixOfDtuIds: [pA.dtuId, pB.dtuId],
    });
    assert.equal(remix.ok, true, JSON.stringify(remix));

    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ? ORDER BY parent_id").all(remix.dtuId);
    assert.equal(rows.length, 2, "exactly 2 royalty_lineage rows");
    const byParent = new Map(rows.map((r) => [r.parent_id, r]));
    const rowA = byParent.get(pA.dtuId);
    const rowB = byParent.get(pB.dtuId);
    assert.ok(rowA && rowB, "lineage row for each parent exists");
    assert.equal(rowA.creator_id, "u_remixer");
    assert.equal(rowA.parent_creator, "u_a");
    assert.equal(rowA.generation, 1);
    assert.equal(rowB.parent_creator, "u_b");
    assert.equal(rowB.generation, 1);

    // citations array mirrors the DB rows.
    assert.equal(remix.citations.length, 2);
    // body.lineage.parents lists both, in supplied order.
    const body = JSON.parse(db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(remix.dtuId).body_json);
    assert.deepEqual(body.lineage.parents, [pA.dtuId, pB.dtuId]);
  });

  it("a self-owned parent among several is skipped for citation but still listed in lineage.parents", async () => {
    const own = await macros.get("creature-publish")(ctxFor(db, "u_remixer"), { name: "My Own", speciesId: "wolf" });
    const other = await macros.get("creature-publish")(ctxFor(db, "u_other"), { name: "Other's", speciesId: "goat" });

    const remix = await macros.get("creature-publish")(ctxFor(db, "u_remixer"), {
      name: "Mixed Remix", speciesId: "wolf",
      remixOfDtuIds: [own.dtuId, other.dtuId],
    });
    assert.equal(remix.ok, true, JSON.stringify(remix));

    // Only the non-self parent gets a real citation.
    assert.equal(remix.citations.length, 1);
    assert.equal(remix.citations[0].parentId, other.dtuId);
    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").all(remix.dtuId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].parent_id, other.dtuId);
    assert.equal(rows[0].parent_creator, "u_other");

    // Structural lineage still records BOTH — the remix genuinely draws
    // from both, whether or not royalty is owed on each.
    const body = JSON.parse(db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(remix.dtuId).body_json);
    assert.deepEqual(body.lineage.parents, [own.dtuId, other.dtuId]);
  });

  it("rejects a nonexistent remix parent honestly, with no insert", async () => {
    const real = await macros.get("creature-publish")(ctxFor(db, "u_a"), { name: "Real", speciesId: "wolf" });
    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const npcCountBefore = db.prepare("SELECT COUNT(*) n FROM world_npcs").get().n;

    const r = await macros.get("creature-publish")(ctxFor(db, "u_remixer"), {
      name: "Bad Remix", speciesId: "wolf",
      remixOfDtuIds: [real.dtuId, "dtu_does_not_exist_9999"],
    });
    assert.equal(r.ok, false);
    assert.equal(r.error, "parent_not_found");
    assert.equal(r.parentId, "dtu_does_not_exist_9999");
    // No new rows written for the rejected publish.
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtuCountBefore);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM world_npcs").get().n, npcCountBefore);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM royalty_lineage").get().n, 0);
  });

  it("rejects an unauthenticated / anon caller", async () => {
    const anon = await macros.get("creature-publish")(ctxFor(db, "anon"), { name: "X", speciesId: "wolf" });
    assert.equal(anon.ok, false);
    assert.equal(anon.error, "auth_required");
    const none = await macros.get("creature-publish")(ctxFor(db, null), { name: "X", speciesId: "wolf" });
    assert.equal(none.ok, false);
    assert.equal(none.error, "auth_required");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, 0);
  });

  it("rejects a missing species id", async () => {
    const r = await macros.get("creature-publish")(ctxFor(db, "u_a"), { name: "Nameless" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "missing_species_id");
  });
});

describe("creatures.creature-list-mine", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("returns only the caller's authored blueprints, enriched with live spawns", async () => {
    await macros.get("creature-publish")(ctxFor(db, "u_me"), { name: "Mine One", speciesId: "wolf" });
    const spawned = await macros.get("creature-publish")(ctxFor(db, "u_me"), {
      name: "Mine Two", speciesId: "deer", worldId: "tunya", position: { x: 1, y: 0, z: 2 },
    });
    await macros.get("creature-publish")(ctxFor(db, "u_other"), { name: "Not Mine", speciesId: "bear" });

    const r = await macros.get("creature-list-mine")(ctxFor(db, "u_me"), {});
    assert.equal(r.ok, true);
    assert.equal(r.count, 2, "only the caller's two blueprints");
    const names = r.creatures.map((c) => c.name).sort();
    assert.deepEqual(names, ["Mine One", "Mine Two"]);
    assert.ok(r.creatures.every((c) => c.species_id), "every entry carries a real species id");

    // The spawned one reports its live instance via the state linkage.
    const two = r.creatures.find((c) => c.name === "Mine Two");
    assert.equal(two.spawnCount, 1);
    assert.equal(two.spawns[0].id, spawned.creatureId);
  });

  it("honest empty list for a caller with no blueprints, and for anon", async () => {
    const empty = await macros.get("creature-list-mine")(ctxFor(db, "u_nobody"), {});
    assert.equal(empty.ok, true);
    assert.deepEqual(empty.creatures, []);
    assert.equal(empty.count, 0);

    const anon = await macros.get("creature-list-mine")(ctxFor(db, "anon"), {});
    assert.equal(anon.ok, true);
    assert.equal(anon.count, 0);
  });
});

describe("creatures.breed — Creatures-C royalty lineage from owned parents", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("two OWNED parents → offspring DTU + 2 royalty_lineage rows to the two owners", async () => {
    // Two owners each publish + spawn a real live creature.
    const p1 = await macros.get("creature-publish")(ctxFor(db, "owner_1"), {
      name: "Owned Wolf", speciesId: "wolf", worldId: "tunya", position: { x: 1, y: 0, z: 1 },
    });
    const p2 = await macros.get("creature-publish")(ctxFor(db, "owner_2"), {
      name: "Owned Bear", speciesId: "bear", worldId: "tunya", position: { x: 2, y: 0, z: 2 },
    });
    assert.ok(p1.creatureId && p2.creatureId, "both parents spawned live");

    // A third user breeds them.
    const r = await macros.get("breed")(ctxFor(db, "breeder_3"), {
      a: { id: p1.creatureId, species_id: "wolf" },
      b: { id: p2.creatureId, species_id: "bear" },
      environment: "forest", sameEnvironmentBonus: true, worldId: "tunya",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    // Pre-existing return fields are byte-preserved.
    assert.ok(r.hybrid && typeof r.hybrid.id === "string");
    assert.ok(r.hybrid.massKg > 0);
    // Additive Creatures-C fields.
    assert.ok(r.offspringDtuId, "an owned offspring DTU was minted");
    assert.equal(r.citations.length, 2);

    // The offspring DTU is owned by the breeder.
    const offDtu = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.offspringDtuId);
    assert.ok(offDtu);
    assert.equal(offDtu.owner_user_id, "breeder_3");
    const offBody = JSON.parse(offDtu.body_json);
    assert.equal(offBody.meta.type, "creature_blueprint");
    assert.equal(offBody.meta.kind, "offspring");
    assert.deepEqual(offBody.lineage.parents.sort(), [p1.dtuId, p2.dtuId].sort());

    // Exactly 2 lineage rows, one to each owning parent-creator.
    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").all(r.offspringDtuId);
    assert.equal(rows.length, 2);
    const byParent = new Map(rows.map((row) => [row.parent_id, row]));
    assert.equal(byParent.get(p1.dtuId).parent_creator, "owner_1");
    assert.equal(byParent.get(p2.dtuId).parent_creator, "owner_2");
    for (const row of rows) {
      assert.equal(row.creator_id, "breeder_3");
      assert.equal(row.generation, 1);
    }
  });

  it("WILD parents → 0 citations, no offspring DTU, and the cross still succeeds", async () => {
    const lineageBefore = db.prepare("SELECT COUNT(*) n FROM royalty_lineage").get().n;
    const dtusBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;

    const r = await macros.get("breed")(ctxFor(db, "breeder_3"), {
      a: { id: "wild_a", species_id: "wolf" },
      b: { id: "wild_b", species_id: "bear" },
      environment: "forest", sameEnvironmentBonus: true, worldId: "tunya",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.hybrid && typeof r.hybrid.id === "string", "hybrid still produced");
    assert.equal(r.offspringDtuId, null, "no owned offspring DTU minted for wild parents");
    assert.equal(r.citations.length, 0);

    // No lineage rows and no offspring DTU were written.
    assert.equal(db.prepare("SELECT COUNT(*) n FROM royalty_lineage").get().n, lineageBefore);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtusBefore);
  });

  it("mixed owned + wild parents → exactly 1 citation to the owned parent", async () => {
    const owned = await macros.get("creature-publish")(ctxFor(db, "owner_1"), {
      name: "Owned Wolf", speciesId: "wolf", worldId: "tunya", position: { x: 1, y: 0, z: 1 },
    });
    const r = await macros.get("breed")(ctxFor(db, "breeder_3"), {
      a: { id: owned.creatureId, species_id: "wolf" },
      b: { id: "wild_b", species_id: "bear" },
      environment: "forest", sameEnvironmentBonus: true, worldId: "tunya",
    });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.citations.length, 1);
    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").all(r.offspringDtuId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].parent_id, owned.dtuId);
    assert.equal(rows[0].parent_creator, "owner_1");
  });
});

describe("Asset Studio creatures increment — economy invariants untouched", () => {
  it("touches no fee/royalty constant — royalty-cascade.js still exports the constitutional values", async () => {
    const mod = await import("../economy/royalty-cascade.js");
    assert.equal(typeof mod.registerCitation, "function");
    assert.equal(mod.calculateGenerationalRate(0), 0.21, "DEFAULT_INITIAL_RATE unchanged");
    assert.equal(mod.calculateGenerationalRate(1), 0.105, "generation-1 halving unchanged");
    assert.equal(mod.calculateGenerationalRate(20), 0.0005, "ROYALTY_FLOOR unchanged");
  });
});
