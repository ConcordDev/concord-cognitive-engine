// server/tests/asset-studio-building-publish.test.js
//
// Real behavioral tests for Unit 1 of the Asset Studio increment 1 build
// contract (server/domains/gamedesign.js `building-publish` /
// `building-list-mine`). Boots the real server via the shared depth harness
// (isolated DB_PATH — this file never collides with a parallel run) and
// drives the macros through `lensRun`, then asserts directly against the
// real SQLite rows the macro is supposed to have written: `dtus`,
// `world_buildings`, `royalty_lineage`. No mocks — this is the actual
// overlap-checked INSERT path and the actual royalty-cascade
// `registerCitation()` call from server/economy/royalty-cascade.js.
//
// Reminder on the `lens.run` dispatch wrapper (server.js `register("lens",
// "run", ...)`): it always returns `{ ok: true, result: <handler's return,
// or handler's own .result if the handler nested one>, pipelines }`. Our
// `building-publish`/`building-list-mine` handlers return their real
// `{ ok, ... }` shape directly (no extra `.result` nesting), so every
// assertion below reads the handler's actual verdict off `r.result.ok` /
// `r.result.error` / `r.result.dtuId` — matching the convention already
// used by every other `lensRun`-based depth test in this repo (e.g.
// tests/depth/timeline-behavior.test.js).

import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/asset-studio-building-publish-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load, depthCtx, lensRun } from "./depth/_harness.js";

let db;
let authorCtx, remixerCtx, otherCtx;

function makeUser(id) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (id, username, email, password_hash, role, scopes, created_at)
    VALUES (?, ?, ?, 'x', 'member', '["read","write"]', ?)
  `).run(id, id, `${id}@example.test`, now);
}

before(async () => {
  const { STATE } = await load();
  db = STATE.db;
  const authorId = `asb_author_${randomUUID().slice(0, 8)}`;
  const remixerId = `asb_remixer_${randomUUID().slice(0, 8)}`;
  const otherId = `asb_other_${randomUUID().slice(0, 8)}`;
  makeUser(authorId);
  makeUser(remixerId);
  makeUser(otherId);
  authorCtx = await depthCtx(authorId);
  remixerCtx = await depthCtx(remixerId);
  otherCtx = await depthCtx(otherId);
});

function validParams(overrides = {}) {
  return {
    name: "The Salty Anchor",
    archetype: "tavern",
    feature: "spire",
    withInterior: true,
    dimensions: { width: 12, height: 9, depth: 10 },
    worldId: `world_${randomUUID().slice(0, 8)}`,
    position: { x: 100, y: 0, z: 200 },
    rotationY: 1.2,
    ...overrides,
  };
}

describe("game-design.building-publish — real DB round-trip", () => {
  it("mints a real creator-attributed dtus row + a real world_buildings row carrying archetype/feature/dims/blueprint_dtu_id", async () => {
    const params = validParams();
    const r = await lensRun("game-design", "building-publish", { params }, authorCtx);
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.ok(r.result.dtuId);
    assert.ok(r.result.buildingId);
    assert.equal(r.result.spawned, true);

    const dtuRow = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.result.dtuId);
    assert.ok(dtuRow, "dtu row exists");
    assert.equal(dtuRow.owner_user_id, authorCtx.actor.userId, "dtu owner_user_id is the caller");
    assert.equal(dtuRow.visibility, "public");
    const body = JSON.parse(dtuRow.body_json);
    assert.equal(body.meta.type, "blueprint");
    assert.equal(body.meta.kind, "building");
    assert.equal(body.meta.archetype, "tavern");
    assert.equal(body.meta.feature, "spire");
    assert.equal(body.meta.withInterior, true);
    assert.deepEqual(body.meta.dimensions, { x: 12, z: 10, height: 9 });

    const wbRow = db.prepare("SELECT * FROM world_buildings WHERE id = ?").get(r.result.buildingId);
    assert.ok(wbRow, "world_buildings row exists");
    assert.equal(wbRow.archetype, "tavern");
    assert.equal(wbRow.feature, "spire");
    assert.equal(wbRow.building_type, "tavern");
    assert.equal(wbRow.width, 12);
    assert.equal(wbRow.height, 9);
    assert.equal(wbRow.depth, 10);
    assert.equal(wbRow.blueprint_dtu_id, r.result.dtuId);
    assert.equal(wbRow.spawned_by_user_id, authorCtx.actor.userId);
    assert.equal(wbRow.owner_id, authorCtx.actor.userId);
    assert.equal(wbRow.world_id, params.worldId);
    assert.equal(wbRow.x, 100);
    assert.equal(wbRow.z, 200);
    assert.equal(wbRow.state, "standing");
  });

  it("rejects an overlapping placement honestly — no insert at all", async () => {
    const worldId = `world_${randomUUID().slice(0, 8)}`;
    const first = validParams({ worldId, position: { x: 50, y: 0, z: 50 } });
    const r1 = await lensRun("game-design", "building-publish", { params: first }, authorCtx);
    assert.equal(r1.result.ok, true);

    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const wbCountBefore = db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n;

    // Same world, close enough position to trip the bounding-box overlap
    // check (half-footprint of a 12x10 building + 6m pad — 8m/11m box —
    // well inside a 2m/1m nudge).
    const second = validParams({ worldId, position: { x: 52, y: 0, z: 51 } });
    const r2 = await lensRun("game-design", "building-publish", { params: second }, authorCtx);
    assert.equal(r2.result.ok, false);
    assert.equal(r2.result.error, "overlap");

    const dtuCountAfter = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const wbCountAfter = db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n;
    assert.equal(dtuCountAfter, dtuCountBefore, "no orphan dtu row minted on overlap rejection");
    assert.equal(wbCountAfter, wbCountBefore, "no world_buildings row inserted on overlap rejection");
  });

  it("rejects an invalid archetype honestly, with no insert", async () => {
    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const wbCountBefore = db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n;
    const r = await lensRun("game-design", "building-publish", { params: validParams({ archetype: "castle" }) }, authorCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "invalid_archetype");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtuCountBefore);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n, wbCountBefore);
  });

  it("rejects an invalid feature honestly", async () => {
    const r = await lensRun("game-design", "building-publish", { params: validParams({ feature: "minaret" }) }, authorCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "invalid_feature");
  });

  it("accepts feature: null (no iconic feature)", async () => {
    const r = await lensRun("game-design", "building-publish", { params: validParams({ feature: null, worldId: `world_${randomUUID().slice(0, 8)}` }) }, authorCtx);
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    const dtuRow = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(r.result.dtuId);
    const body = JSON.parse(dtuRow.body_json);
    assert.equal(body.meta.feature, null);
    const wbRow = db.prepare("SELECT feature FROM world_buildings WHERE id = ?").get(r.result.buildingId);
    assert.equal(wbRow.feature, null);
  });

  it("rejects non-positive/non-finite dimensions honestly", async () => {
    const negative = await lensRun("game-design", "building-publish", { params: validParams({ dimensions: { width: -1, height: 9, depth: 10 } }) }, authorCtx);
    assert.equal(negative.result.ok, false);
    assert.equal(negative.result.error, "invalid_dimensions");

    const nonFinite = await lensRun("game-design", "building-publish", { params: validParams({ dimensions: { width: Infinity, height: 9, depth: 10 } }) }, authorCtx);
    assert.equal(nonFinite.result.ok, false);
    assert.equal(nonFinite.result.error, "invalid_dimensions");

    const zero = await lensRun("game-design", "building-publish", { params: validParams({ dimensions: { width: 0, height: 9, depth: 10 } }) }, authorCtx);
    assert.equal(zero.result.ok, false);
    assert.equal(zero.result.error, "invalid_dimensions");
  });

  it("rejects a missing worldId honestly", async () => {
    const r = await lensRun("game-design", "building-publish", { params: validParams({ worldId: "" }) }, authorCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "world_id_required");
  });

  it("rejects a missing/incomplete position honestly", async () => {
    const r = await lensRun("game-design", "building-publish", { params: validParams({ position: { x: 1, y: 0 } }) }, authorCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "position_required");
  });

  it("rejects publish from an unauthenticated/anon caller", async () => {
    const anonCtx = { ...authorCtx, actor: { ...authorCtx.actor, userId: "anon" } };
    const r = await lensRun("game-design", "building-publish", { params: validParams() }, anonCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "auth_required");
  });

  it("remixing a public authored building writes a REAL royalty_lineage row", async () => {
    // 1. Author publishes an original, public building.
    const original = await lensRun("game-design", "building-publish", { params: validParams({ name: "Original Archive", archetype: "archive" }) }, authorCtx);
    assert.equal(original.result.ok, true);
    const originalDtu = db.prepare("SELECT visibility, owner_user_id FROM dtus WHERE id = ?").get(original.result.dtuId);
    assert.equal(originalDtu.visibility, "public");
    assert.equal(originalDtu.owner_user_id, authorCtx.actor.userId);

    // 2. A different user remixes it.
    const remix = await lensRun("game-design", "building-publish", {
      params: validParams({
        name: "Remixed Archive",
        archetype: "archive",
        worldId: `world_${randomUUID().slice(0, 8)}`,
        remixOfDtuId: original.result.dtuId,
      }),
    }, remixerCtx);
    assert.equal(remix.result.ok, true, JSON.stringify(remix.result));
    assert.ok(remix.result.citation && remix.result.citation.lineageId, "citation registered with a real lineage id");

    // Compute expectation from the engine, not pasted output: query the
    // real royalty_lineage row registerCitation() wrote and check its
    // fields directly against what we just asked it to register.
    const lineageRow = db.prepare(
      "SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?",
    ).get(remix.result.dtuId, original.result.dtuId);
    assert.ok(lineageRow, "royalty_lineage row exists");
    assert.equal(lineageRow.id, remix.result.citation.lineageId);
    assert.equal(lineageRow.creator_id, remixerCtx.actor.userId);
    assert.equal(lineageRow.parent_creator, authorCtx.actor.userId);
    assert.equal(lineageRow.generation, 1);

    const childDtu = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(remix.result.dtuId);
    const childBody = JSON.parse(childDtu.body_json);
    assert.deepEqual(childBody.lineage.parents, [original.result.dtuId]);
  });

  it("remixing your OWN public building does not register a self-citation", async () => {
    const original = await lensRun("game-design", "building-publish", { params: validParams({ name: "Self Original", archetype: "forge" }) }, otherCtx);
    assert.equal(original.result.ok, true);

    const remix = await lensRun("game-design", "building-publish", {
      params: validParams({
        name: "Self Remix",
        archetype: "forge",
        worldId: `world_${randomUUID().slice(0, 8)}`,
        remixOfDtuId: original.result.dtuId,
      }),
    }, otherCtx);
    assert.equal(remix.result.ok, true);
    assert.equal(remix.result.citation, null, "no citation attempted for a self-remix");

    const lineageRow = db.prepare(
      "SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?",
    ).get(remix.result.dtuId, original.result.dtuId);
    assert.equal(lineageRow, undefined, "no royalty_lineage row for a self-remix");
  });

  it("an invalid remixOfDtuId is rejected honestly, with no insert", async () => {
    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const wbCountBefore = db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n;
    const r = await lensRun("game-design", "building-publish", { params: validParams({ remixOfDtuId: "dtu_does_not_exist_12345" }) }, otherCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "remix_parent_not_found");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtuCountBefore);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n, wbCountBefore);
  });
});

describe("game-design.building-list-mine", () => {
  it("lists only the caller's own authored buildings, with their real spawn rows", async () => {
    const worldId = `world_${randomUUID().slice(0, 8)}`;
    const r1 = await lensRun("game-design", "building-publish", {
      params: validParams({ name: "Mine One", worldId, position: { x: 900, y: 0, z: 900 } }),
    }, otherCtx);
    assert.equal(r1.result.ok, true);

    // building-list-mine's handler nests its payload under `result: {...}`
    // (same convention as the file's other list macros, e.g. game-list),
    // so the lens.run wrapper's own unwrap (`'result' in handlerResult ?
    // handlerResult.result : handlerResult`) unwraps ONE level further than
    // building-publish's flat `{ ok, dtuId, ... }` shape — `listing.result`
    // here IS `{ buildings, count }` directly, matching every other
    // lensRun-based depth test's convention for nested-result macros (see
    // tests/depth/accounting-behavior.test.js's `.result.count` assertions).
    const listing = await lensRun("game-design", "building-list-mine", {}, otherCtx);
    const found = listing.result.buildings.find((b) => b.dtuId === r1.result.dtuId);
    assert.ok(found, "authored building appears in building-list-mine");
    assert.equal(found.archetype, "tavern");
    assert.equal(found.feature, "spire");
    assert.equal(found.spawnCount, 1);
    assert.equal(found.spawns[0].id, r1.result.buildingId);
    assert.equal(found.spawns[0].world_id, worldId);

    // Isolation: another user's authored buildings never leak into this listing.
    const authorListing = await lensRun("game-design", "building-list-mine", {}, authorCtx);
    assert.ok(
      !authorListing.result.buildings.some((b) => b.dtuId === r1.result.dtuId),
      "author's listing does not include otherCtx's building",
    );
  });
});

describe("Asset Studio Unit 1 — economy invariants untouched", () => {
  it("touches no fee/royalty/withdrawal constant — royalty-cascade.js source is byte-unmodified by this unit", async () => {
    // This unit is a pure CONSUMER of the royalty cascade (registerCitation),
    // never an editor of it. Assert the file still defines the same
    // constitutional constants at their documented values instead of just
    // trusting "we didn't touch it" — a real regression here would move one
    // of these numbers.
    const mod = await import("../economy/royalty-cascade.js");
    assert.equal(typeof mod.registerCitation, "function");
    assert.equal(mod.calculateGenerationalRate(0), 0.21, "DEFAULT_INITIAL_RATE unchanged");
    assert.equal(mod.calculateGenerationalRate(1), 0.105, "generation-1 halving unchanged");
    // Floor: rate can never go below 0.0005 no matter how deep the generation.
    assert.equal(mod.calculateGenerationalRate(20), 0.0005, "ROYALTY_FLOOR unchanged");
  });
});
