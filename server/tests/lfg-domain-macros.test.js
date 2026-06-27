// Macro surface for Looking-For-Group matchmaking (server/domains/lfg.js).
//
// Drives each registered macro the way runMacro would — a (ctx, input) call —
// against a REAL in-memory sqlite DB, and asserts the macro both delegates to
// server/lib/lfg.js AND mutates / reads the database for real (computed values
// + the load-bearing "auto-cancel prior open in same world" invariant), not
// just { ok:true }. Mirrors the register(domain, name, handler) collection
// pattern the server uses so we exercise the exact handlers without booting
// server.js.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import registerLfgMacros from "../domains/lfg.js";
import { up as upParties } from "../migrations/070_parties.js";
import { up as upPartyLfg } from "../migrations/219_party_lfg.js";

function collectMacros() {
  const map = new Map();
  registerLfgMacros((domain, name, handler) => {
    assert.equal(domain, "lfg");
    map.set(name, handler);
  });
  return map;
}

function freshDb() {
  const db = new Database(":memory:");
  // 219's ALTER targets `parties` from 070, so apply 070 first.
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY)`);
  upParties(db);
  upPartyLfg(db);
  return db;
}

function ctxFor(db, userId) {
  return { db, actor: { userId } };
}

describe("lfg domain macros", () => {
  let db, macros;
  beforeEach(() => { db = freshDb(); macros = collectMacros(); });

  it("registers the full post/list/cancel/join surface", () => {
    for (const name of ["post", "list", "cancel", "join"]) {
      assert.equal(typeof macros.get(name), "function", `missing macro: ${name}`);
    }
  });

  it("post → list surfaces the request with real computed fields", async () => {
    const posted = await macros.get("post")(ctxFor(db, "healer1"), {
      worldId: "tunya", role: "healer", partyType: "normal", note: "need 2 dps",
    });
    assert.equal(posted.ok, true);
    assert.equal(typeof posted.id, "string");

    const list = await macros.get("list")(ctxFor(db, "browser"), { worldId: "tunya" });
    assert.equal(list.ok, true);
    assert.equal(list.requests.length, 1);
    const row = list.requests[0];
    assert.equal(row.id, posted.id);
    assert.equal(row.userId, "healer1");
    assert.equal(row.worldId, "tunya");
    assert.equal(row.role, "healer");
    assert.equal(row.note, "need 2 dps");
    assert.equal(row.partyType, "normal");
    assert.equal(row.partyMaxSize, 8);
    assert.equal(row.currentSize, 1);
  });

  it("a second post by the same user in the same world auto-cancels the first (invariant)", async () => {
    const first = await macros.get("post")(ctxFor(db, "u1"), { worldId: "tunya", role: "tank" });
    const second = await macros.get("post")(ctxFor(db, "u1"), { worldId: "tunya", role: "dps" });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual(first.id, second.id);

    // Exactly one OPEN row for (u1, tunya), and it's the second post.
    const open = db.prepare(
      `SELECT id, role FROM lfg_requests WHERE requester_user_id = ? AND world_id = ? AND status = 'open'`
    ).all("u1", "tunya");
    assert.equal(open.length, 1);
    assert.equal(open[0].id, second.id);
    assert.equal(open[0].role, "dps");

    // The first row is now cancelled, not deleted (lineage preserved).
    const firstRow = db.prepare(`SELECT status FROM lfg_requests WHERE id = ?`).get(first.id);
    assert.equal(firstRow.status, "cancelled");

    // The list macro only shows the live one.
    const list = await macros.get("list")(ctxFor(db, "browser"), { worldId: "tunya" });
    assert.equal(list.requests.length, 1);
    assert.equal(list.requests[0].id, second.id);
  });

  it("a post in a DIFFERENT world does NOT cancel the first (scoped to world)", async () => {
    const tunya = await macros.get("post")(ctxFor(db, "u1"), { worldId: "tunya", role: "tank" });
    const cyber = await macros.get("post")(ctxFor(db, "u1"), { worldId: "cyber", role: "dps" });
    assert.equal(tunya.ok, true);
    assert.equal(cyber.ok, true);

    const open = db.prepare(
      `SELECT world_id FROM lfg_requests WHERE requester_user_id = ? AND status = 'open' ORDER BY world_id`
    ).all("u1");
    assert.equal(open.length, 2);
    assert.deepEqual(open.map((r) => r.world_id), ["cyber", "tunya"]);
  });

  it("list filters by role", async () => {
    await macros.get("post")(ctxFor(db, "a"), { worldId: "tunya", role: "healer" });
    await macros.get("post")(ctxFor(db, "b"), { worldId: "tunya", role: "dps" });

    const healers = await macros.get("list")(ctxFor(db, "x"), { worldId: "tunya", role: "healer" });
    assert.equal(healers.requests.length, 1);
    assert.equal(healers.requests[0].role, "healer");
  });

  it("cancel removes a request from the open list and is owner-gated", async () => {
    const posted = await macros.get("post")(ctxFor(db, "owner"), { worldId: "tunya", role: "tank" });

    // A non-owner can't cancel it.
    const denied = await macros.get("cancel")(ctxFor(db, "stranger"), { lfgId: posted.id });
    assert.equal(denied.ok, false);
    assert.equal(denied.error, "not_open_or_unauthorized");

    const cancelled = await macros.get("cancel")(ctxFor(db, "owner"), { lfgId: posted.id });
    assert.equal(cancelled.ok, true);

    const list = await macros.get("list")(ctxFor(db, "x"), { worldId: "tunya" });
    assert.equal(list.requests.length, 0);
  });

  it("join creates a party, invites the poster, and marks the request matched", async () => {
    db.prepare(`INSERT INTO users (id) VALUES ('poster'),('inviter')`).run();
    const posted = await macros.get("post")(ctxFor(db, "poster"), { worldId: "tunya", role: "dps" });

    const joined = await macros.get("join")(ctxFor(db, "inviter"), { lfgId: posted.id });
    assert.equal(joined.ok, true);
    assert.equal(typeof joined.partyId, "string");
    assert.equal(typeof joined.inviteId, "string");

    // The LFG row is now matched and points at the party.
    const row = db.prepare(`SELECT status, party_id FROM lfg_requests WHERE id = ?`).get(posted.id);
    assert.equal(row.status, "matched");
    assert.equal(row.party_id, joined.partyId);

    // A pending invite to the poster exists.
    const inv = db.prepare(
      `SELECT invited_id, status FROM party_invites WHERE id = ?`
    ).get(joined.inviteId);
    assert.equal(inv.invited_id, "poster");
    assert.equal(inv.status, "pending");

    // The poster can't join their own request.
    const posted2 = await macros.get("post")(ctxFor(db, "poster"), { worldId: "tunya", role: "tank" });
    const selfJoin = await macros.get("join")(ctxFor(db, "poster"), { lfgId: posted2.id });
    assert.equal(selfJoin.ok, false);
    assert.equal(selfJoin.error, "cannot_invite_self");
  });

  it("validates inputs without throwing", async () => {
    const noUser = await macros.get("post")({ db }, { worldId: "tunya" });
    assert.equal(noUser.ok, false);
    assert.equal(noUser.reason, "no_user");

    const noId = await macros.get("cancel")(ctxFor(db, "u"), {});
    assert.equal(noId.ok, false);
    assert.equal(noId.reason, "no_lfg_id");

    const noJoinId = await macros.get("join")(ctxFor(db, "u"), {});
    assert.equal(noJoinId.ok, false);
    assert.equal(noJoinId.reason, "no_lfg_id");
  });

  it("read macros return ok:false (not a throw) when ctx has no db", async () => {
    for (const name of ["post", "list", "cancel", "join"]) {
      const r = await macros.get(name)({}, {});
      assert.equal(r.ok, false, `${name} should be ok:false with no db`);
      assert.equal(r.reason, "no_db");
    }
  });
});
