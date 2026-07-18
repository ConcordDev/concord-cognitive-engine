// server/tests/asset-studio-concept-art-board.test.js
//
// Real behavioral tests for Asset Engine Increment 3 — the CONCEPT BOARD
// read path (server/domains/art.js `concept-art-list`). Boots the real
// server via the shared depth harness (isolated DB_PATH) and asserts the
// list macro reads the REAL persisted `dtus` rows minted by
// `artwork-publish-as-concept` — not the ephemeral STATE.artLens.artworks
// Map. No mocks: this exercises the actual SELECT ... FROM dtus path.
//
// Grounding: the mint side (artwork-publish-as-concept) was already built —
// it writes a permanent, citable `dtus` row. But there was no way to SEE
// your saved concept art after a reload; the "board" (the increment's
// namesake) was missing. This test proves mint → list round-trips through
// real SQL, is scoped to the creator, filters to concept-art rows only, and
// returns an honest empty board (never a fabricated one) when there's
// nothing there.

import { randomUUID } from "node:crypto";
process.env.DB_PATH = process.env.DB_PATH || `/tmp/asset-studio-concept-board-${process.pid}-${Date.now()}.db`;

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { load, depthCtx, lensRun } from "./depth/_harness.js";

let db;
let artistCtx, otherCtx, freshCtx;

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
  const artistId = `acb_artist_${randomUUID().slice(0, 8)}`;
  const otherId = `acb_other_${randomUUID().slice(0, 8)}`;
  const freshId = `acb_fresh_${randomUUID().slice(0, 8)}`;
  makeUser(artistId);
  makeUser(otherId);
  makeUser(freshId);
  artistCtx = await depthCtx(artistId);
  otherCtx = await depthCtx(otherId);
  freshCtx = await depthCtx(freshId);
});

async function publishConcept(ctx, title) {
  const created = await lensRun("art", "artwork-create", { params: { title, width: 320, height: 240 } }, ctx);
  const artworkId = created.result.artwork.id;
  const layerId = created.result.artwork.layers[0].id;
  await lensRun("art", "stroke-commit", {
    params: { artworkId, layerId, stroke: { tool: "ink", color: "#abcdef", points: [[3, 3], [4, 4]] } },
  }, ctx);
  const pub = await lensRun("art", "artwork-publish-as-concept", { params: { id: artworkId } }, ctx);
  assert.equal(pub.result.ok, true, JSON.stringify(pub.result));
  return { artworkId, dtuId: pub.result.dtuId, title };
}

describe("art.concept-art-list — the concept board reads real persisted DTUs", () => {
  it("lists the creator's minted concept-art dtus, and every listed id round-trips to a real dtus row", async () => {
    const a = await publishConcept(artistCtx, "Board Piece Alpha");
    const b = await publishConcept(artistCtx, "Board Piece Beta");

    const listed = await lensRun("art", "concept-art-list", { params: {} }, artistCtx);
    assert.equal(listed.result.count, 2, JSON.stringify(listed.result));
    assert.equal(listed.result.conceptArt.length, 2);

    const byId = new Map(listed.result.conceptArt.map((c) => [c.dtuId, c]));
    for (const src of [a, b]) {
      const entry = byId.get(src.dtuId);
      assert.ok(entry, `board entry for ${src.dtuId} present`);
      assert.equal(entry.title, src.title);
      assert.equal(entry.visibility, "public");
      assert.equal(entry.artworkId, src.artworkId);
      assert.equal(entry.layerCount, 1);
      assert.equal(entry.strokeCount, 1);
      assert.equal(entry.width, 320);
      assert.equal(entry.height, 240);
      // Honest empty state — no fabricated thumbnail when none was saved.
      assert.equal(entry.thumbnail, null);

      // Round-trip: the listed id is a real row with the concept_art stamp.
      const row = db.prepare("SELECT owner_user_id, body_json FROM dtus WHERE id = ?").get(src.dtuId);
      assert.ok(row, "real dtus row exists");
      assert.equal(row.owner_user_id, artistCtx.actor.userId);
      assert.equal(JSON.parse(row.body_json).meta.type, "concept_art");
    }

    // Newest-first ordering by created_at (>= tolerates same-timestamp ties).
    assert.ok(listed.result.conceptArt[0].createdAt >= listed.result.conceptArt[1].createdAt);
  });

  it("is scoped to the creator — one user never sees another's concept art", async () => {
    const mine = await publishConcept(otherCtx, "Other's Private Board Piece");
    const otherList = await lensRun("art", "concept-art-list", { params: {} }, otherCtx);
    assert.ok(otherList.result.conceptArt.some((c) => c.dtuId === mine.dtuId), "owner sees their own");

    const artistList = await lensRun("art", "concept-art-list", { params: {} }, artistCtx);
    assert.ok(!artistList.result.conceptArt.some((c) => c.dtuId === mine.dtuId), "artist does not see other user's row");
  });

  it("returns an honest empty board for a creator who has published nothing", async () => {
    const listed = await lensRun("art", "concept-art-list", { params: {} }, freshCtx);
    assert.equal(listed.result.count, 0);
    assert.deepEqual(listed.result.conceptArt, []);
  });

  it("returns an honest empty board for an anon/unauthenticated caller", async () => {
    const anonCtx = { ...freshCtx, actor: { ...freshCtx.actor, userId: "anon" } };
    const listed = await lensRun("art", "concept-art-list", { params: {} }, anonCtx);
    assert.equal(listed.result.count, 0);
    assert.deepEqual(listed.result.conceptArt, []);
  });

  it("filters to concept-art rows only — an unrelated dtu owned by the creator is excluded", async () => {
    const before = await lensRun("art", "concept-art-list", { params: {} }, freshCtx);
    assert.equal(before.result.count, 0);

    // Insert a non-concept-art dtu owned by the fresh user directly.
    const now = new Date().toISOString();
    const plainId = `dtu_plain_${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, visibility, tier, created_at, updated_at)
      VALUES (?, ?, 'A Note', ?, '[]', 'private', 'regular', ?, ?)
    `).run(plainId, freshCtx.actor.userId, JSON.stringify({ meta: { type: "note" } }), now, now);

    const after = await lensRun("art", "concept-art-list", { params: {} }, freshCtx);
    assert.equal(after.result.count, 0, "the plain note is not surfaced on the concept board");
    assert.ok(!after.result.conceptArt.some((c) => c.dtuId === plainId));
  });
});
