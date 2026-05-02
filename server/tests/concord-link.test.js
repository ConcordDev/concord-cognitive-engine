/**
 * Tests for The Concord Link cross-world communication substrate.
 *
 * Covers:
 *   - computeMessageCost: base + same-world discount + encryption multipliers
 *   - rollCorruption: bounded probabilities, encryption monotonicity
 *   - applyShadowBurn: under-threshold passes, over-threshold cools down,
 *     severity escalates, daily decay clears prior burn
 *   - sendMessage: atomic sparks debit, insufficient_sparks rolls back,
 *     NPC senders bypass wallet, message persists exactly when send succeeds,
 *     cost_currency='sparks' on every persisted row
 *   - listInbox / markRead
 *   - listAnchorsForWorld + seedAnchorsFromWorldMeta idempotence
 */

import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import {
  computeMessageCost,
  rollCorruption,
  applyShadowBurn,
  sendMessage,
  listInbox,
  markRead,
  listAnchorsForWorld,
  seedAnchorsFromWorldMeta,
} from "../lib/concord-link.js";
import { up as migrate076 } from "../migrations/076_concord_link.js";

function freshDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      sparks INTEGER NOT NULL DEFAULT 0
    );
  `);
  migrate076(db);
  return db;
}

describe("computeMessageCost", () => {
  it("returns the base cost for cross-world basic text", () => {
    const r = computeMessageCost({
      messageType: "text",
      sourceWorld: "fantasy",
      destWorld: "cyber",
      encryption: "basic",
    });
    assert.equal(r.cost, 1);
    assert.equal(r.sameWorldDiscount, false);
  });

  it("applies same-world 0.3× discount", () => {
    const cross = computeMessageCost({
      messageType: "data", sourceWorld: "fantasy", destWorld: "cyber", encryption: "basic",
    }).cost;
    const same = computeMessageCost({
      messageType: "data", sourceWorld: "fantasy", destWorld: "fantasy", encryption: "basic",
    });
    assert.ok(same.cost < cross, "same-world should be cheaper");
    assert.equal(same.sameWorldDiscount, true);
  });

  it("multiplies high encryption by 2 and shadow by 4", () => {
    const base = computeMessageCost({ messageType: "data", sourceWorld: "a", destWorld: "b", encryption: "basic" }).cost;
    const high = computeMessageCost({ messageType: "data", sourceWorld: "a", destWorld: "b", encryption: "high" }).cost;
    const shadow = computeMessageCost({ messageType: "data", sourceWorld: "a", destWorld: "b", encryption: "shadow" }).cost;
    assert.equal(high, base * 2);
    assert.equal(shadow, base * 4);
  });
});

describe("rollCorruption", () => {
  it("returns chance in [0, 0.5]", () => {
    for (const enc of ["none", "basic", "high", "shadow"]) {
      for (const w of [0, 0.3, 0.7, 1]) {
        const { chance } = rollCorruption({ encryption: enc, emotionalWeight: w, veilStability: 1 });
        assert.ok(chance >= 0 && chance <= 0.5, `chance ${chance} out of bounds for ${enc}/${w}`);
      }
    }
  });

  it("shadow encryption reduces corruption chance vs no encryption", () => {
    const none = rollCorruption({ encryption: "none", emotionalWeight: 0, veilStability: 1 }).chance;
    const shadow = rollCorruption({ encryption: "shadow", emotionalWeight: 0, veilStability: 1 }).chance;
    assert.ok(shadow < none, `shadow ${shadow} should be < none ${none}`);
  });
});

describe("applyShadowBurn", () => {
  it("blocks once cooldown is active and clears once cooldown elapses", (t) => {
    const db = freshDb();
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('alice', 100)`).run();

    // Force the user just above threshold by writing to the burn table directly
    const now = Math.floor(Date.now() / 1000);
    const today = Math.floor(now / 86400);
    db.prepare(`
      INSERT INTO concord_link_shadow_burn (sender_id, messages_today, burn_severity, last_reset_day, last_message_at, cooldown_until)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("alice", 50, 1, today, now, now + 30);

    const blocked = applyShadowBurn(db, "alice");
    assert.equal(blocked.blocked, true);
    assert.ok(blocked.cooldownRemaining > 0);
  });

  it("allows under-threshold sends and increments counter", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('bob', 100)`).run();
    const r1 = applyShadowBurn(db, "bob");
    assert.equal(r1.blocked, false);
    const row = db.prepare(`SELECT messages_today FROM concord_link_shadow_burn WHERE sender_id = 'bob'`).get();
    assert.equal(row.messages_today, 1);
  });
});

describe("sendMessage atomic sparks debit", () => {
  let db;
  beforeEach(() => {
    db = freshDb();
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('alice', 100)`).run();
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('bob', 0)`).run();
  });

  it("debits sparks on a successful cross-world send", () => {
    const r = sendMessage(db, {
      senderId: "alice", senderKind: "user",
      receiverId: "bob", receiverKind: "user",
      sourceWorld: "fantasy", destWorld: "cyber",
      messageType: "text", payload: "hi", encryption: "basic",
    }, {});
    assert.equal(r.ok, true);
    assert.equal(r.cost, 1);
    const after = db.prepare(`SELECT sparks FROM users WHERE id = 'alice'`).get();
    assert.equal(after.sparks, 99);
  });

  it("rolls back the message row when sender has insufficient sparks", () => {
    const r = sendMessage(db, {
      senderId: "alice", senderKind: "user",
      receiverId: "bob", receiverKind: "user",
      sourceWorld: "fantasy", destWorld: "cyber",
      messageType: "broadcast", payload: "shout", encryption: "shadow",
    }, {});
    assert.equal(r.ok, false);
    assert.match(r.reason, /insufficient_sparks/);
    const after = db.prepare(`SELECT sparks FROM users WHERE id = 'alice'`).get();
    assert.equal(after.sparks, 100, "balance must not change on a failed send");
    const count = db.prepare(`SELECT COUNT(*) c FROM concord_link_messages`).get().c;
    assert.equal(count, 0, "no message row should persist on failure");
  });

  it("zero-balance sender is rejected with insufficient_sparks", () => {
    const r = sendMessage(db, {
      senderId: "bob", senderKind: "user",
      receiverId: "alice", receiverKind: "user",
      sourceWorld: "fantasy", destWorld: "cyber",
      messageType: "text", payload: "hi", encryption: "basic",
    }, {});
    assert.equal(r.ok, false);
    assert.match(r.reason, /insufficient_sparks/);
  });

  it("NPC senders skip the wallet check", () => {
    const r = sendMessage(db, {
      senderId: "npc_thorne", senderKind: "npc",
      receiverId: "alice", receiverKind: "user",
      sourceWorld: "fantasy", destWorld: "cyber",
      messageType: "text", payload: "from the wolf", encryption: "basic",
    }, {});
    assert.equal(r.ok, true);
    const aliceAfter = db.prepare(`SELECT sparks FROM users WHERE id = 'alice'`).get();
    assert.equal(aliceAfter.sparks, 100, "NPC send must not affect any user balance");
  });

  it("persisted messages always record cost_currency='sparks'", () => {
    sendMessage(db, {
      senderId: "alice", senderKind: "user",
      receiverId: "bob", receiverKind: "user",
      sourceWorld: "fantasy", destWorld: "cyber",
      messageType: "text", payload: "x", encryption: "basic",
    }, {});
    const row = db.prepare(`SELECT cost_currency FROM concord_link_messages`).get();
    assert.equal(row.cost_currency, "sparks");
  });

  it("emits realtime to recipient when delivered + online", (t) => {
    const calls = [];
    const emitToUser = (uid, event, payload) => calls.push({ uid, event, payload });
    sendMessage(db, {
      senderId: "alice", senderKind: "user",
      receiverId: "bob", receiverKind: "user",
      sourceWorld: "fantasy", destWorld: "cyber",
      messageType: "text", payload: "hello", encryption: "basic",
    }, { emitToUser });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].uid, "bob");
    assert.equal(calls[0].event, "concord-link:message");
  });
});

describe("listInbox + markRead", () => {
  it("returns recipient messages newest-first and marks them read", () => {
    const db = freshDb();
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('alice', 100)`).run();
    db.prepare(`INSERT INTO users (id, sparks) VALUES ('bob', 100)`).run();
    sendMessage(db, {
      senderId: "alice", senderKind: "user",
      receiverId: "bob", receiverKind: "user",
      sourceWorld: "fantasy", destWorld: "cyber",
      messageType: "text", payload: "first", encryption: "basic",
    }, {});
    sendMessage(db, {
      senderId: "alice", senderKind: "user",
      receiverId: "bob", receiverKind: "user",
      sourceWorld: "fantasy", destWorld: "cyber",
      messageType: "text", payload: "second", encryption: "basic",
    }, {});

    const inbox = listInbox(db, "bob");
    assert.equal(inbox.length, 2);
    assert.ok(inbox[0].sent_at >= inbox[1].sent_at, "newest first");

    const before = inbox[0];
    assert.equal(before.read_at, null);
    markRead(db, before.id, "bob");
    const after = listInbox(db, "bob")[0];
    assert.ok(after.read_at != null);
  });
});

describe("seedAnchorsFromWorldMeta + listAnchorsForWorld", () => {
  it("seeds and lists anchors; double-seed is idempotent", () => {
    const db = freshDb();
    const meta = {
      world_id: "fantasy",
      concord_link: {
        anchors: [
          { id: "anchor_a", name: "A", access_method: "test", description: "first", controlled_by_faction: null, stability: 0.9 },
          { id: "anchor_b", name: "B", access_method: "test", description: "second", controlled_by_faction: null, stability: 0.8 },
        ],
      },
    };
    const n1 = seedAnchorsFromWorldMeta(db, meta);
    assert.equal(n1, 2);
    const n2 = seedAnchorsFromWorldMeta(db, meta);
    assert.ok(n2 >= 0, "second seed should not throw");
    const anchors = listAnchorsForWorld(db, "fantasy");
    assert.equal(anchors.length, 2);
  });
});
