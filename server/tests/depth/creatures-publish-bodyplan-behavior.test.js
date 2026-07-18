// tests/depth/creatures-publish-bodyplan-behavior.test.js — REAL behavioral
// test for the body-plan enrichment of `creatures.creature-publish`
// (server/domains/creatures.js). The macro computes a real, physics-validated
// blueprint from the procedural generator (server/lib/procedural-creature.js
// #generateCreature) and stamps topology/massKg/heightM into the DTU body.meta;
// this test pins that those SAME real fields are now also exposed on the macro's
// RETURN payload, so the ConKay 3D creature adapter can render an honest mesh
// without re-reading the DTU body.
//
// Driven through the depth harness (boots server.js once, in-memory, full
// schema) via the live `runMacro` — creature-publish is a `register(...)`
// (MACROS/runMacro) macro, NOT a lens-action, so macroRuntime is the correct
// invoker (lensRun only reaches registerLensAction handlers).
//
// Expected values come from the ENGINE's real output — we assert types/ranges
// and the engine-derived topology, never a hand-typed magic number: massKg and
// heightM are physics-derived per species and must stay finite + positive.
//
// Run: node --test tests/depth/creatures-publish-bodyplan-behavior.test.js
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { macroRuntime } from "./_harness.js";

describe("creatures.creature-publish — body-plan fields on the return payload", () => {
  let runMacro, ctx;
  before(async () => {
    ({ runMacro, ctx } = await macroRuntime("depth-creatures"));
    // dtus.owner_user_id has a FK → users(id); the publish path inserts a DTU
    // owned by the actor, so the internal-ctx userId must exist as a real user.
    ctx.db.prepare(
      "INSERT OR IGNORE INTO users (id, username, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(ctx.actor.userId, "depth-creatures", "depth-creatures@test.local", "x", new Date().toISOString());
  });

  it("no-spawn publish returns real topology (non-empty string) + finite massKg/heightM", async () => {
    // "wolf" resolves to the quadruped baseline in the real generator.
    const r = await runMacro("creatures", "creature-publish", {
      name: "Depth Frost Wolf", speciesId: "wolf",
    }, ctx);

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.spawned, false, "no world/position → honest no-spawn");
    assert.equal(r.species_id, "wolf");

    // The enrichment under test — real body-plan fields on the return.
    assert.equal(typeof r.topology, "string", "topology is a string");
    assert.ok(r.topology.length > 0, "topology is non-empty");
    assert.equal(r.topology, "quadruped", "engine-derived topology for wolf");

    assert.equal(typeof r.massKg, "number");
    assert.ok(Number.isFinite(r.massKg) && r.massKg > 0, `massKg finite + positive (got ${r.massKg})`);

    assert.equal(typeof r.heightM, "number");
    assert.ok(Number.isFinite(r.heightM) && r.heightM > 0, `heightM finite + positive (got ${r.heightM})`);

    // The return mirrors what was stamped into the DTU body.meta — honest, not
    // a second independent computation.
    const row = ctx.db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(r.dtuId);
    assert.ok(row, "blueprint DTU persisted");
    const meta = JSON.parse(row.body_json).meta;
    assert.equal(r.topology, meta.topology, "return topology === body.meta.topology");
    assert.equal(r.massKg, meta.massKg, "return massKg === body.meta.massKg");
    assert.equal(r.heightM, meta.heightM, "return heightM === body.meta.heightM");

    // No fabricated colour field — generateCreature produces none, so the
    // macro must NOT invent one (the frontend mesh builder defaults it).
    assert.equal(Object.prototype.hasOwnProperty.call(r, "coatColor"), false,
      "no coatColor: the engine produces no colour field, so none is invented");
  });

  it("a second species (deer) also carries real, distinct body-plan numbers", async () => {
    const r = await runMacro("creatures", "creature-publish", {
      name: "Depth Meadow Deer", speciesId: "deer",
    }, ctx);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(typeof r.topology, "string");
    assert.ok(r.topology.length > 0);
    assert.ok(Number.isFinite(r.massKg) && r.massKg > 0);
    assert.ok(Number.isFinite(r.heightM) && r.heightM > 0);
  });
});
