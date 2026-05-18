// server/tests/messaging-scheduler.test.js
//
// Sprint B #17 scheduled-send + #18 push subscriptions.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerMessagingSchedulerMacros from "../domains/messaging-scheduler.js";
import registerMessagingPushMacros from "../domains/messaging-push.js";
import registerMessagingConversationsMacros from "../domains/messaging-conversations.js";

let db; const macros = new Map();

before(async () => {
  db = new Database(":memory:");
  const m209 = await import("../migrations/209_messaging_substrate.js");
  m209.up(db);
  const m210 = await import("../migrations/210_push_subscriptions.js");
  m210.up(db);
  registerMessagingSchedulerMacros((_d, n, h) => macros.set(n, h));
  registerMessagingPushMacros((_d, n, h) => macros.set(n, h));
  registerMessagingConversationsMacros((_d, n, h) => macros.set(n, h));
});
after(() => { try { db.close(); } catch { /* ok */ } });

describe("scheduler_tick", () => {
  let cid;
  before(async () => {
    const r = await macros.get("convo_create")({ db, actor: { userId: "u_a" } }, { kind: "channel", title: "sched" });
    cid = r.id;
  });
  it("flushes due scheduled messages + clears scheduled_for", async () => {
    // Insert a scheduled message directly (past-due)
    const id = `msg_${Date.now()}_sched`;
    db.prepare(`
      INSERT INTO messages (id, conversation_id, author_id, body, body_kind, scheduled_for, server_ts, created_at)
      VALUES (?, ?, ?, ?, 'text', ?, ?, ?)
    `).run(id, cid, "u_a", "scheduled body", Math.floor(Date.now() / 1000) - 60, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    const r = await macros.get("scheduler_tick")({ db }, {});
    assert.equal(r.ok, true);
    assert.equal(r.flushed, 1);
    const row = db.prepare(`SELECT scheduled_for FROM messages WHERE id = ?`).get(id);
    assert.equal(row.scheduled_for, null);
  });
  it("leaves future-scheduled messages alone", async () => {
    const id = `msg_${Date.now()}_future`;
    const future = Math.floor(Date.now() / 1000) + 3600;
    db.prepare(`
      INSERT INTO messages (id, conversation_id, author_id, body, body_kind, scheduled_for, server_ts, created_at)
      VALUES (?, ?, ?, ?, 'text', ?, ?, ?)
    `).run(id, cid, "u_a", "future body", future, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000));
    await macros.get("scheduler_tick")({ db }, {});
    const row = db.prepare(`SELECT scheduled_for FROM messages WHERE id = ?`).get(id);
    assert.equal(row.scheduled_for, future);
  });
});

describe("push subscriptions", () => {
  it("push_vapid_public returns enabled flag", async () => {
    const r = await macros.get("push_vapid_public")({});
    assert.equal(r.ok, true);
    assert.equal(typeof r.enabled, "boolean");
  });
  it("push_subscribe validates endpoint + keys", async () => {
    const ctx = { db, actor: { userId: "u_a" } };
    const a = await macros.get("push_subscribe")(ctx, { endpoint: "http://x.com/", keys: { auth: "a", p256dh: "b" } });
    assert.equal(a.reason, "invalid_endpoint");
    const b = await macros.get("push_subscribe")(ctx, { endpoint: "https://push.example.com/abc", keys: {} });
    assert.equal(b.reason, "missing_keys");
  });
  it("subscribe + list + unsubscribe round-trip", async () => {
    const ctx = { db, actor: { userId: "u_a" } };
    const s = await macros.get("push_subscribe")(ctx, { endpoint: "https://push.example.com/abc", keys: { auth: "aa", p256dh: "bb" }, userAgent: "ua/1" });
    assert.equal(s.ok, true);
    const l = await macros.get("push_list")(ctx, {});
    assert.ok(l.subscriptions.find((s) => s.endpoint === "https://push.example.com/abc"));
    const u = await macros.get("push_unsubscribe")(ctx, { endpoint: "https://push.example.com/abc" });
    assert.equal(u.ok, true);
    assert.equal(u.removed, 1);
  });
  it("subscribe is idempotent on (user_id, endpoint) — same endpoint upserts", async () => {
    const ctx = { db, actor: { userId: "u_a" } };
    await macros.get("push_subscribe")(ctx, { endpoint: "https://x/a", keys: { auth: "a", p256dh: "b" } });
    await macros.get("push_subscribe")(ctx, { endpoint: "https://x/a", keys: { auth: "a2", p256dh: "b2" } });
    const l = await macros.get("push_list")(ctx, {});
    assert.equal(l.subscriptions.filter((s) => s.endpoint === "https://x/a").length, 1);
  });
});
