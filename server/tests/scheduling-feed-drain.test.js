// scheduling-feed-drain.test.js — the Feed scheduling family's SQL queue
// finally has a consumer (scheduling slice, 2026-11-14).
//
// Premise (verified at head before the fix): the frontend schedules posts
// into the SQL table `social_scheduled_posts` (routes/social-groups.js),
// whose own comment stood: "No cron job yet — the rows sit in the table
// until the frontend retrieves them." The only scheduled-post processor
// (processScheduledPosts) drained a DIFFERENT store — the social-layer's
// in-memory Map fed by a legacy route the frontend no longer calls — so a
// scheduled post stood 'pending' past its time forever (R4's dated read,
// 2026-11-12: the 09:00 throwaway never reached the feed).
//
// These tests drive the REAL path hermetically: the router's exact table
// DDL in node:sqlite, the social-layer's real createPost publish path, and
// the drain the "scheduled-posts" heartbeat now calls with the tick's db.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  processScheduledSqlPosts,
  processScheduledPosts,
  schedulePost,
  createPost,
} from "../emergent/social-layer.js";

// DDL copied verbatim from routes/social-groups.js (the producer's tables).
const DDL = `
  CREATE TABLE IF NOT EXISTS social_scheduled_posts (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    content      TEXT NOT NULL,
    group_id     TEXT,
    scheduled_at TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    status       TEXT NOT NULL DEFAULT 'pending'
  );
  CREATE TABLE IF NOT EXISTS social_group_posts (
    post_id     TEXT PRIMARY KEY,
    group_id    TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL DEFAULT 'Anonymous',
    content     TEXT NOT NULL,
    media_type  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    reactions   INTEGER NOT NULL DEFAULT 0,
    comments    INTEGER NOT NULL DEFAULT 0,
    shares      INTEGER NOT NULL DEFAULT 0
  );
`;

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(DDL);
  return db;
}
function seedRow(db, { id, userId, content, groupId = null, scheduledAt }) {
  db.prepare("INSERT INTO social_scheduled_posts (id, user_id, content, group_id, scheduled_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, userId, content, groupId, scheduledAt);
}
function statusOf(db, id) {
  return db.prepare("SELECT status FROM social_scheduled_posts WHERE id = ?").get(id)?.status;
}
const past = () => new Date(Date.now() - 60_000).toISOString();
const future = () => new Date(Date.now() + 3_600_000).toISOString();

describe("processScheduledSqlPosts — the live scheduled-post queue drains", () => {
  it("a due plain row FIRES: becomes a real feed post and flips to published", () => {
    const db = makeDb();
    const STATE = { dtus: new Map() };
    seedRow(db, { id: "sq-1", userId: "u-alice", content: "scheduled hello from the queue", scheduledAt: past() });
    const r = processScheduledSqlPosts(db, STATE);
    assert.equal(r.ok, true);
    assert.deepEqual(r.published, ["sq-1"]);
    assert.equal(statusOf(db, "sq-1"), "published");
    const posts = [...STATE._social.posts.values()];
    assert.equal(posts.length, 1);
    assert.equal(posts[0].content, "scheduled hello from the queue");
    assert.equal(posts[0].userId, "u-alice");
  });

  it("a due group row publishes into social_group_posts, not the main feed", () => {
    const db = makeDb();
    const STATE = { dtus: new Map() };
    seedRow(db, { id: "sq-g", userId: "u-bob", content: "group announcement", groupId: "g-42", scheduledAt: past() });
    const r = processScheduledSqlPosts(db, STATE);
    assert.deepEqual(r.published, ["sq-g"]);
    assert.equal(statusOf(db, "sq-g"), "published");
    const rows = db.prepare("SELECT group_id, author_id, content FROM social_group_posts").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].group_id, "g-42");
    assert.equal(rows[0].author_id, "u-bob");
    assert.equal(rows[0].content, "group announcement");
    assert.equal(STATE._social.posts.size, 0);
  });

  it("a future row does not fire and stays pending", () => {
    const db = makeDb();
    const STATE = { dtus: new Map() };
    seedRow(db, { id: "sq-f", userId: "u-alice", content: "later", scheduledAt: future() });
    const r = processScheduledSqlPosts(db, STATE);
    assert.equal(r.count, 0);
    assert.equal(statusOf(db, "sq-f"), "pending");
    assert.equal(STATE._social.posts.size, 0);
  });

  it("a refused publish flips the row to failed — terminal, never retried", () => {
    const db = makeDb();
    const STATE = { dtus: new Map() };
    // Publish the same content directly first: the duplicate-post guard
    // refuses the scheduled copy when its time comes.
    const direct = createPost(STATE, { userId: "u-alice", content: "same words twice" });
    assert.equal(direct.ok, true);
    seedRow(db, { id: "sq-d", userId: "u-alice", content: "same words twice", scheduledAt: past() });
    const r = processScheduledSqlPosts(db, STATE);
    assert.deepEqual(r.published, []);
    assert.deepEqual(r.failed, ["sq-d"]);
    assert.equal(statusOf(db, "sq-d"), "failed");
    const r2 = processScheduledSqlPosts(db, STATE);
    assert.equal(r2.count, 0);
    assert.deepEqual(r2.failed, []);
  });

  it("a second drain publishes nothing twice", () => {
    const db = makeDb();
    const STATE = { dtus: new Map() };
    seedRow(db, { id: "sq-2", userId: "u-alice", content: "once only", scheduledAt: past() });
    assert.equal(processScheduledSqlPosts(db, STATE).count, 1);
    assert.equal(processScheduledSqlPosts(db, STATE).count, 0);
    assert.equal(STATE._social.posts.size, 1);
  });

  it("no table (routes never loaded) is a quiet skip, not an error", () => {
    const db = new DatabaseSync(":memory:");
    const r = processScheduledSqlPosts(db, { dtus: new Map() });
    assert.equal(r.ok, true);
    assert.equal(r.skipped, "no_table");
  });

  it("the legacy in-memory queue still drains through processScheduledPosts", () => {
    const STATE = { dtus: new Map() };
    schedulePost(STATE, { userId: "u-alice", postData: { content: "legacy map post" }, scheduledAt: past() });
    const r = processScheduledPosts(STATE);
    assert.equal(r.count, 1);
    assert.equal([...STATE._social.posts.values()][0].content, "legacy map post");
  });
});

describe("wiring — the heartbeat tick reaches the SQL drain", () => {
  it("server.js's scheduled-posts handler calls processScheduledSqlPosts with the tick db", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "server.js"), "utf8");
    const start = src.indexOf('registerHeartbeat("scheduled-posts"');
    assert.ok(start >= 0, "scheduled-posts heartbeat registration exists");
    const block = src.slice(start, start + 1800);
    assert.match(block, /processScheduledSqlPosts\(db, state\)/);
    assert.match(block, /processScheduledPosts\(state\)/);
  });
});
