// Tests for the social-npc-bridge.
// Uses an in-memory SQLite to verify privacy enforcement and idempotency.
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { runSocialNpcBridge } from "../emergent/social-npc-bridge.js";

function makeFixture() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT,
      title TEXT,
      body_json TEXT,
      tags_json TEXT,
      created_at TEXT
    );
  `);
  return db;
}

function insertPost(db, { id, owner = "alice", content, privacy, ts, tag = "timeline" }) {
  db.prepare(`
    INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    owner,
    content?.slice(0, 80) ?? "",
    JSON.stringify({ content, privacy }),
    JSON.stringify([tag]),
    ts ?? new Date().toISOString(),
  );
}

describe("social-npc-bridge", () => {
  let db;
  let state;
  before(() => {
    db = makeFixture();
    state = {};
  });

  test("creates a shadow for a public timeline post", async () => {
    insertPost(db, { id: "p1", content: "hello world", privacy: "public", ts: "2026-01-01T00:00:00.000Z" });
    const r = await runSocialNpcBridge({ state, db, tickCount: 5 });
    assert.equal(r.ok, true);
    assert.equal(r.createdShadows, 1);
    const shadow = state.shadowDtus.get("shadow_social_p1");
    assert.ok(shadow);
    assert.deepEqual(shadow.tags, ["social_awareness"]);
    assert.equal(shadow.core.summary, "hello world");
    assert.equal(shadow.authorHandle, "alice");
  });

  test("ignores private posts (defense in depth)", async () => {
    insertPost(db, { id: "p2", content: "secret", privacy: "private", ts: "2026-01-02T00:00:00.000Z" });
    insertPost(db, { id: "p3", content: "for friends", privacy: "friends", ts: "2026-01-02T01:00:00.000Z" });
    const r = await runSocialNpcBridge({ state, db, tickCount: 10 });
    assert.equal(r.createdShadows, 0);
    assert.equal(state.shadowDtus.has("shadow_social_p2"), false);
    assert.equal(state.shadowDtus.has("shadow_social_p3"), false);
  });

  test("ignores non-timeline DTUs", async () => {
    insertPost(db, { id: "n1", content: "skill thing", privacy: "public", ts: "2026-01-03T00:00:00.000Z", tag: "combat_skill" });
    const r = await runSocialNpcBridge({ state, db, tickCount: 15 });
    assert.equal(r.createdShadows, 0);
  });

  test("is idempotent — re-running advances cursor without dup shadows", async () => {
    const before = state.shadowDtus.size;
    const r = await runSocialNpcBridge({ state, db, tickCount: 20 });
    assert.equal(r.createdShadows, 0);
    assert.equal(state.shadowDtus.size, before);
  });

  test("processes only new posts after the cursor", async () => {
    insertPost(db, { id: "p4", content: "new public post", privacy: "public", ts: "2026-02-01T00:00:00.000Z" });
    const r = await runSocialNpcBridge({ state, db, tickCount: 25 });
    assert.equal(r.createdShadows, 1);
    assert.equal(state.shadowDtus.has("shadow_social_p4"), true);
  });

  test("skips empty content posts", async () => {
    insertPost(db, { id: "p5", content: "", privacy: "public", ts: "2026-03-01T00:00:00.000Z" });
    const r = await runSocialNpcBridge({ state, db, tickCount: 30 });
    assert.equal(r.createdShadows, 0);
  });

  test("returns ok:false when db is missing", async () => {
    const r = await runSocialNpcBridge({ state, db: null, tickCount: 35 });
    assert.equal(r.ok, false);
  });

  test("treats missing privacy as public (default for legacy posts)", async () => {
    db.prepare(`
      INSERT INTO dtus (id, owner_user_id, title, body_json, tags_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("p6", "bob", "legacy", JSON.stringify({ content: "legacy post" }), JSON.stringify(["timeline"]), "2026-04-01T00:00:00.000Z");
    const r = await runSocialNpcBridge({ state, db, tickCount: 40 });
    assert.equal(r.createdShadows, 1);
  });
});
