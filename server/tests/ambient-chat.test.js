// Phase AG — ambient chat tests.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  postAmbientMessage,
  listRecentInDistrict,
  sweepExpiredAmbientChat,
  RATE_LIMIT_MAX,
} from "../lib/ambient-chat.js";
import { up as upAmbient } from "../migrations/231_ambient_chat.js";

function freshDb() {
  const db = new Database(":memory:");
  upAmbient(db);
  return db;
}

describe("Phase AG — ambient chat", () => {
  let db;
  beforeEach(() => { db = freshDb(); delete process.env.CONCORD_AMBIENT_CHAT_ENABLED; });

  it("post + list round-trip in the same district", () => {
    const r = postAmbientMessage(db, { userId: "u1", worldId: "tunya", districtId: "marketplace", body: "anyone going to the night market?" });
    assert.equal(r.ok, true);
    const list = listRecentInDistrict(db, "tunya", "marketplace");
    assert.equal(list.length, 1);
    assert.equal(list[0].body, "anyone going to the night market?");
  });

  it("rate limit blocks the (RATE_LIMIT_MAX + 1)th message in 1 minute", () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const r = postAmbientMessage(db, { userId: "spammer", worldId: "tunya", districtId: "m", body: `msg ${i}` });
      assert.equal(r.ok, true);
    }
    const blocked = postAmbientMessage(db, { userId: "spammer", worldId: "tunya", districtId: "m", body: "msg overflow" });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error, "rate_limited");
  });

  it("district isolation — message in A does not bleed to B", () => {
    postAmbientMessage(db, { userId: "u1", worldId: "tunya", districtId: "A", body: "hi A" });
    postAmbientMessage(db, { userId: "u2", worldId: "tunya", districtId: "B", body: "hi B" });
    const a = listRecentInDistrict(db, "tunya", "A");
    const b = listRecentInDistrict(db, "tunya", "B");
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
    assert.equal(a[0].body, "hi A");
  });

  it("world isolation — same district name in different worlds is separate", () => {
    postAmbientMessage(db, { userId: "u1", worldId: "tunya", districtId: "market", body: "tunya-msg" });
    postAmbientMessage(db, { userId: "u2", worldId: "cyber", districtId: "market", body: "cyber-msg" });
    const tunya = listRecentInDistrict(db, "tunya", "market");
    assert.equal(tunya.length, 1);
    assert.equal(tunya[0].body, "tunya-msg");
  });

  it("sweep removes expired", () => {
    postAmbientMessage(db, { userId: "u1", worldId: "tunya", districtId: "m", body: "ephemeral" });
    db.prepare(`UPDATE ambient_chat_messages SET expires_at = 1`).run();
    const s = sweepExpiredAmbientChat(db);
    assert.equal(s.ok, true);
    assert.equal(s.removed, 1);
    assert.equal(listRecentInDistrict(db, "tunya", "m").length, 0);
  });

  it("list orders by recency (newest first)", () => {
    postAmbientMessage(db, { userId: "u1", worldId: "tunya", districtId: "m", body: "first" });
    // Different user to avoid rate-limit.
    postAmbientMessage(db, { userId: "u2", worldId: "tunya", districtId: "m", body: "second" });
    postAmbientMessage(db, { userId: "u3", worldId: "tunya", districtId: "m", body: "third" });
    const list = listRecentInDistrict(db, "tunya", "m");
    assert.equal(list[0].body, "third", "newest first");
    assert.equal(list[2].body, "first", "oldest last");
  });

  it("body length is capped at 280 chars", () => {
    const long = "x".repeat(500);
    const r = postAmbientMessage(db, { userId: "u1", worldId: "tunya", districtId: "m", body: long });
    assert.equal(r.ok, true);
    assert.equal(r.body.length, 280);
  });

  it("env disable returns { ok: false, error: 'disabled' }", () => {
    process.env.CONCORD_AMBIENT_CHAT_ENABLED = "0";
    const r = postAmbientMessage(db, { userId: "u1", worldId: "tunya", districtId: "m", body: "hi" });
    assert.equal(r.ok, false);
    assert.equal(r.error, "disabled");
    delete process.env.CONCORD_AMBIENT_CHAT_ENABLED;
  });
});
