// server/tests/asset-studio-concept-art-publish.test.js
//
// Real behavioral tests for Asset Engine Increment 3 (server/domains/art.js
// `artwork-publish-as-concept` + server/domains/gamedesign.js
// `building-publish`'s new optional `conceptArtDtuId` param). Boots the real
// server via the shared depth harness (isolated DB_PATH) and asserts
// directly against the real SQLite rows: `dtus` and `royalty_lineage`. No
// mocks — this exercises the actual INSERT INTO dtus path and the actual
// royalty-cascade `registerCitation()` call.
//
// Grounding: before this unit, an artwork published from the `art` lens
// canvas lived ONLY in the in-memory `STATE.artLens.artworks` Map — it
// evaporated on restart and was never citable by anything else. This test
// proves the fix: publishing now mints a real, permanent `dtus` row, and a
// building published from it registers a real royalty-lineage edge.

import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/asset-studio-concept-art-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load, depthCtx, lensRun } from "./depth/_harness.js";

let db;
let artistCtx, builderCtx;

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
  const artistId = `asc_artist_${randomUUID().slice(0, 8)}`;
  const builderId = `asc_builder_${randomUUID().slice(0, 8)}`;
  makeUser(artistId);
  makeUser(builderId);
  artistCtx = await depthCtx(artistId);
  builderCtx = await depthCtx(builderId);
});

async function createArtworkWithStroke(ctx, title = "Sketch") {
  const created = await lensRun("art", "artwork-create", { params: { title, width: 640, height: 480 } }, ctx);
  assert.ok(created.result.artwork, JSON.stringify(created.result));
  const artworkId = created.result.artwork.id;
  const layerId = created.result.artwork.layers[0].id;
  await lensRun("art", "stroke-commit", {
    params: { artworkId, layerId, stroke: { tool: "ink", color: "#334455", points: [[1, 1], [2, 2]] } },
  }, ctx);
  return artworkId;
}

function validBuildingParams(overrides = {}) {
  return {
    name: "Concept Hall",
    archetype: "archive",
    dimensions: { width: 10, height: 8, depth: 9 },
    worldId: `world_${randomUUID().slice(0, 8)}`,
    position: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

describe("art.artwork-publish-as-concept — real DB round-trip", () => {
  it("mints a real, owner-attributed dtus row with meta.type='concept_art' and the actual layer/stroke data", async () => {
    const artworkId = await createArtworkWithStroke(artistCtx, "My Sketch");
    const r = await lensRun("art", "artwork-publish-as-concept", { params: { id: artworkId } }, artistCtx);
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.ok(r.result.dtuId);
    assert.equal(r.result.artworkId, artworkId);
    assert.equal(r.result.title, "My Sketch");
    assert.equal(r.result.visibility, "public");
    assert.equal(r.result.layerCount, 1);
    assert.equal(r.result.strokeCount, 1);

    const dtuRow = db.prepare("SELECT * FROM dtus WHERE id = ?").get(r.result.dtuId);
    assert.ok(dtuRow, "dtu row exists — this is the whole point of Increment 3");
    assert.equal(dtuRow.owner_user_id, artistCtx.actor.userId);
    assert.equal(dtuRow.title, "My Sketch");
    assert.equal(dtuRow.visibility, "public");

    const body = JSON.parse(dtuRow.body_json);
    assert.equal(body.meta.type, "concept_art");
    assert.equal(body.meta.kind, "concept_art");
    assert.equal(body.meta.artworkId, artworkId);
    assert.equal(body.meta.layerCount, 1);
    assert.equal(body.meta.strokeCount, 1);
    // The real replayable stroke data, not a re-derived summary.
    assert.equal(body.artwork.layers.length, 1);
    assert.equal(body.artwork.layers[0].strokes.length, 1);
    assert.deepEqual(body.artwork.layers[0].strokes[0].points, [[1, 1], [2, 2]]);
    assert.equal(body.artwork.layers[0].strokes[0].color, "#334455");
  });

  it("accepts a title override and a non-default visibility", async () => {
    const artworkId = await createArtworkWithStroke(artistCtx, "Untitled Original");
    const r = await lensRun("art", "artwork-publish-as-concept", {
      params: { id: artworkId, title: "Renamed For Publish", visibility: "marketplace" },
    }, artistCtx);
    assert.equal(r.result.ok, true, JSON.stringify(r.result));
    assert.equal(r.result.title, "Renamed For Publish");
    assert.equal(r.result.visibility, "marketplace");
    const dtuRow = db.prepare("SELECT title, visibility FROM dtus WHERE id = ?").get(r.result.dtuId);
    assert.equal(dtuRow.title, "Renamed For Publish");
    assert.equal(dtuRow.visibility, "marketplace");
  });

  it("an unknown artwork id is rejected honestly — no dtu row minted", async () => {
    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const r = await lensRun("art", "artwork-publish-as-concept", { params: { id: "art_does_not_exist_12345" } }, artistCtx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /artwork not found/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtuCountBefore, "no orphan dtu row on rejection");
  });

  it("rejects a missing id honestly", async () => {
    const r = await lensRun("art", "artwork-publish-as-concept", { params: {} }, artistCtx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /id required/);
  });

  it("rejects an unauthenticated/anon caller", async () => {
    const artworkId = await createArtworkWithStroke(artistCtx, "AuthGate");
    const anonCtx = { ...artistCtx, actor: { ...artistCtx.actor, userId: "anon" } };
    const r = await lensRun("art", "artwork-publish-as-concept", { params: { id: artworkId } }, anonCtx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /authentication required/);
  });

  it("one user cannot publish another user's artwork (per-owner artwork Map scoping)", async () => {
    const artworkId = await createArtworkWithStroke(artistCtx, "Owned By Artist");
    // builderCtx has never created this artwork — its own artworks list won't contain it.
    const r = await lensRun("art", "artwork-publish-as-concept", { params: { id: artworkId } }, builderCtx);
    assert.equal(r.result.ok, false);
    assert.match(r.result.error, /artwork not found/);
  });
});

describe("game-design.building-publish — conceptArtDtuId lineage edge (Increment 3)", () => {
  it("citing a real public concept-art dtu writes a REAL royalty_lineage row", async () => {
    const artworkId = await createArtworkWithStroke(artistCtx, "Tower Concept");
    const concept = await lensRun("art", "artwork-publish-as-concept", { params: { id: artworkId } }, artistCtx);
    assert.equal(concept.result.ok, true);
    const conceptArtDtuId = concept.result.dtuId;

    const built = await lensRun("game-design", "building-publish", {
      params: validBuildingParams({ conceptArtDtuId }),
    }, builderCtx);
    assert.equal(built.result.ok, true, JSON.stringify(built.result));
    assert.ok(built.result.conceptArtCitation && built.result.conceptArtCitation.lineageId, "a real citation was registered for the concept art parent");

    const lineageRow = db.prepare(
      "SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?",
    ).get(built.result.dtuId, conceptArtDtuId);
    assert.ok(lineageRow, "royalty_lineage row exists");
    assert.equal(lineageRow.id, built.result.conceptArtCitation.lineageId);
    assert.equal(lineageRow.creator_id, builderCtx.actor.userId);
    assert.equal(lineageRow.parent_creator, artistCtx.actor.userId);

    // The building DTU's own body records the concept-art lineage too.
    const buildingDtu = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(built.result.dtuId);
    const buildingBody = JSON.parse(buildingDtu.body_json);
    assert.equal(buildingBody.lineage.conceptArtDtuId, conceptArtDtuId);
    assert.ok(buildingBody.lineage.parents.includes(conceptArtDtuId));
  });

  it("an unknown conceptArtDtuId is rejected honestly — no building/dtu row inserted", async () => {
    const dtuCountBefore = db.prepare("SELECT COUNT(*) n FROM dtus").get().n;
    const wbCountBefore = db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n;
    const r = await lensRun("game-design", "building-publish", {
      params: validBuildingParams({ conceptArtDtuId: "dtu_does_not_exist_98765" }),
    }, builderCtx);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "concept_art_dtu_not_found");
    assert.equal(r.result.parentId, "dtu_does_not_exist_98765");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM dtus").get().n, dtuCountBefore, "no orphan dtu row");
    assert.equal(db.prepare("SELECT COUNT(*) n FROM world_buildings").get().n, wbCountBefore, "no orphan building row");
  });

  it("citing your OWN concept art does not register a self-citation, but still stamps lineage", async () => {
    const artworkId = await createArtworkWithStroke(builderCtx, "Self Concept");
    const concept = await lensRun("art", "artwork-publish-as-concept", { params: { id: artworkId } }, builderCtx);
    assert.equal(concept.result.ok, true);
    const conceptArtDtuId = concept.result.dtuId;

    const built = await lensRun("game-design", "building-publish", {
      params: validBuildingParams({ conceptArtDtuId }),
    }, builderCtx);
    assert.equal(built.result.ok, true, JSON.stringify(built.result));
    assert.equal(built.result.conceptArtCitation, null, "no citation attempted for a self-owned concept art parent");

    const lineageRow = db.prepare(
      "SELECT * FROM royalty_lineage WHERE child_id = ? AND parent_id = ?",
    ).get(built.result.dtuId, conceptArtDtuId);
    assert.equal(lineageRow, undefined, "no royalty_lineage row for a self-citation");

    // The lineage.parents/conceptArtDtuId stamping still happens even though
    // no royalty edge was registered — it's a factual "built from" record.
    const buildingDtu = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(built.result.dtuId);
    const buildingBody = JSON.parse(buildingDtu.body_json);
    assert.equal(buildingBody.lineage.conceptArtDtuId, conceptArtDtuId);
  });

  it("conceptArtDtuId composes with an independent remixOfDtuId — both get cited", async () => {
    const artworkId = await createArtworkWithStroke(artistCtx, "Composable Concept");
    const concept = await lensRun("art", "artwork-publish-as-concept", { params: { id: artworkId } }, artistCtx);
    const conceptArtDtuId = concept.result.dtuId;

    const remixSource = await lensRun("game-design", "building-publish", {
      params: validBuildingParams({ name: "Remix Source", worldId: `world_${randomUUID().slice(0, 8)}` }),
    }, artistCtx);
    assert.equal(remixSource.result.ok, true);

    const built = await lensRun("game-design", "building-publish", {
      params: validBuildingParams({
        name: "Composed Building",
        worldId: `world_${randomUUID().slice(0, 8)}`,
        conceptArtDtuId,
        remixOfDtuId: remixSource.result.dtuId,
      }),
    }, builderCtx);
    assert.equal(built.result.ok, true, JSON.stringify(built.result));
    assert.equal(built.result.citations.length, 2, "both the remix parent and the concept art parent were cited");
    assert.ok(built.result.conceptArtCitation, "concept art citation present");
    assert.ok(built.result.citations.some((c) => c.parentId === remixSource.result.dtuId));
    assert.ok(built.result.citations.some((c) => c.parentId === conceptArtDtuId));

    const buildingDtu = db.prepare("SELECT body_json FROM dtus WHERE id = ?").get(built.result.dtuId);
    const buildingBody = JSON.parse(buildingDtu.body_json);
    assert.deepEqual(
      [...buildingBody.lineage.parents].sort(),
      [remixSource.result.dtuId, conceptArtDtuId].sort(),
    );
  });
});
