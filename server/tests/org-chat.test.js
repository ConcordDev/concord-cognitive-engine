// Contract test for org-chat (firm chat) — migration 336 + lib/org-chat.js.
import { test } from "node:test";
import assert from "node:assert";
import Database from "better-sqlite3";
import { up as orgChatMigration } from "../migrations/336_org_chat.js";
import { postToOrgChat, listOrgChat } from "../lib/org-chat.js";

function freshDb() {
  const db = new Database(":memory:");
  orgChatMigration(db);
  return db;
}

test("postToOrgChat stores a message; listOrgChat returns it", () => {
  const db = freshDb();
  const r = postToOrgChat(db, { orgId: "org1", userId: "alice", body: "hello firm", isMember: (u) => u === "alice" });
  assert.ok(r.ok);
  assert.equal(r.message.body, "hello firm");
  const list = listOrgChat(db, "org1", { limit: 10 });
  assert.equal(list.length, 1);
  assert.equal(list[0].user_id, "alice");
  assert.equal(list[0].body, "hello firm");
});

test("postToOrgChat rejects a non-member (membership gate)", () => {
  const db = freshDb();
  const r = postToOrgChat(db, { orgId: "org1", userId: "mallory", body: "sneak", isMember: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.error, "not_member");
  assert.equal(listOrgChat(db, "org1").length, 0);
});

test("postToOrgChat rejects empty body; messages are org-scoped", () => {
  const db = freshDb();
  assert.equal(postToOrgChat(db, { orgId: "o", userId: "u", body: "   ", isMember: () => true }).ok, false);
  postToOrgChat(db, { orgId: "orgA", userId: "u", body: "in A", isMember: () => true });
  postToOrgChat(db, { orgId: "orgB", userId: "u", body: "in B", isMember: () => true });
  const a = listOrgChat(db, "orgA");
  assert.equal(a.length, 1);
  assert.equal(a[0].body, "in A");
});
