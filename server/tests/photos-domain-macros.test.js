// Behavioral macro tests for server/domains/photos.js — the photo-gallery
// lens macros (list / get / world / share).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against the REAL photo lib (server/lib/photo-gallery.js) + a hermetic
// in-memory better-sqlite3 DB with ONLY migration 243 (+ a minimal dtus table)
// applied. NO full-server boot, NO network, NO LLM. These are NOT shape-only
// assertions: every test asserts ACTUAL round-trips (save via the lib → list/get
// reflects it; share mints a public kind='photo' DTU that then appears in the
// world feed), per-user isolation, the not-owner / private-photo gates, and the
// fail-CLOSED numeric guard the macro-assassin's V2 vector probes.

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

import registerPhotosMacros from "../domains/photos.js";
import { savePhoto } from "../lib/photo-gallery.js";
import { up as upPhotos } from "../migrations/243_photo_gallery.js";

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "concord-photos-dom-"));
process.env.CONCORD_PHOTO_DIR = TMP_DIR;
after(() => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ } });

// 1×1 transparent PNG, base64.
const TINY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=";

const ACTIONS = new Map();
function register(domain, name, fn) {
  assert.equal(domain, "photos", `unexpected domain: ${domain}`);
  ACTIONS.set(name, fn);
}
before(() => { registerPhotosMacros(register); });

let db;
function freshDb() {
  const d = new Database(":memory:");
  d.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY, title TEXT, type TEXT,
      creator_id TEXT, created_at INTEGER, body_json TEXT
    );
  `);
  upPhotos(d);
  return d;
}
beforeEach(() => { db = freshDb(); });

function ctxFor(userId) { return { db, actor: { userId } }; }
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(name);
  if (!fn) throw new Error(`photos.${name} not registered`);
  return fn(ctx, input);
}

describe("photos — registration", () => {
  it("registers every macro the lens calls", () => {
    for (const m of ["list", "get", "world", "share"]) {
      assert.equal(typeof ACTIONS.get(m), "function", `missing photos.${m}`);
    }
  });
});

describe("photos — list (the caller's gallery)", () => {
  it("returns the caller's own saved photos, newest first", async () => {
    await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, caption: "first" });
    await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, caption: "second" });

    const r = call("list", ctxFor("u1"), {});
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.equal(r.photos.length, 2);
    // taken_at DESC — both share a second so just assert membership
    const captions = r.photos.map((p) => p.caption).sort();
    assert.deepEqual(captions, ["first", "second"]);
  });

  it("never leaks one user's photos to another", async () => {
    await savePhoto(db, "u1", { dataUrl: TINY_PNG, caption: "u1-only" });
    assert.equal(call("list", ctxFor("u1"), {}).count, 1);
    assert.equal(call("list", ctxFor("u2"), {}).count, 0);
  });

  it("rejects anonymous callers with no_user", () => {
    assert.equal(call("list", { db }, {}).reason, "no_user");
  });

  it("rejects a poisoned limit (fail-CLOSED), still honours a valid one", async () => {
    for (let i = 0; i < 5; i++) await savePhoto(db, "u1", { dataUrl: TINY_PNG, caption: `p${i}` });
    for (const bad of [NaN, Infinity, -1, 1e308, "abc"]) {
      const r = call("list", ctxFor("u1"), { limit: bad });
      assert.equal(r.ok, false, `limit=${bad} should fail-closed`);
      assert.equal(r.reason, "invalid_limit");
    }
    const ok = call("list", ctxFor("u1"), { limit: 2 });
    assert.equal(ok.ok, true);
    assert.equal(ok.photos.length, 2);
  });
});

describe("photos — get (single photo, privacy-gated)", () => {
  it("owner reads their own photo; missing/unknown id rejected", async () => {
    const saved = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, caption: "mine" });
    const r = call("get", ctxFor("u1"), { id: saved.id });
    assert.equal(r.ok, true);
    assert.equal(r.photo.id, saved.id);
    assert.equal(r.photo.caption, "mine");

    assert.equal(call("get", ctxFor("u1"), {}).reason, "missing_id");
    assert.equal(call("get", ctxFor("u1"), { id: "nope" }).reason, "not_found");
  });

  it("hides another user's PRIVATE photo (reports not_found), reveals once public", async () => {
    const saved = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, visibility: "private" });
    // u2 can't see u1's private photo
    assert.equal(call("get", ctxFor("u2"), { id: saved.id }).reason, "not_found");
    // u1 shares it → public
    assert.equal(call("share", ctxFor("u1"), { photoId: saved.id }).ok, true);
    const seen = call("get", ctxFor("u2"), { id: saved.id });
    assert.equal(seen.ok, true);
    assert.equal(seen.photo.visibility, "public");
  });
});

describe("photos — share (mints a public photo DTU)", () => {
  it("share flips visibility public + mints a kind='photo' DTU; appears in world feed", async () => {
    const saved = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG, visibility: "private" });
    // before: not in the public world feed
    assert.equal(call("world", ctxFor("u1"), { worldId: "tunya" }).count, 0);

    const s = call("share", ctxFor("u1"), { photoId: saved.id });
    assert.equal(s.ok, true);
    assert.ok(s.dtuId.startsWith("dtu_photo_"), "share returns a minted dtuId");

    // the DTU is real, kind='photo', creator = owner
    const dtu = db.prepare(`SELECT type, creator_id FROM dtus WHERE id = ?`).get(s.dtuId);
    assert.equal(dtu.type, "photo");
    assert.equal(dtu.creator_id, "u1");

    // now visible in the public world feed, and the gallery row carries the dtu_id
    const feed = call("world", ctxFor("u2"), { worldId: "tunya" });
    assert.equal(feed.count, 1);
    assert.equal(feed.photos[0].id, saved.id);
    const mine = call("list", ctxFor("u1"), {});
    assert.equal(mine.photos[0].dtu_id, s.dtuId);
  });

  it("share is owner-only + rejects missing/unknown photo", async () => {
    const saved = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG });
    assert.equal(call("share", ctxFor("u1"), {}).reason, "missing_photoId");
    assert.equal(call("share", ctxFor("u1"), { photoId: "nope" }).reason, "no_photo");
    assert.equal(call("share", ctxFor("u2"), { photoId: saved.id }).reason, "not_owner");
    // still private after a rejected share
    assert.equal(call("world", ctxFor("u1"), { worldId: "tunya" }).count, 0);
  });
});

describe("photos — world feed", () => {
  it("scopes the public feed to the named world; rejects missing worldId", async () => {
    const a = await savePhoto(db, "u1", { worldId: "tunya", dataUrl: TINY_PNG });
    call("share", ctxFor("u1"), { photoId: a.id });
    const b = await savePhoto(db, "u1", { worldId: "cyber", dataUrl: TINY_PNG });
    call("share", ctxFor("u1"), { photoId: b.id });

    assert.equal(call("world", ctxFor("u1"), { worldId: "tunya" }).count, 1);
    assert.equal(call("world", ctxFor("u1"), { worldId: "cyber" }).count, 1);
    assert.equal(call("world", ctxFor("u1"), {}).reason, "missing_worldId");
  });
});
