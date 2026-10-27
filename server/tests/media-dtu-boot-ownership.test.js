// Boot churn: hydrateMediaIndex ran before the DTU store attached and re-added
// every media row (even ones the cold-age archive had already moved out of
// dtu_store). They carried only `author`, so the ownership pass stamped user
// uploads ownerId "system" / visibility "internal" each boot, and the archive
// sweep archived the same rows again (35 per restart).
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { createMediaDTU, hydrateMediaIndex, ensureMediaOwner } from "../lib/media-dtu.js";
import { up as migrateMediaIndex } from "../migrations/472_media_index.js";
import { applyOwnerlessNormalization } from "../lib/dtu-ownership.js";
import { privateDtuHiddenFrom } from "../lib/dtu-read-access.js";

const upload = (STATE, authorId, privacy, title) => createMediaDTU(STATE, {
  authorId, title, mediaType: "image", mimeType: "image/png", privacy, fileSize: 10,
});

test("a new upload is owned by its author and the ownership pass leaves it alone", () => {
  const db = new Database(":memory:"); migrateMediaIndex(db);
  const STATE = { db, dtus: new Map() };
  for (const privacy of ["private", "public"]) {
    const { mediaDTU } = upload(STATE, "owner-1", privacy, "photo " + privacy);
    assert.equal(mediaDTU.ownerId, "owner-1");
    assert.equal(mediaDTU.visibility, "private", "never opened through the DTU index");
    const r = applyOwnerlessNormalization({ ...mediaDTU });
    assert.equal(r.changed, false);
    assert.equal(r.disposition, "unchanged");
  }
});

test("private media stays hidden from other users and anonymous viewers", () => {
  const db = new Database(":memory:"); migrateMediaIndex(db);
  const { mediaDTU } = upload({ db, dtus: new Map() }, "owner-1", "private", "secret");
  assert.equal(privateDtuHiddenFrom(mediaDTU, "someone-else"), true);
  assert.equal(privateDtuHiddenFrom(mediaDTU, null), true);
  assert.equal(privateDtuHiddenFrom(mediaDTU, "owner-1"), false);
});

test("ensureMediaOwner repairs the old system/internal stamp, never opens visibility, keeps other owners", () => {
  assert.deepEqual(
    (({ ownerId, visibility }) => ({ ownerId, visibility }))(ensureMediaOwner({ id: "m1", author: "u1", ownerId: "system", visibility: "internal" })),
    { ownerId: "u1", visibility: "private" });
  assert.equal(ensureMediaOwner({ id: "m2", author: "u1" }).visibility, "private");
  assert.equal(ensureMediaOwner({ id: "m3", author: "u1", visibility: "public" }).visibility, "public", "explicit public is the owner's choice, untouched");
  const other = ensureMediaOwner({ id: "m4", author: "u1", ownerId: "u2", visibility: "private" });
  assert.equal(other.ownerId, "u2");
  const noAuthor = ensureMediaOwner({ id: "m5" });
  assert.equal(noAuthor.ownerId, undefined);
});

test("hydrateMediaIndex keeps archived media out of the DTU store but in the media map", () => {
  const db = new Database(":memory:"); migrateMediaIndex(db);
  db.exec("CREATE TABLE dtu_store_archive (id TEXT PRIMARY KEY)");
  const writer = { db, dtus: new Map() };
  const a = upload(writer, "owner-1", "private", "archived one").mediaDTU;
  const b = upload(writer, "owner-2", "public", "live one").mediaDTU;
  db.prepare("INSERT INTO dtu_store_archive (id) VALUES (?)").run(a.id);

  const STATE = { db, dtus: new Map() };
  const r = hydrateMediaIndex(STATE);
  assert.equal(r.ok, true);
  assert.equal(r.loaded, 2);
  assert.equal(r.skippedArchived, 1);
  assert.equal(STATE.dtus.has(a.id), false, "archived media is not re-added to the DTU store");
  assert.equal(STATE.dtus.get(b.id).ownerId, "owner-2");
  assert.equal(STATE._media.mediaDTUs.get(a.id).ownerId, "owner-1", "still served from the media map");
});

test("hydrateMediaIndex works when the archive table does not exist", () => {
  const db = new Database(":memory:"); migrateMediaIndex(db);
  const writer = { db, dtus: new Map() };
  const a = upload(writer, "owner-1", "private", "x").mediaDTU;
  const STATE = { db, dtus: new Map() };
  const r = hydrateMediaIndex(STATE);
  assert.equal(r.skippedArchived, 0);
  assert.equal(STATE.dtus.get(a.id).ownerId, "owner-1");
});
