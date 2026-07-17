// server/tests/asset-studio-inc5-fusion.test.js
//
// Real behavioral tests for Asset Studio Increment 5 (composition/remix
// flywheel) in server/domains/gamedesign.js:
//   1. `building-publish` extended to accept `remixOfDtuIds: string[]`
//      alongside the pre-existing singular `remixOfDtuId`, registering one
//      real royalty_lineage row per valid non-self parent.
//   2. The new `game-design.asset-fuse` macro — mints a fused blueprint DTU
//      citing 2+ parents.
//
// Both create royalty LINEAGE only (registerCitation) — neither moves
// money. Boots the real server via the shared depth harness (isolated
// DB_PATH) and asserts directly against the real SQLite rows written:
// `dtus`, `world_buildings`, `royalty_lineage`. No mocks.

import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/asset-studio-inc5-fusion-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load, depthCtx, lensRun } from "./depth/_harness.js";

let db;
let aCtx, bCtx, cCtx, fuserCtx;

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
  const aId = `asb5_a_${randomUUID().slice(0, 8)}`;
  const bId = `asb5_b_${randomUUID().slice(0, 8)}`;
  const cId = `asb5_c_${randomUUID().slice(0, 8)}`;
  const fuserId = `asb5_fuser_${randomUUID().slice(0, 8)}`;
  makeUser(aId);
  makeUser(bId);
  makeUser(cId);
  makeUser(fuserId);
  aCtx = await depthCtx(aId);
  bCtx = await depthCtx(bId);
  cCtx = await depthCtx(cId);
  fuserCtx = await depthCtx(fuserId);
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

async function publishOriginal(ctx, overrides = {}) {
  const r = await lensRun("game-design", "building-publish", {
    params: validParams({ archetype: "archive", worldId: `world_${randomUUID().slice(0, 8)}`, ...overrides }),
  }, ctx);
  assert.equal(r.result.ok, true, JSON.stringify(r.result));
  return r.result.dtuId;
}

describe("game-design.building-publish — multi-parent remixOfDtuIds", () => {
  it("a 2-parent remix writes exactly 2 royalty_lineage rows with correct parent_creator/generation", async () => {
    const parentA = await publishOriginal(aCtx, { name: "Parent A" });
    const parentB = await publishOriginal(bCtx, { name: "Parent B" });

    const remix = await lensRun("game-design", "building-publish", {
      params: validParams({
        name: "Two-Parent Remix",
        archetype: "archive",
        worldId: `world_${randomUUID().slice(0, 8)}`,
        remixOfDtuIds: [parentA, parentB],
      }),
    }, fuserCtx);
    assert.equal(remix.result.ok, true, JSON.stringify(remix.result));
    const childId = remix.result.dtuId;

    const rows = db.prepare(
      "SELECT * FROM royalty_lineage WHERE child_id = ? ORDER BY parent_id",
    ).all(childId);
    assert.equal(rows.length, 2, "exactly 2 royalty_lineage rows");

    const byParent = new Map(rows.map((r) => [r.parent_id, r]));
    const rowA = byParent.get(parentA);
    const rowB = byParent.get(parentB);
    assert.ok(rowA, "lineage row for parent A exists");
    assert.ok(rowB, "lineage row for parent B exists");
    assert.equal(rowA.creator_id, fuserCtx.actor.userId);
    assert.equal(rowA.parent_creator, aCtx.actor.userId);
    assert.equal(rowA.generation, 1);
    assert.equal(rowB.creator_id, fuserCtx.actor.userId);
    assert.equal(rowB.parent_creator, bCtx.actor.userId);
    assert.equal(rowB.generation, 1);

    // citations array mirrors the DB rows 1:1
    assert.equal(remix.result.citations.length, 2);
    const citationParentIds = remix.result.citations.map((c) => c.parentId).sort();
    assert.deepEqual(citationParentIds, [parentA, parentB].sort());

    // body.lineage.parents lists both, in the order supplied
    const childDtu = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(childId);
    const childBody = JSON.parse(childDtu.body_json);
    assert.deepEqual(childBody.lineage.parents, [parentA, parentB]);
  });

  it("the single-remixOfDtuId path is unchanged (regression) — one lineage row, citation stays a singular object", async () => {
    const parent = await publishOriginal(aCtx, { name: "Legacy Single Parent" });

    const remix = await lensRun("game-design", "building-publish", {
      params: validParams({
        name: "Legacy Single Remix",
        archetype: "archive",
        worldId: `world_${randomUUID().slice(0, 8)}`,
        remixOfDtuId: parent,
      }),
    }, fuserCtx);
    assert.equal(remix.result.ok, true, JSON.stringify(remix.result));

    // citation (singular) has the exact pre-Increment-5 shape
    assert.ok(remix.result.citation, "citation is set");
    assert.ok(remix.result.citation.lineageId, "citation.lineageId present");
    assert.equal(remix.result.citation.parentId, parent);
    assert.equal(Object.keys(remix.result.citation).sort().join(","), "lineageId,parentId");

    // citations (plural, new) is the same single entry
    assert.equal(remix.result.citations.length, 1);
    assert.equal(remix.result.citations[0].lineageId, remix.result.citation.lineageId);

    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").all(remix.result.dtuId);
    assert.equal(rows.length, 1, "exactly 1 royalty_lineage row for the legacy single-parent path");
    assert.equal(rows[0].parent_id, parent);
    assert.equal(rows[0].generation, 1);

    const childDtu = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(remix.result.dtuId);
    const childBody = JSON.parse(childDtu.body_json);
    assert.deepEqual(childBody.lineage.parents, [parent], "single-parent lineage.parents unchanged shape");
  });

  it("an invalid parent id inside remixOfDtuIds is rejected honestly, with no insert", async () => {
    const parent = await publishOriginal(aCtx, { name: "Valid Parent For Invalid-Sibling Test" });
    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const wbCountBefore = db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n;

    const r = await lensRun("game-design", "building-publish", {
      params: validParams({
        name: "Bad Sibling Remix",
        worldId: `world_${randomUUID().slice(0, 8)}`,
        remixOfDtuIds: [parent, "dtu_does_not_exist_multi_9999"],
      }),
    }, fuserCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "remix_parent_not_found");
    assert.equal(r.result.parentId, "dtu_does_not_exist_multi_9999");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtuCountBefore);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n, wbCountBefore);
  });

  it("a self-owned parent among several is skipped for citation, but still listed in lineage.parents", async () => {
    const own = await publishOriginal(fuserCtx, { name: "Fuser's Own Original" });
    const other = await publishOriginal(cCtx, { name: "C's Original" });

    const remix = await lensRun("game-design", "building-publish", {
      params: validParams({
        name: "Mixed Self+Other Remix",
        worldId: `world_${randomUUID().slice(0, 8)}`,
        remixOfDtuIds: [own, other],
      }),
    }, fuserCtx);
    assert.equal(remix.result.ok, true, JSON.stringify(remix.result));

    // Only the non-self parent gets a real citation.
    assert.equal(remix.result.citations.length, 1);
    assert.equal(remix.result.citations[0].parentId, other);

    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").all(remix.result.dtuId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].parent_id, other);

    // Structural lineage still records both — the remix genuinely draws
    // from both, whether or not royalty is owed on each.
    const childDtu = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(remix.result.dtuId);
    const childBody = JSON.parse(childDtu.body_json);
    assert.deepEqual(childBody.lineage.parents, [own, other]);
  });

  it("duplicate ids across remixOfDtuId + remixOfDtuIds are deduped, not double-cited", async () => {
    const parent = await publishOriginal(aCtx, { name: "Dedup Target" });
    const remix = await lensRun("game-design", "building-publish", {
      params: validParams({
        name: "Dedup Remix",
        worldId: `world_${randomUUID().slice(0, 8)}`,
        remixOfDtuId: parent,
        remixOfDtuIds: [parent],
      }),
    }, fuserCtx);
    assert.equal(remix.result.ok, true, JSON.stringify(remix.result));
    assert.equal(remix.result.citations.length, 1, "deduped to a single citation attempt");
    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").all(remix.result.dtuId);
    assert.equal(rows.length, 1, "deduped to a single lineage row");
  });
});

describe("game-design.asset-fuse", () => {
  it("fuses 3 parents into a new DTU whose lineage.parents has all 3 + writes 3 royalty_lineage rows", async () => {
    const p1 = await publishOriginal(aCtx, { name: "Fuse Source 1" });
    const p2 = await publishOriginal(bCtx, { name: "Fuse Source 2" });
    const p3 = await publishOriginal(cCtx, { name: "Fuse Source 3" });

    const r = await lensRun("game-design", "asset-fuse", {
      params: { name: "Triple Fusion", parentDtuIds: [p1, p2, p3] },
    }, fuserCtx);
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.ok(r.result.dtuId);
    assert.equal(r.result.spawned, false, "no world/position/archetype supplied — honest no-spawn");
    assert.equal(r.result.buildingId, null);
    assert.deepEqual(r.result.parents.sort(), [p1, p2, p3].sort());

    const dtuRow = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.result.dtuId);
    assert.ok(dtuRow, "fused dtu row exists");
    assert.equal(dtuRow.owner_user_id, fuserCtx.actor.userId, "creator-attributed");
    const body = JSON.parse(dtuRow.body_json);
    assert.equal(body.meta.type, "blueprint");
    assert.equal(body.meta.kind, "fusion");
    assert.deepEqual(body.lineage.parents.sort(), [p1, p2, p3].sort());

    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").all(r.result.dtuId);
    assert.equal(rows.length, 3, "exactly 3 royalty_lineage rows");
    const parentIdsInDb = rows.map((row) => row.parent_id).sort();
    assert.deepEqual(parentIdsInDb, [p1, p2, p3].sort());
    for (const row of rows) {
      assert.equal(row.generation, 1);
      assert.equal(row.creator_id, fuserCtx.actor.userId);
    }
  });

  it("rejects fewer than 2 parents honestly, with no insert", async () => {
    const zero = await lensRun("game-design", "asset-fuse", { params: { name: "No Parents" } }, fuserCtx);
    assert.equal(zero.result.ok, false);
    assert.equal(zero.result.error, "insufficient_parents");

    const single = await publishOriginal(aCtx, { name: "Only One" });
    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const one = await lensRun("game-design", "asset-fuse", {
      params: { name: "One Parent", parentDtuIds: [single] },
    }, fuserCtx);
    assert.equal(one.result.ok, false);
    assert.equal(one.result.error, "insufficient_parents");

    // A duplicated id collapses to 1 distinct parent — also rejected.
    const dup = await lensRun("game-design", "asset-fuse", {
      params: { name: "Duplicated Parent", parentDtuIds: [single, single] },
    }, fuserCtx);
    assert.equal(dup.result.ok, false);
    assert.equal(dup.result.error, "insufficient_parents");

    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtuCountBefore);
  });

  it("rejects a nonexistent parent id honestly, with no insert", async () => {
    const p1 = await publishOriginal(aCtx, { name: "Real Fuse Parent" });
    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;

    const r = await lensRun("game-design", "asset-fuse", {
      params: { name: "Bad Fuse", parentDtuIds: [p1, "dtu_totally_missing_fuse_777"] },
    }, fuserCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "parent_not_found");
    assert.equal(r.result.parentId, "dtu_totally_missing_fuse_777");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtuCountBefore);
  });

  it("a self-owned parent is skipped for citation but the fusion still succeeds and lists it structurally", async () => {
    const ownParent = await publishOriginal(fuserCtx, { name: "Fuser's Own Fuse Source" });
    const otherParent = await publishOriginal(aCtx, { name: "Other's Fuse Source" });

    const r = await lensRun("game-design", "asset-fuse", {
      params: { name: "Self+Other Fusion", parentDtuIds: [ownParent, otherParent] },
    }, fuserCtx);
    assert.equal(r.result.ok, true, JSON.stringify(r.result));

    // Structural lineage lists both.
    assert.deepEqual(r.result.parents.sort(), [ownParent, otherParent].sort());
    const dtuRow = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(r.result.dtuId);
    const body = JSON.parse(dtuRow.body_json);
    assert.deepEqual(body.lineage.parents.sort(), [ownParent, otherParent].sort());

    // Only the non-self parent gets a real royalty citation.
    assert.equal(r.result.citations.length, 1);
    assert.equal(r.result.citations[0].parentId, otherParent);
    const rows = db.prepare("SELECT * FROM royalty_lineage WHERE child_id = ?").all(r.result.dtuId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].parent_id, otherParent);
    assert.equal(rows[0].parent_creator, aCtx.actor.userId);
  });

  it("rejects fusion from an unauthenticated/anon caller", async () => {
    const p1 = await publishOriginal(aCtx, { name: "Anon Fuse P1" });
    const p2 = await publishOriginal(bCtx, { name: "Anon Fuse P2" });
    const anonCtx = { ...fuserCtx, actor: { ...fuserCtx.actor, userId: "anon" } };
    const r = await lensRun("game-design", "asset-fuse", {
      params: { name: "Anon Fusion", parentDtuIds: [p1, p2] },
    }, anonCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "auth_required");
  });

  it("spawns a real world_buildings row when archetype/dimensions/world/position are all supplied", async () => {
    const p1 = await publishOriginal(aCtx, { name: "Spawn Fuse P1" });
    const p2 = await publishOriginal(bCtx, { name: "Spawn Fuse P2" });
    const worldId = `world_${randomUUID().slice(0, 8)}`;

    const r = await lensRun("game-design", "asset-fuse", {
      params: {
        name: "Spawned Fusion Tower",
        parentDtuIds: [p1, p2],
        archetype: "tower",
        dimensions: { width: 8, height: 20, depth: 8 },
        worldId,
        position: { x: 500, y: 0, z: 600 },
      },
    }, fuserCtx);
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.equal(r.result.spawned, true);
    assert.ok(r.result.buildingId);

    const wbRow = db.prepare("SELECT * FROM world_buildings WHERE id = ?").get(r.result.buildingId);
    assert.ok(wbRow, "world_buildings row exists for the fused asset");
    assert.equal(wbRow.blueprint_dtu_id, r.result.dtuId);
    assert.equal(wbRow.world_id, worldId);
    assert.equal(wbRow.archetype, "tower");
    assert.equal(wbRow.width, 8);
    assert.equal(wbRow.spawned_by_user_id, fuserCtx.actor.userId);
  });
});

describe("Asset Studio Increment 5 — economy invariants untouched", () => {
  it("touches no fee/royalty/withdrawal constant — royalty-cascade.js source still exports the same constitutional values", async () => {
    const mod = await import("../economy/royalty-cascade.js");
    assert.equal(typeof mod.registerCitation, "function");
    assert.equal(mod.calculateGenerationalRate(0), 0.21, "DEFAULT_INITIAL_RATE unchanged");
    assert.equal(mod.calculateGenerationalRate(1), 0.105, "generation-1 halving unchanged");
    assert.equal(mod.calculateGenerationalRate(20), 0.0005, "ROYALTY_FLOOR unchanged");
  });
});
