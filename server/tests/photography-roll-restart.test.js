// A roll name is stored in photography_rolls. Clearing the in-memory
// photographyLens (what a process restart does) still lists that name.
// Date, location, and client are not stored, so they come back null.

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerPhotographyActions from "../domains/photography.js";
import { up, down } from "../migrations/459_photography_rolls.js";
import { up as upMedia, down as downMedia } from "../migrations/500_photography_roll_frame_media.js";
import { createMediaDTU } from "../lib/media-dtu.js";

const ACTIONS = new Map();
function register(domain, name, fn) { ACTIONS.set(`${domain}.${name}`, fn); }
function call(name, ctx, params = {}) {
  const fn = ACTIONS.get(`photography.${name}`);
  assert.ok(fn, `photography.${name} not registered`);
  return fn(ctx, { id: null, data: {}, meta: {} }, params);
}

let db;
before(() => { registerPhotographyActions(register); });
beforeEach(() => {
  db = new Database(":memory:");
  up(db);
  upMedia(db);
  globalThis._concordSTATE = { db, photographyLens: {} };
  globalThis._concordSaveStateDebounced = () => {};
});

const ctx = { actor: { userId: "user_roll" }, userId: "user_roll", db };

describe("photography roll restart", () => {
  it("lists the roll after the in-memory lens is dropped", () => {
    const created = call("shoot-create", ctx, { name: "  Door roll  " });
    assert.equal(created.ok, true);
    const id = created.result.shoot.id;
    assert.equal(created.result.shoot.name, "Door roll");
    const row = db.prepare("SELECT name FROM photography_rolls WHERE id = ?").get(id);
    assert.equal(row.name, "Door roll");

    globalThis._concordSTATE = { db, photographyLens: {} };
    const list = call("shoot-list", ctx, {});
    assert.equal(list.ok, true);
    assert.equal(list.result.count, 1);
    assert.equal(list.result.shoots[0].id, id);
    assert.equal(list.result.shoots[0].name, "Door roll");
    assert.equal(list.result.shoots[0].date, null);
    assert.equal(list.result.shoots[0].location, null);
    assert.equal(list.result.shoots[0].client, null);
    assert.equal(list.result.shoots[0].photoCount, 0);
    assert.deepEqual(list.result.shoots[0].frames, []);
  });

  it("lists the frames after the in-memory lens is dropped", () => {
    const created = call("shoot-create", ctx, { name: "Door roll", frames: ["door-1.jpg", "  door-2.jpg  "] });
    assert.equal(created.ok, true);
    assert.equal(created.result.frames.length, 2);
    const id = created.result.shoot.id;
    globalThis._concordSTATE = { db, photographyLens: {} };
    const list = call("shoot-list", ctx, {});
    assert.equal(list.result.count, 1);
    assert.equal(list.result.shoots[0].id, id);
    assert.equal(list.result.shoots[0].name, "Door roll");
    assert.equal(list.result.shoots[0].photoCount, 2);
    assert.deepEqual(list.result.shoots[0].frames.map((frame) => frame.filename), ["door-1.jpg", "door-2.jpg"]);
    assert.equal(list.result.shoots[0].date, null);
  });

  it("a roll of blank filenames is rejected", () => {
    const created = call("shoot-create", ctx, { name: "Empty", frames: ["  "] });
    assert.equal(created.ok, false);
    assert.equal(created.error, "filename required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_rolls").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_roll_frames").get().n, 0);
  });

  it("a blank name is rejected and stores nothing", () => {
    const created = call("shoot-create", ctx, { name: "   " });
    assert.equal(created.ok, false);
    assert.equal(created.error, "shoot name required");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_rolls").get().n, 0);
  });

  it("down drops the table", () => {
    down(db);
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='photography_rolls'").get(),
      undefined,
    );
    assert.equal(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='photography_roll_frames'").get(),
      undefined,
    );
  });
});

// F2 re-pass: "import a real image file — the frame renders in the roll."
// A real media DTU (the same object /api/media/upload produces) is what
// shoot-create now resolves instead of a typed filename.
describe("photography roll — real media frames (F2/F3/F5)", () => {
  function realMedia(authorId = "user_roll", overrides = {}) {
    const r = createMediaDTU(globalThis._concordSTATE, {
      authorId, title: "door.jpg", mediaType: "image", mimeType: "image/jpeg",
      fileSize: 48213, originalFilename: "door.jpg", privacy: "private", ...overrides,
    });
    assert.equal(r.ok, true);
    return r.mediaDTU.id;
  }

  it("shoot-create with a mediaId stores real metadata, not a typed filename", () => {
    const mediaId = realMedia();
    const created = call("shoot-create", ctx, { name: "Door roll", frames: [{ mediaId }] });
    assert.equal(created.ok, true);
    assert.equal(created.result.frames[0].mediaId, mediaId);
    assert.equal(created.result.frames[0].filename, "door.jpg");
    assert.equal(created.result.frames[0].mimeType, "image/jpeg");
    assert.equal(created.result.frames[0].fileSize, 48213);
    const row = db.prepare("SELECT media_id, mime_type, file_size FROM photography_roll_frames WHERE roll_id = ?").get(created.result.shoot.id);
    assert.equal(row.media_id, mediaId);
    assert.equal(row.mime_type, "image/jpeg");
    assert.equal(row.file_size, 48213);
  });

  it("a mediaId authored by someone else is refused, not attached", () => {
    const mediaId = realMedia("someone_else");
    const created = call("shoot-create", ctx, { name: "Door roll", frames: [{ mediaId }] });
    assert.equal(created.ok, false);
    assert.equal(created.error, "media not found");
  });

  it("an unknown mediaId is refused", () => {
    const created = call("shoot-create", ctx, { name: "Door roll", frames: [{ mediaId: "media-does-not-exist" }] });
    assert.equal(created.ok, false);
    assert.equal(created.error, "media not found");
  });

  it("shoot-add-frame adds a real-media frame to a roll created before a restart", () => {
    const created = call("shoot-create", ctx, { name: "Door roll" });
    assert.equal(created.ok, true);
    const rollId = created.result.shoot.id;
    globalThis._concordSTATE = { db, photographyLens: {} }; // simulate restart: in-memory lens gone
    const mediaId = realMedia();
    const added = call("shoot-add-frame", ctx, { rollId, mediaId });
    assert.equal(added.ok, true);
    assert.equal(added.result.frame.mediaId, mediaId);
    const list = call("shoot-list", ctx, {});
    assert.equal(list.result.shoots[0].frames.length, 1);
    assert.equal(list.result.shoots[0].frames[0].mediaId, mediaId);
  });

  it("shoot-delete removes a roll created before a restart and its frames", () => {
    const created = call("shoot-create", ctx, { name: "Door roll", frames: ["door-1.jpg"] });
    const rollId = created.result.shoot.id;
    globalThis._concordSTATE = { db, photographyLens: {} }; // simulate restart
    const deleted = call("shoot-delete", ctx, { rollId });
    assert.equal(deleted.ok, true);
    assert.equal(deleted.result.deleted, rollId);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_rolls WHERE id = ?").get(rollId).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_roll_frames WHERE roll_id = ?").get(rollId).n, 0);
    const list = call("shoot-list", ctx, {});
    assert.equal(list.result.count, 0);
  });

  it("shoot-delete for another user's roll is refused", () => {
    const created = call("shoot-create", ctx, { name: "Door roll" });
    const rollId = created.result.shoot.id;
    const other = { actor: { userId: "user_other" }, userId: "user_other", db };
    const deleted = call("shoot-delete", other, { rollId });
    assert.equal(deleted.ok, false);
    assert.equal(deleted.error, "shoot not found");
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM photography_rolls WHERE id = ?").get(rollId).n, 1);
  });

  it("shoot-remove-frame removes one frame but leaves the roll and other frames", () => {
    const created = call("shoot-create", ctx, { name: "Door roll", frames: ["a.jpg", "b.jpg"] });
    const rollId = created.result.shoot.id;
    const frameId = created.result.frames[0].id;
    const removed = call("shoot-remove-frame", ctx, { rollId, frameId });
    assert.equal(removed.ok, true);
    const list = call("shoot-list", ctx, {});
    assert.equal(list.result.shoots[0].photoCount, 1);
    assert.deepEqual(list.result.shoots[0].frames.map((f) => f.filename), ["b.jpg"]);
  });

  it("down (media columns) rebuilds the table without the new columns", () => {
    downMedia(db);
    const cols = db.prepare("PRAGMA table_info(photography_roll_frames)").all().map((c) => c.name);
    assert.ok(!cols.includes("media_id"));
    assert.ok(cols.includes("filename"));
  });
});
